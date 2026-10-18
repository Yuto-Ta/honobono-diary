# 🌱 ほのぼの日記

Cloudflare 勉強会用のサンプルアプリです。タイトル・本文・画像で日記を投稿できます。

- **Cloudflare Workers** で動く Web アプリ。フレームワークは **Hono**（Workers でよく使われる軽量フレームワーク）、コードは `src/index.js` の1ファイル
- **D1**（Cloudflare の SQL データベース）に日記と画像を保存
- **Turnstile**（Bot 対策）を設定すると、投稿フォームを Bot から守れる
- 講師デモ用に **Cloudflare Access**（ログイン画面）と **R2**（画像ストレージ）にも対応

## 事前準備

| 必要なもの | 確認コマンド |
|---|---|
| Cloudflare の無料アカウント | https://dash.cloudflare.com/sign-up |
| workers.dev のサブドメイン | ダッシュボードの Compute → Workers & Pages で登録（下記） |
| Node.js 20 以上 | `node --version` |
| pnpm | `pnpm --version`（無ければ `npm install -g pnpm`） |
| git | `git --version` |
| cloudflared（ハンズオン③で使用） | `cloudflared --version` |

### workers.dev のサブドメインは前日までに登録する

アカウントごとに1つ、`https://<名前>.workers.dev` の名前を登録します。**登録してから数分間は SSL 証明書の準備中でアクセスできない**ため、当日ではなく事前に済ませてください。

- 名前は公開 URL に出ます。会社名・クライアント名・フルネームは避けてください（例：`my-cf-study`）
- 未登録のままデプロイすると「Would you like to register a workers.dev subdomain now?」と聞かれます。Y を押して名前を入れれば登録できます
- 後から変更できます

## ① デプロイする

DB はダッシュボード（コンソール）で作り、コードのデプロイだけ CLI で行います。

**1. 取得して依存パッケージを入れる（ターミナル）**

```bash
git clone <このリポジトリの URL>
cd honobono-diary
pnpm install
pnpm wrangler login   # ブラウザが開くので「Allow」
```

> `pnpm install` 中に esbuild と workerd のインストールスクリプトが動きます（`pnpm-workspace.yaml` で許可済み）。

**2. D1 データベースを作る（ダッシュボード）**

1. Storage & databases → **D1 SQLite Database** → Create。名前は `honobono-db`
2. Overview に表示されたデータベース ID を横のコピーボタンでコピーし、`wrangler.jsonc` の `REPLACE_WITH_YOUR_DATABASE_ID` と置き換えて保存
3. **Console** タブに `schema.sql` の中身を貼って実行（3文まとめて実行できます）
4. 右上の **Explore Data** を押すと Studio が開きます。`posts` テーブルに「はじめての日記」が1件見えれば OK

**3. デプロイ（ターミナル）**

```bash
pnpm run deploy
#  → https://honobono-diary.<あなたのサブドメイン>.workers.dev が表示される
```

日記を投稿したら、Studio を更新して行が増えることも確認してみてください。

> `pnpm deploy` は pnpm 自身の別コマンドなので、必ず `pnpm run deploy` と打ってください。

<details>
<summary>手順2を CLI で行う場合</summary>

```bash
pnpm wrangler d1 create honobono-db
#  → 表示された database_id を wrangler.jsonc に貼る
pnpm db:init
```

`d1 create` で「設定ファイルに追記しますか？」と聞かれたら **No** を選んでください。Yes を選ぶとバインディング名が `honobono_db` で追記され、アプリが使う `DB` と一致しません。
</details>

## ② Turnstile で投稿フォームを Bot から守る

**1. ウィジェットを作る（ダッシュボード）**

1. Application security → **Turnstile** → Add widget
2. Widget name：`honobono-diary`
3. Hostnames：`honobono-diary.<あなたのサブドメイン>.workers.dev` を**最後まで入力して Enter**（「No results」と出ても追加できます）
4. Widget Mode：Managed（Recommended）のまま作成
5. **サイトキー**（公開してよい）と**シークレットキー**（秘密）が表示される

**2. キーをアプリに設定する**

- サイトキー → `wrangler.jsonc` の `"TURNSTILE_SITE_KEY": ""` の `""` の中に貼る
- シークレットキー → ダッシュボードの Compute → Workers & Pages → `honobono-diary` → Settings → Variables and Secrets → Add
  - Type：**Secret**（Text ではなく）
  - Variable name：`TURNSTILE_SECRET_KEY`

**3. もう一度デプロイ（ターミナル）**

```bash
pnpm run deploy
```

サイトキーを貼っただけでは反映されません。デプロイすると、投稿フォームに Turnstile が表示されます。

**4. 動作確認**

```bash
# ブラウザを使わずに直接投稿する「Bot のふり」
curl -i -F title=bot -F body=bot https://honobono-diary.<あなたのサブドメイン>.workers.dev/posts
#  → Location: /?error=Bot%20... となり、投稿されなければ成功
```

> サイトキーだけ設定してシークレットキーを登録し忘れると、「Bot 対策（Turnstile）の設定が完了していないため、投稿できません。」と表示されて投稿できません。画面には Turnstile が出ているのに守られていない、という状態を防ぐためです。

## ③ ローカルで動かして Tunnel で公開する

```bash
# ローカル用の DB を初期化して起動（http://localhost:8787）
pnpm db:init:local
pnpm dev

# 別のターミナルで
cloudflared tunnel --url http://localhost:8787
#  → https://xxxx.trycloudflare.com をスマホで開く
```

> Quick Tunnel の URL には認証が付きません。URL を知っている人は誰でも投稿できます。使い終わったら Ctrl + C で止めてください。
>
> `pnpm dev` では、Turnstile に Cloudflare 公式のテスト用キー（どのホスト名でも動き、常に通過する）が自動で使われます。本物のサイトキーは登録したホスト名でしか動かないためです。

## 講師デモ：Cloudflare Access でログイン画面を付ける

> Access（Zero Trust / Cloudflare One）は、無料プランでも**支払い方法の登録が必要**です。

1. 左メニューの Zero Trust → Get started で初期設定（Free プランを選択。チーム名は自動で付き、後から変更できる）
2. Compute → Workers & Pages → `honobono-diary` で Access の設定を開く（Manage Worker access）
3. Scope：**All traffic**（既定の Previews only では公開 URL が守られない）
4. Authentication policy：例）Email domain = 会社のドメイン → Allow
5. Apply Access
6. シークレットウィンドウで URL を開く → メールに届くコードでログイン → 右上に「ログイン中：（メールアドレス）」

Access を有効にすると、ログインしていないリクエストは Worker に届く前にログイン画面へ転送されます（curl なら `302`）。

### Turnstile のテスト用キー

Bot と判定されて弾かれる様子を確実に見せたいときは、Cloudflare 公式のテスト用キーを使います（公式ドキュメント「Turnstile → Testing」）。

| 用途 | 値 |
|---|---|
| サイトキー（常に通過） | `1x00000000000000000000AA` |
| シークレットキー（常に成功） | `1x0000000000000000000000000000000AA` |
| シークレットキー（常に失敗） | `2x0000000000000000000000000000000AA` |

## 付録：画像の保存先を R2 に変える

D1 は1行あたりのサイズに上限があるため、本アプリは画像を 1MB までに制限しています。実務では画像を R2（S3 互換のオブジェクトストレージ）に置くのが一般的です。

> R2 は無料枠でも、事前に支払い方法の登録が必要です。

```bash
# 1. バケットを作る
pnpm wrangler r2 bucket create honobono-images

# 2. wrangler.jsonc の r2_buckets のコメントを外す（binding は IMAGES）

# 3. デプロイ
pnpm run deploy
```

- コードの変更は不要です。`env.IMAGES` がバインドされていれば、新しい画像は R2 に保存されます
- それまでに D1 に保存した画像も、引き続き表示されます

## 仕組み

| パス | 内容 |
|---|---|
| `GET /` | 日記の一覧と投稿フォーム |
| `POST /posts` | 日記の投稿（multipart/form-data） |
| `GET /images/:id` | 画像の取得（D1 または R2 から） |

- 入力チェック：タイトル100文字・本文2000文字まで、画像は JPEG / PNG / GIF / WebP の 1MB まで
- 1MB を超える画像は、ブラウザ側で自動的に縮小してから送信する
- SQL はすべてプレースホルダ（`?` と `bind`）で値を渡している
- 画面は `hono/html` の `html` テンプレートで組み立てており、埋め込んだ値は自動でエスケープされる（XSS 対策）
- `hono/secure-headers` ミドルウェアで、X-Frame-Options などのセキュリティヘッダーを付けている

## 注意（勉強会用サンプルとしての割り切り）

- ログイン中のユーザーは、Access が付与するヘッダ `Cf-Access-Authenticated-User-Email` を**そのまま表示しているだけ**です。Access を有効にしていない URL では、このヘッダを誰でも偽装できます。本番では `Cf-Access-Jwt-Assertion` の JWT を検証してください
- 編集・削除の機能はありません。投稿を消すときは D1 の Studio で行を選んで Delete row するか、Console で SQL を実行してください
- 認証を付けずに公開している間は、誰でも投稿できます

## 後片付け

```bash
pnpm wrangler delete                       # Worker を削除
pnpm wrangler d1 delete honobono-db        # D1 を削除
pnpm wrangler r2 bucket delete honobono-images   # R2 を使った場合
```

Turnstile のウィジェットと Access の設定は、ダッシュボードから削除します。
