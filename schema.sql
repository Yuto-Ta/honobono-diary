-- ほのぼの日記のテーブル
-- 画像は D1 に直接保存する（image）。R2 を使う場合は image_key にオブジェクトのキーが入る
-- IF NOT EXISTS：誤って2回実行しても既存の日記を消さないため
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

INSERT INTO posts (title, body, author) VALUES
  ('はじめての日記', 'Cloudflare 勉強会でほのぼの日記を作りました。', '講師');
