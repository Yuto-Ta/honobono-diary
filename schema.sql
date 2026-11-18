-- ほのぼの日記のテーブル
-- IF NOT EXISTS：誤って2回実行しても既存のデータを消さないため（第1回の DB にそのまま実行しても comments だけ増える）

-- 日記。画像は D1 に直接保存する（image）。R2 を使う場合は image_key にオブジェクトのキーが入る
CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  author     TEXT,
  image      BLOB,
  image_type TEXT,
  image_key  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

-- コメント。誰でも書ける（Turnstile で Bot を弾く）
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  name       TEXT,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);

-- 最初の日記（日記が1件も無いときだけ入れる）
INSERT INTO posts (title, body, author)
SELECT 'はじめての日記', 'Cloudflare 勉強会でほのぼの日記を作りました。' || char(10) || '管理画面から日記を書き、読んだ人はコメントできます。', '講師'
WHERE NOT EXISTS (SELECT 1 FROM posts);
