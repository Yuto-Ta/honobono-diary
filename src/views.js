// 画面のテンプレート
// hono/html の html`` は埋め込んだ値を自動でエスケープする（XSS 対策）。raw() は自分で書いた固定の文字列にだけ使う
import { html, raw } from "hono/html";
import { MAX_BODY, MAX_COMMENT_BODY, MAX_COMMENT_NAME, MAX_IMAGE_BYTES, MAX_TITLE } from "./config.js";

// ---------- 公開サイト ----------

export function PublicIndex({ posts }) {
  const items = posts.map((p) => html`
    <a class="card post-link" href="/posts/${p.id}">
      ${p.has_image ? html`<img src="/images/${p.id}" alt="" loading="lazy">` : ""}
      <h2>${p.title}</h2>
      <p class="meta">${p.created_at}・コメント ${p.comment_count} 件</p>
      <p class="excerpt">${p.excerpt}${p.body_length > p.excerpt.length ? "…" : ""}</p>
    </a>`);
  return Layout({
    title: "ほのぼの日記",
    children: html`
      ${items.length ? items : html`<p class="meta">まだ日記がありません。</p>`}`,
  });
}

export function PublicPost({ post, comments, error, siteKey }) {
  const list = comments.map((cm) => html`
    <li class="comment">
      <p class="meta">${cm.name || "名無しさん"}・${cm.created_at}</p>
      <p class="body">${cm.body}</p>
    </li>`);
  return Layout({
    title: `${post.title} - ほのぼの日記`,
    siteKey,
    children: html`
      <p><a href="/">← 日記の一覧</a></p>
      <article class="card">
        <h1 class="post-title">${post.title}</h1>
        <p class="meta">${post.created_at}</p>
        ${post.has_image ? html`<img src="/images/${post.id}" alt="">` : ""}
        <p class="body">${post.body}</p>
      </article>

      <section class="card" id="comments">
        <h2>コメント（${comments.length} 件）</h2>
        ${list.length ? html`<ul class="comments">${list}</ul>` : html`<p class="meta">まだコメントはありません。</p>`}
        ${ErrorBox(error)}
        <form method="post" action="/posts/${post.id}/comments">
          <label>お名前（任意）<input type="text" name="name" maxlength="${MAX_COMMENT_NAME}"></label>
          <label>コメント<textarea name="body" maxlength="${MAX_COMMENT_BODY}" required></textarea></label>
          ${siteKey ? html`<div class="cf-turnstile" data-sitekey="${siteKey}"></div>` : ""}
          <button type="submit">コメントする</button>
        </form>
      </section>`,
  });
}

// ---------- 管理画面 ----------

export function AdminIndex({ posts, comments, user, notice }) {
  const rows = posts.map((p) => html`
    <tr>
      <td>${p.id}</td>
      <td><a href="/admin/posts/${p.id}/edit">${p.title}</a></td>
      <td>${p.has_image ? "あり" : ""}</td>
      <td>${p.comment_count}</td>
      <td class="nowrap">${p.created_at}</td>
    </tr>`);
  const recent = comments.map((cm) => html`
    <li class="comment">
      <p class="meta">「<a href="/admin/posts/${cm.post_id}/edit">${cm.post_title}</a>」へ・${cm.name || "名無しさん"}・${cm.created_at}</p>
      <p class="body">${cm.body}</p>
      ${DeleteCommentButton(cm.id)}
    </li>`);
  return Layout({
    title: "管理画面 - ほのぼの日記",
    admin: true,
    user,
    children: html`
      ${notice ? html`<p class="notice">${notice}</p>` : ""}
      <p><a class="button" href="/admin/posts/new">＋ 新しい日記を書く</a></p>
      <section class="card">
        <h2>日記</h2>
        ${rows.length ? html`
          <table>
            <thead><tr><th>ID</th><th>タイトル</th><th>画像</th><th>コメント</th><th>投稿日時</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>` : html`<p class="meta">まだ日記がありません。</p>`}
      </section>
      <section class="card">
        <h2>最近のコメント</h2>
        ${recent.length ? html`<ul class="comments">${recent}</ul>` : html`<p class="meta">コメントはありません。</p>`}
      </section>`,
  });
}

/** 新規作成と編集で共通のフォーム。post.id があれば編集 */
export function AdminPostForm({ post = {}, comments = [], user, error }) {
  const editing = Boolean(post.id);
  const list = comments.map((cm) => html`
    <li class="comment">
      <p class="meta">${cm.name || "名無しさん"}・${cm.created_at}</p>
      <p class="body">${cm.body}</p>
      ${DeleteCommentButton(cm.id)}
    </li>`);
  return Layout({
    title: `${editing ? "日記を編集" : "新しい日記"} - 管理画面`,
    admin: true,
    user,
    children: html`
      <p><a href="/admin">← 管理画面のトップ</a></p>
      ${ErrorBox(error)}
      <form class="card" method="post" action="${editing ? `/admin/posts/${post.id}` : "/admin/posts"}" enctype="multipart/form-data">
        <h2>${editing ? `日記を編集（ID ${post.id}）` : "新しい日記"}</h2>
        <label>タイトル<input type="text" name="title" maxlength="${MAX_TITLE}" value="${post.title ?? ""}" required></label>
        <label>本文<textarea name="body" maxlength="${MAX_BODY}" required>${post.body ?? ""}</textarea></label>
        ${editing && post.has_image ? html`
          <div class="current-image">
            <p class="meta">今の画像</p>
            <img src="/images/${post.id}" alt="">
            <label class="inline"><input type="checkbox" name="remove_image" value="1"> 画像を外す</label>
          </div>` : ""}
        <label>${editing && post.has_image ? "画像を差し替える" : "画像"}（任意・1MB まで。大きい画像は自動で縮小します）
          <input type="file" name="image" accept="image/*"></label>
        <button type="submit">${editing ? "更新する" : "公開する"}</button>
        ${editing ? html`<span class="meta">　更新日時は記録しません</span>` : ""}
      </form>
      ${editing ? html`
        <section class="card">
          <h2>この日記へのコメント（${comments.length} 件）</h2>
          ${list.length ? html`<ul class="comments">${list}</ul>` : html`<p class="meta">コメントはありません。</p>`}
        </section>
        <form class="card danger" method="post" action="/admin/posts/${post.id}/delete"
              onsubmit="return confirm('この日記とコメントを削除します。元に戻せません。');">
          <h2>日記を削除</h2>
          <p class="meta">コメントと画像も一緒に削除されます。</p>
          <button type="submit" class="danger">削除する</button>
        </form>` : ""}`,
  });
}

function DeleteCommentButton(id) {
  return html`
    <form method="post" action="/admin/comments/${id}/delete" class="inline-form"
          onsubmit="return confirm('このコメントを削除します。');">
      <button type="submit" class="small danger">コメントを削除</button>
    </form>`;
}

function ErrorBox(error) {
  return error ? html`<p class="error">${error}</p>` : "";
}

// ---------- 共通レイアウト ----------

function Layout({ title, admin = false, user, siteKey, children }) {
  return html`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${admin ? html`<meta name="robots" content="noindex">` : ""}
${siteKey ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}
<style>${raw(CSS)}</style>
</head>
<body class="${admin ? "admin" : ""}">
<main>
  <header>
    <a class="brand" href="${admin ? "/admin" : "/"}">🌱 ほのぼの日記${admin ? " 管理画面" : ""}</a>
    ${admin ? html`<span class="user">ログイン中：${user}</span>` : ""}
  </header>
  ${children}
</main>
${raw(RESIZE_SCRIPT)}
</body>
</html>`;
}

const CSS = `
  :root { --bg:#fffaf3; --card:#fff; --ink:#4a3f35; --soft:#8c7b6b; --accent:#e8875b; --line:#f0e3d4; --danger:#c0492b; }
  body.admin { --bg:#f4f6f5; --accent:#2f7d6d; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family: "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif; line-height:1.7; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
  header { display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom: 8px; }
  a { color: var(--accent); }
  .brand { font-size: 1.5rem; font-weight: bold; color: var(--ink); text-decoration: none; }
  .user { font-size: .85rem; color: var(--soft); }
  .card { display:block; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-top: 16px; }
  .post-link { color: inherit; text-decoration: none; }
  .post-link:hover { border-color: var(--accent); }
  .card h2 { font-size: 1.15rem; margin: 0 0 4px; }
  .post-title { font-size: 1.4rem; margin: 0; }
  .card img, .current-image img { max-width:100%; border-radius: 12px; display:block; margin: 8px 0; }
  .meta { color: var(--soft); font-size:.8rem; margin: 2px 0 8px; }
  .body { white-space: pre-wrap; margin: 8px 0 0; }
  .excerpt { margin: 4px 0 0; }
  label { display:block; font-size:.9rem; margin-top: 10px; }
  label.inline { display:flex; gap: 6px; align-items:center; }
  input[type=text], textarea { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:10px; font:inherit; background:#fff; }
  textarea { min-height: 120px; }
  .cf-turnstile { margin-top: 12px; }
  button, .button { display:inline-block; margin-top: 12px; background: var(--accent); color:#fff; border:0; border-radius: 999px; padding: 8px 20px; font:inherit; cursor:pointer; text-decoration:none; }
  button.small { padding: 2px 12px; font-size: .8rem; margin-top: 4px; }
  button.danger { background: var(--danger); }
  .card.danger { border-color: #f1c9bf; }
  .inline-form { margin: 0; }
  .error { background:#fde8e4; color:#a33a22; border-radius:10px; padding:8px 12px; margin-top:16px; }
  .notice { background:#e3f2ec; color:#1f5c4f; border-radius:10px; padding:8px 12px; margin-top:16px; }
  .comments { list-style: none; padding: 0; margin: 0; }
  .comment { border-top: 1px solid var(--line); padding: 8px 0; }
  table { width:100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align:left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .nowrap { white-space: nowrap; }
`;

// 1MB を超える画像はブラウザ側で縮小してから送る（スマホの写真対策）
const RESIZE_SCRIPT = `<script>
document.querySelectorAll('form[enctype="multipart/form-data"]').forEach((form) => {
  form.addEventListener("submit", async (e) => {
    const input = form.querySelector('input[name="image"]');
    const file = input && input.files[0];
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
    form.submit();
  });
});
</script>`;
