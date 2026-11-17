// 画像の保存先の切り替え
//   R2 をバインド（env.IMAGES）していれば R2 に、していなければ D1 の posts.image に保存する
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./config.js";

/** フォームの file 入力から、画像として受け付けるものだけを返す。未選択なら null */
export function pickImage(form) {
  const file = form.get("image");
  if (!file || typeof file !== "object" || file.size === 0) return { file: null };
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return { error: "画像は JPEG / PNG / GIF / WebP のみ投稿できます。" };
  if (file.size > MAX_IMAGE_BYTES) return { error: "画像は 1MB までです。" };
  return { file };
}

/** 画像を保存し、posts テーブルに入れる列の値を返す */
export async function storeImage(env, file) {
  if (env.IMAGES) {
    const key = `posts/${crypto.randomUUID()}`;
    await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    return { image: null, image_type: file.type, image_key: key };
  }
  return { image: await file.arrayBuffer(), image_type: file.type, image_key: null };
}

/** R2 に置いた画像を消す（D1 に保存した画像は行と一緒に消えるので何もしない） */
export async function removeStoredImage(env, imageKey) {
  if (!imageKey || !env.IMAGES) return;
  try {
    await env.IMAGES.delete(imageKey);
  } catch (err) {
    // 記事の更新・削除は済んでいるので、ここでは失敗させない（R2 に不要な画像が残るだけ）
    console.error("R2 の画像を削除できませんでした", imageKey, err);
  }
}

/** GET /images/:id の中身。見つからなければ null */
export async function loadImage(env, id) {
  const row = await env.DB
    .prepare("SELECT image, image_type, image_key FROM posts WHERE id = ?")
    .bind(id)
    .first();
  if (!row || !ALLOWED_IMAGE_TYPES.includes(row.image_type)) return null;

  if (row.image_key) {
    // R2 のバインディングを外した後でも、D1 に残っている画像は表示できるようにする
    if (!env.IMAGES) return null;
    const obj = await env.IMAGES.get(row.image_key);
    return obj ? { data: obj.body, type: row.image_type } : null;
  }
  if (row.image) {
    // D1 の BLOB は数値の配列で返ってくるため Uint8Array に戻す
    return { data: new Uint8Array(row.image), type: row.image_type };
  }
  return null;
}
