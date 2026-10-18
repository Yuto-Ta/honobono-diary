// ほのぼの日記 — Cloudflare 勉強会用サンプル（Hono）
//   D1（必須）  : c.env.DB    … 日記と画像を保存
//   R2（任意）  : c.env.IMAGES … バインドすると画像の保存先が R2 に切り替わる
//   Turnstile（任意）: TURNSTILE_SITE_KEY と TURNSTILE_SECRET_KEY を設定すると投稿時に Bot 判定する
import { Hono } from "hono";
import { html } from "hono/html";
import { secureHeaders } from "hono/secure-headers";

const MAX_IMAGE_BYTES = 1024 * 1024; // D1 の1行あたりの上限に余裕を持たせて 1MB
const MAX_TITLE = 100;
const MAX_BODY = 2000;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const app = new Hono();

app.use(secureHeaders());

// 日記の一覧と投稿フォーム
app.get("/", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT id, title, body, author, created_at, (image IS NOT NULL OR image_key IS NOT NULL) AS has_image FROM posts ORDER BY id DESC LIMIT 50")
    .all();
  // Access を通過したリクエストにだけ付くヘッダ。Access 未設定なら undefined
  const user = c.req.header("Cf-Access-Authenticated-User-Email");
  return c.html(Page({ posts: results, user, error: c.req.query("error"), siteKey: c.env.TURNSTILE_SITE_KEY }));
});

// 日記の投稿
app.post("/posts", async (c) => {
  const form = await c.req.formData();

  // ウィジェットは表示されているのに検証だけ行われない、という見落としを防ぐため通さない
  if (c.env.TURNSTILE_SITE_KEY && !c.env.TURNSTILE_SECRET_KEY) {
    console.error("TURNSTILE_SITE_KEY は設定されていますが、TURNSTILE_SECRET_KEY が未設定です");
    return redirectWithError(c, "Bot 対策（Turnstile）の設定が完了していないため、投稿できません。");
  }

  if (c.env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, form.get("cf-turnstile-response"), c.req.header("CF-Connecting-IP"));
    if (!ok) return redirectWithError(c, "Bot の可能性があると判定されたため、投稿できませんでした。");
  }

  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!title || !body) return redirectWithError(c, "タイトルと本文を入力してください。");
  if (title.length > MAX_TITLE || body.length > MAX_BODY) {
    return redirectWithError(c, `タイトルは${MAX_TITLE}文字、本文は${MAX_BODY}文字までです。`);
  }

  let image = null;
  let imageType = null;
  const file = form.get("image");
  if (file && typeof file === "object" && file.size > 0) {
    if (!ALLOWED_TYPES.includes(file.type)) return redirectWithError(c, "画像は JPEG / PNG / GIF / WebP のみ投稿できます。");
    if (file.size > MAX_IMAGE_BYTES) return redirectWithError(c, "画像は 1MB までです。");
    image = await file.arrayBuffer();
    imageType = file.type;
  }

  const author = c.req.header("Cf-Access-Authenticated-User-Email") ?? null;

  if (image && c.env.IMAGES) {
    const key = `posts/${crypto.randomUUID()}`;
    await c.env.IMAGES.put(key, image, { httpMetadata: { contentType: imageType } });
    await c.env.DB
      .prepare("INSERT INTO posts (title, body, author, image_type, image_key) VALUES (?, ?, ?, ?, ?)")
      .bind(title, body, author, imageType, key)
      .run();
  } else {
    await c.env.DB
      .prepare("INSERT INTO posts (title, body, author, image, image_type) VALUES (?, ?, ?, ?, ?)")
      .bind(title, body, author, image, imageType)
      .run();
  }

  return c.redirect("/", 303);
});

// 画像の取得（D1 または R2）
app.get("/images/:id{[0-9]+}", async (c) => {
  const row = await c.env.DB
    .prepare("SELECT image, image_type, image_key FROM posts WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .first();
  if (!row || !ALLOWED_TYPES.includes(row.image_type)) return c.notFound();

  let data;
  if (row.image_key) {
    // R2 のバインディングを外した後でも、D1 に残っている画像は表示できるようにする
    if (!c.env.IMAGES) return c.notFound();
    const obj = await c.env.IMAGES.get(row.image_key);
    if (!obj) return c.notFound();
    data = obj.body;
  } else if (row.image) {
    // D1 の BLOB は数値の配列で返ってくるため Uint8Array に戻す
    data = new Uint8Array(row.image);
  } else {
    return c.notFound();
  }

  return c.body(data, 200, {
    "Content-Type": row.image_type,
    "Cache-Control": "private, max-age=3600",
  });
});

app.notFound((c) => c.text("Not Found", 404));

app.onError((err, c) => {
  console.error(err);
  return c.text("エラーが発生しました。時間をおいて再度お試しください。", 500);
});

export default app;

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = await res.json();
  return data.success === true;
}

function redirectWithError(c, message) {
  return c.redirect("/?error=" + encodeURIComponent(message), 303);
}

// hono/html の html`` は埋め込んだ値を自動でエスケープする（XSS 対策）
function Page({ posts, user, error, siteKey }) {
  const items = posts.map((p) => html`
    <article class="post">
      <h2>${p.title}</h2>
      <p class="meta">${p.created_at}${p.author ? html` ・ ${p.author}` : ""}</p>
      ${p.has_image ? html`<img src="/images/${p.id}" alt="" loading="lazy">` : ""}
      <p class="body">${p.body}</p>
    </article>`);

  return html`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ほのぼの日記</title>
${siteKey ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}
<style>
  :root { --bg:#fffaf3; --card:#fff; --ink:#4a3f35; --soft:#8c7b6b; --accent:#e8875b; --line:#f0e3d4; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family: "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif; line-height:1.7; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 64px; }
  header { display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; }
  h1 { font-size: 1.6rem; margin: 0; }
  .user { font-size: .85rem; color: var(--soft); }
  form, .post { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-top: 16px; }
  label { display:block; font-size:.9rem; margin-top: 10px; }
  input[type=text], textarea { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:10px; font:inherit; }
  textarea { min-height: 100px; }
  button { margin-top: 12px; background: var(--accent); color:#fff; border:0; border-radius: 999px; padding: 8px 20px; font:inherit; cursor:pointer; }
  .error { background:#fde8e4; color:#a33a22; border-radius:10px; padding:8px 12px; margin-top:16px; }
  .post h2 { font-size: 1.15rem; margin: 0; }
  .meta { color: var(--soft); font-size:.8rem; margin: 2px 0 8px; }
  .post img { max-width:100%; border-radius: 12px; display:block; }
  .body { white-space: pre-wrap; margin: 8px 0 0; }
</style>
</head>
<body>
<main>
  <header>
    <h1>🌱 ほのぼの日記</h1>
    <span class="user">${user ? `ログイン中：${user}` : "ログインしていません（Access 未設定）"}</span>
  </header>
  ${error ? html`<p class="error">${error}</p>` : ""}
  <form id="post-form" method="post" action="/posts" enctype="multipart/form-data">
    <label>タイトル<input type="text" name="title" maxlength="${MAX_TITLE}" required></label>
    <label>本文<textarea name="body" maxlength="${MAX_BODY}" required></textarea></label>
    <label>画像（任意・1MB まで。大きい画像は自動で縮小します）<input type="file" name="image" accept="image/*"></label>
    ${siteKey ? html`<div class="cf-turnstile" data-sitekey="${siteKey}" style="margin-top:12px"></div>` : ""}
    <button type="submit">投稿する</button>
  </form>
  ${items.length ? items : html`<p class="meta">まだ日記がありません。</p>`}
</main>
<script>
// 1MB を超える画像はブラウザ側で縮小してから送る（スマホの写真対策）
document.getElementById("post-form").addEventListener("submit", async (e) => {
  const input = e.target.querySelector('input[name="image"]');
  const file = input.files[0];
  if (!file || file.size <= ${MAX_IMAGE_BYTES}) return;
  e.preventDefault();
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "image.jpg", { type: "image/jpeg" }));
  input.files = dt.files;
  e.target.submit();
});
</script>
</body>
</html>`;
}
