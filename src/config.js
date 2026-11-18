// 入力の上限（画面の maxlength とサーバー側のチェックの両方で使う）
export const MAX_TITLE = 100;
export const MAX_BODY = 2000;
export const MAX_COMMENT_NAME = 30;
export const MAX_COMMENT_BODY = 500;

// D1 の1行あたりの上限に余裕を持たせて 1MB（R2 を使う場合も同じ上限にそろえる）
export const MAX_IMAGE_BYTES = 1024 * 1024;
// SVG はスクリプトを埋め込めるため受け付けない
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Basic 認証のパスワードの最低文字数（短いパスワードのまま公開しないため）
export const MIN_ADMIN_PASSWORD = 12;
