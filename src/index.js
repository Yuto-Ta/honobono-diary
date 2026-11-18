// ほのぼの日記 — Cloudflare 勉強会用サンプル（Hono）
//
// 同じコードを2つの Worker としてデプロイする（wrangler.jsonc の env.admin）
//   公開サイト honobono-diary       … 誰でも日記を読めて、コメントできる
//   管理画面   honobono-diary-admin … 日記の作成・編集・削除、コメントの削除
// Access は Worker（ホスト名）単位でかかるため、管理画面を別の Worker に分けている
//
//   D1（必須）        : env.DB     … 日記・コメント（R2 が無ければ画像も）
//   R2（任意）        : env.IMAGES … バインドすると画像の保存先が R2 に切り替わる
//   Turnstile（任意） : TURNSTILE_SITE_KEY と TURNSTILE_SECRET_KEY でコメントを Bot から守る
//   管理画面の認証    : src/auth.js（Access か Basic 認証）
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { adminAuth } from "./auth.js";
import { MAX_BODY, MAX_COMMENT_BODY, MAX_COMMENT_NAME, MAX_TITLE } from "./config.js";
import { loadImage, pickImage, removeStoredImage, storeImage } from "./images.js";
import { AdminIndex, AdminPostForm, PublicIndex, PublicPost } from "./views.js";

const ID = "{[0-9]+}";

/** 両方の Worker に共通する部分 */
function createApp() {
  const app = new Hono();
  app.use(secureHeaders());

  app.get(`/images/:id${ID}`, async (c) => {
    const img = await loadImage(c.env, Number(c.req.param("id")));
    if (!img) return c.notFound();
    // 差し替え後も古い画像が長く残らないよう、キャッシュは短めにする
    return c.body(img.data, 200, { "Content-Type": img.type, "Cache-Control": "public, max-age=60" });
  });

  app.notFound((c) => c.text("Not Found", 404));
  app.onError((err, c) => {
    // Basic 認証の失敗（401）や CSRF の拒否（403）は、ミドルウェアが用意した応答をそのまま返す
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.text("エラーが発生しました。時間をおいて再度お試しください。", 500);
  });
  return app;
}

// ============================== 公開サイト ==============================

const site = createApp();

// 日記の一覧
site.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.id, p.title, substr(p.body, 1, 80) AS excerpt, length(p.body) AS body_length, p.created_at,
           (p.image IS NOT NULL OR p.image_key IS NOT NULL) AS has_image,
           (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
    FROM posts p ORDER BY p.id DESC LIMIT 50`).all();
  return c.html(PublicIndex({ posts: results }));
});

// 日記の詳細とコメント
site.get(`/posts/:id${ID}`, async (c) => {
  const id = Number(c.req.param("id"));
  const post = await findPost(c.env, id);
  if (!post) return c.notFound();
  const comments = await listComments(c.env, id);
  return c.html(PublicPost({ post, comments, error: c.req.query("error"), siteKey: c.env.TURNSTILE_SITE_KEY }));
});

// コメントの投稿（Turnstile で Bot を弾く）
site.post(`/posts/:id${ID}/comments`, async (c) => {
  const id = Number(c.req.param("id"));
  const back = (message) => c.redirect(`/posts/${id}?error=${encodeURIComponent(message)}#comments`, 303);
  const form = await c.req.formData();

  // ウィジェットは表示されているのに検証だけ行われない、という見落としを防ぐため通さない
  if (c.env.TURNSTILE_SITE_KEY && !c.env.TURNSTILE_SECRET_KEY) {
    console.error("TURNSTILE_SITE_KEY は設定されていますが、TURNSTILE_SECRET_KEY が未設定です");
    return back("Bot 対策（Turnstile）の設定が完了していないため、コメントできません。");
  }
  if (c.env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, form.get("cf-turnstile-response"), c.req.header("CF-Connecting-IP"));
    if (!ok) return back("Bot の可能性があると判定されたため、コメントできませんでした。");
  }

  const name = String(form.get("name") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!body) return back("コメントを入力してください。");
  if (name.length > MAX_COMMENT_NAME || body.length > MAX_COMMENT_BODY) {
    return back(`お名前は${MAX_COMMENT_NAME}文字、コメントは${MAX_COMMENT_BODY}文字までです。`);
  }
  if (!(await findPost(c.env, id))) return c.notFound();

  await c.env.DB
    .prepare("INSERT INTO comments (post_id, name, body) VALUES (?, ?, ?)")
    .bind(id, name || null, body)
    .run();
  return c.redirect(`/posts/${id}#comments`, 303);
});

// ============================== 管理画面 ==============================

const admin = createApp();

// 画像も含めて、管理用の Worker へのリクエストはすべて認証を通す
admin.use("*", adminAuth);
// 別のサイトから管理画面へフォームを送らせる攻撃（CSRF）を防ぐ。Origin が自分自身のときだけ POST を通す
admin.use("*", csrf());

admin.get("/", (c) => c.redirect("/admin"));

admin.get("/admin", async (c) => {
  const [{ results: posts }, { results: comments }] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT p.id, p.title, p.created_at,
             (p.image IS NOT NULL OR p.image_key IS NOT NULL) AS has_image,
             (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
      FROM posts p ORDER BY p.id DESC LIMIT 100`),
    c.env.DB.prepare(`
      SELECT cm.id, cm.post_id, cm.name, cm.body, cm.created_at, p.title AS post_title
      FROM comments cm JOIN posts p ON p.id = cm.post_id
      ORDER BY cm.id DESC LIMIT 20`),
  ]);
  return c.html(AdminIndex({ posts, comments, user: c.get("adminUser"), notice: c.req.query("notice") }));
});

// 作成
admin.get("/admin/posts/new", (c) => c.html(AdminPostForm({ user: c.get("adminUser") })));

admin.post("/admin/posts", async (c) => {
  const form = await c.req.formData();
  const input = readPostForm(form);
  if (input.error) {
    return c.html(AdminPostForm({ post: input.values, user: c.get("adminUser"), error: input.error }), 400);
  }
  const img = input.file ? await storeImage(c.env, input.file) : { image: null, image_type: null, image_key: null };
  const row = await c.env.DB
    .prepare("INSERT INTO posts (title, body, author, image, image_type, image_key) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(input.values.title, input.values.body, c.get("adminUser"), img.image, img.image_type, img.image_key)
    .first();
  return c.redirect(`/admin?notice=${encodeURIComponent(`「${input.values.title}」を公開しました（ID ${row.id}）。`)}`, 303);
});

// 編集
admin.get(`/admin/posts/:id${ID}/edit`, async (c) => {
  const id = Number(c.req.param("id"));
  const post = await findPost(c.env, id);
  if (!post) return c.notFound();
  const comments = await listComments(c.env, id);
  return c.html(AdminPostForm({ post, comments, user: c.get("adminUser"), error: c.req.query("error") }));
});

admin.post(`/admin/posts/:id${ID}`, async (c) => {
  const id = Number(c.req.param("id"));
  const current = await findPost(c.env, id);
  if (!current) return c.notFound();

  const form = await c.req.formData();
  const input = readPostForm(form);
  if (input.error) {
    const comments = await listComments(c.env, id);
    return c.html(AdminPostForm({ post: { ...current, ...input.values }, comments, user: c.get("adminUser"), error: input.error }), 400);
  }
  const { title, body } = input.values;

  if (input.file || form.get("remove_image") === "1") {
    // 新しい画像を先に保存し、DB を更新してから古い画像を消す（途中で失敗しても記事の画像が消えないように）
    const img = input.file ? await storeImage(c.env, input.file) : { image: null, image_type: null, image_key: null };
    await c.env.DB
      .prepare("UPDATE posts SET title = ?, body = ?, image = ?, image_type = ?, image_key = ? WHERE id = ?")
      .bind(title, body, img.image, img.image_type, img.image_key, id)
      .run();
    await removeStoredImage(c.env, current.image_key);
  } else {
    await c.env.DB.prepare("UPDATE posts SET title = ?, body = ? WHERE id = ?").bind(title, body, id).run();
  }
  return c.redirect(`/admin?notice=${encodeURIComponent(`「${title}」を更新しました。`)}`, 303);
});

// 削除（コメントも一緒に消す）
admin.post(`/admin/posts/:id${ID}/delete`, async (c) => {
  const id = Number(c.req.param("id"));
  const post = await findPost(c.env, id);
  if (!post) return c.notFound();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
  ]);
  await removeStoredImage(c.env, post.image_key);
  return c.redirect(`/admin?notice=${encodeURIComponent(`「${post.title}」を削除しました。`)}`, 303);
});

// コメントの削除
admin.post(`/admin/comments/:id${ID}/delete`, async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("DELETE FROM comments WHERE id = ? RETURNING post_id").bind(id).first();
  if (!row) return c.notFound();
  return c.redirect(`/admin/posts/${row.post_id}/edit`, 303);
});

// ============================== 振り分け ==============================

export default {
  fetch(request, env, ctx) {
    return pickApp(request, env).fetch(request, env, ctx);
  },
};

function pickApp(request, env) {
  if (env.APP_MODE === "admin") return admin;
  // pnpm dev（手元）だけは1つのプロセスで両方を動かす。/admin から始まるパスを管理画面に回す
  if (env.APP_MODE === "local") {
    const { pathname } = new URL(request.url);
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return admin;
  }
  return site;
}

// ============================== 共通の処理 ==============================

async function findPost(env, id) {
  // 画像の中身（BLOB）は重いので読まない
  return env.DB.prepare(`
    SELECT id, title, body, author, created_at, image_key,
           (image IS NOT NULL OR image_key IS NOT NULL) AS has_image
    FROM posts WHERE id = ?`).bind(id).first();
}

async function listComments(env, postId) {
  const { results } = await env.DB
    .prepare("SELECT id, name, body, created_at FROM comments WHERE post_id = ? ORDER BY id")
    .bind(postId)
    .all();
  return results;
}

function readPostForm(form) {
  const values = {
    title: String(form.get("title") ?? "").trim(),
    body: String(form.get("body") ?? "").trim(),
  };
  if (!values.title || !values.body) return { values, error: "タイトルと本文を入力してください。" };
  if (values.title.length > MAX_TITLE || values.body.length > MAX_BODY) {
    return { values, error: `タイトルは${MAX_TITLE}文字、本文は${MAX_BODY}文字までです。` };
  }
  const picked = pickImage(form);
  if (picked.error) return { values, error: picked.error };
  return { values, file: picked.file };
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    // 検証できないときは通さない（Bot 対策が黙って無効になるのを防ぐ）
    console.error("Turnstile の検証に失敗しました", err);
    return false;
  }
}
