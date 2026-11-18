# 🌱 ほのぼの日記

Cloudflare 勉強会用のサンプルアプリです。管理画面から日記（タイトル・本文・画像）を書き、公開サイトでは誰でも日記を読んでコメントできます。

| 使うもの | 役割 |
|---|---|
| **Workers** | Web アプリ本体。フレームワークは **Hono**（Workers でよく使われる軽量フレームワーク） |
| **D1** | 日記とコメントを保存する SQL データベース |
| **R2** | 画像の保存先（S3 互換のストレージ）。使わない場合は画像も D1 に保存する |
| **Turnstile** | コメント欄を Bot から守る |
| **Access** | 管理画面にログインを付ける（手元で動かすときは Basic 認証） |

## 構成

同じコードを、**公開サイト**と**管理画面**の2つの Worker としてデプロイします。D1 と R2 は2つで共有します。

```
誰でも ──▶ honobono-diary（公開サイト）      ──┐
           一覧・詳細・コメント（Turnstile）    ├──▶ D1（日記・コメント）／ R2（画像）
管理者 ──▶ honobono-diary-admin（管理画面）  ──┘
           Access で保護
```

Access は Worker（ホスト名）単位でかかるため、管理画面を別の Worker に分けています。管理画面を別のホスト名に分けるのは、実務でもよく使う構成です。

## カード登録について

R2 と Access（Zero Trust）は、無料枠の範囲でも**支払い方法（カードなど）の登録が必要**です。

| | カードを登録した人 | 登録していない人 |
|---|---|---|
| ① 公開サイト（Workers・D1） | 自分で | 自分で |
| ② 管理画面（Access・R2） | 自分で | 講師の画面を見る |
| ③ コメント欄（Turnstile） | 自分で | 自分で |

## 事前準備

| 必要なもの | 確認コマンド |
|---|---|
| Cloudflare の無料アカウント | https://dash.cloudflare.com/sign-up |
| workers.dev のサブドメイン名 | 名前だけ決めておく（登録は最初のデプロイ時） |
| Node.js 20 以上 | `node --version` |
| pnpm | `pnpm --version`（無ければ `npm install -g pnpm`） |
| git | `git --version` |
| （② を自分でやる人）支払い方法の登録 | ダッシュボードの Billing |

### workers.dev のサブドメイン

アカウントごとに1つ、`https://<名前>.workers.dev` の名前を登録します。最初の `pnpm run deploy` で「Would you like to register a workers.dev subdomain now?」と聞かれるので、Y を押して名前を入れます。

- 名前は公開 URL に出ます。会社名・クライアント名・フルネームは避けてください（例：`my-cf-study`）
- **登録してから数分間は SSL 証明書の準備中でアクセスできません**（ブラウザでは SSL エラー）。少し待てばつながります

## ① 公開サイトをデプロイする

**1. 取得して依存パッケージを入れる（ターミナル）**

```bash
git clone https://github.com/Yuto-Ta/honobono-diary.git
cd honobono-diary
pnpm install
pnpm wrangler login   # ブラウザが開くので「Allow」→ Successfully logged in.
pnpm wrangler whoami  # ログインしたアカウントのメールが表示される
```

> `whoami` のメールが、ダッシュボード左上のアカウントと同じか確認してください。違うと別のアカウントにデプロイされます。その場合は `pnpm wrangler logout` してから、正しいアカウントで `login` し直します。

> 前回 clone した人は、`git pull` で最新にしてください。
>
> 「Your local changes to the following files would be overwritten by merge: wrangler.jsonc」で止まったら、前回貼ったデータベース ID が原因です。`git diff wrangler.jsonc` で `database_id` の値を控えてから、`git restore wrangler.jsonc && git pull` で最新にし、次の手順 2 で ID を貼り直してください（ID はダッシュボードでも確認できます）。

**2. D1 データベースを作る（ダッシュボード）**

1. Storage & databases → **D1 SQLite Database** → Create。名前は `honobono-db`、Data location は既定のまま
2. 一覧で `honobono-db` をクリックし、Overview に表示されたデータベース ID をコピーする。`wrangler.jsonc` の `REPLACE_WITH_YOUR_DATABASE_ID` **2か所**（公開サイト用と管理画面用）と置き換えて保存
3. 同じ `honobono-db` の画面の右上にある **Explore Data** で Studio を開く
4. ターミナルで `pbcopy < schema.sql` を実行して `schema.sql` の中身をコピーし、Studio の Query の欄で ⌘V
5. Run の右の **▼ → Run all in sequence** で実行。Run をそのまま押すと、カーソルがある1文しか実行されません
6. 左の一覧の更新ボタン（🔄）を押して、`posts` と `comments` があれば OK。`sqlite_sequence` も表示されますが、SQLite が連番（AUTOINCREMENT）の管理に自動で作るものなので気にしなくて大丈夫です

> 前回作った `honobono-db` が残っている人は、作り直さずに `schema.sql` をもう一度実行すれば `comments` テーブルが増えます（既存の日記は消えません）。

**3. デプロイ（ターミナル）**

```bash
pnpm run deploy
#  → 初回はサブドメインの登録を聞かれる（Y → 名前を入力）
#  → https://honobono-diary.<あなたのサブドメイン>.workers.dev が表示される
```

URL を開いて「はじめての日記」が表示され、クリックすると詳細とコメント欄が出れば OK です。

> `pnpm deploy` は pnpm 自身の別コマンドなので、必ず `pnpm run deploy` と打ってください。

## ② 管理画面を作る

**1. 管理画面をデプロイ（ターミナル）**

```bash
pnpm run deploy:admin
#  → https://honobono-diary-admin.<あなたのサブドメイン>.workers.dev が表示される
```

この時点で開くと「管理画面の認証が設定されていません」と表示されます。**ログインの仕組みを設定するまでは、誰も管理画面を使えない**ようにしてあります。

**2. Access でログインを付ける**

1. 左メニューの **Zero Trust** → **Overview** で初期設定（支払い方法の登録を求められます。チーム名は自動で付きます）
2. Compute → Workers & Pages → **`honobono-diary-admin`**（公開サイトではなく管理画面の方）→ **Access** タブ
3. Scope：**All traffic**（既定の Previews only では本番の URL が守られない）
4. Authentication policy：Add policy → **Cloudflare account**（この Cloudflare アカウントのメンバー＝自分だけが入れる）
5. 保存すると、同じページの **Application values** に値が表示される。そのうち2つを `wrangler.jsonc` の管理画面側（`env.admin.vars`）にそのまま貼る
   - **JWKS**（`https://<チーム名>.cloudflareaccess.com/cdn-cgi/access/certs`）→ `ACCESS_JWKS_URL`
   - **AUD**（長い英数字）→ `ACCESS_AUD`
6. もう一度デプロイ：`pnpm run deploy:admin`
7. シークレットウィンドウで管理画面の URL を開く → Cloudflare のログイン画面でログイン → 右上に「ログイン中：（メールアドレス）」

> AUD は Zero Trust → Access controls → Applications → 対象のアプリでも確認できます。
>
> Zero Trust の Settings でチーム名（`<チーム名>.cloudflareaccess.com`）を変えると、JWKS も変わります。変えた場合は貼り直して再デプロイしてください。

**なぜ値を貼るのか**：Access を通ったリクエストには、Access が署名した JWT（`Cf-Access-Jwt-Assertion` ヘッダー）が付きます。Worker は JWKS（Access の公開鍵の置き場所）から鍵を取ってきて署名を確かめ、発行元と宛先（AUD）も確認してから「ログイン済み」と判断します（`src/auth.js`）。ヘッダーはだれでも偽装できるので、署名を確かめずに信用してはいけません。

**パスワード（Basic 認証）との違い**：Basic 認証は「パスワードを知っている人は誰でも入れる」仕組みです。パスワードの共有・漏えい、総当たり攻撃、退職者の締め出し、ログイン履歴を、すべて自分で面倒を見る必要があります。Access ならこれらを Cloudflare 側（会社の Google アカウントや多要素認証との連携も含む）に任せられます。

**3. 日記を書く**

管理画面で「＋ 新しい日記を書く」→ タイトル・本文・画像を入れて「公開する」。公開サイトを開き直すと、一覧に出てきます。編集・削除も管理画面から行えます。

**4. 画像の保存先を R2 にする**

1. ダッシュボードの Storage & databases → **R2 Object Storage** → Create bucket
   - Bucket name：`honobono-images`（後から変更できません）
   - Location は Automatic、Default Storage Class は Standard のまま
   - バケットは非公開のまま（画像は Worker がバインディング経由で読み出す）
2. `wrangler.jsonc` の `r2_buckets` のコメントを**2か所**（公開サイト用と管理画面用）外す
3. 両方をデプロイ（出力に `env.IMAGES (honobono-images)` が出れば OK）

   ```bash
   pnpm run deploy
   pnpm run deploy:admin
   ```

これ以降に投稿した画像は R2 に保存されます。それまでに D1 に保存した画像も、引き続き表示されます。

## ③ Turnstile でコメント欄を Bot から守る

**1. まず Bot のふりをしてコメントしてみる（ターミナル）**

```bash
curl -F name=bot -F body=bot https://honobono-diary.<あなたのサブドメイン>.workers.dev/posts/1/comments
```

画面には何も出ませんが、ブラウザで「はじめての日記」を開くと「bot」のコメントが増えています。Bot から書き込み放題の状態です（増えたコメントは管理画面から削除できます）。

**2. ウィジェットを作る（ダッシュボード）**

1. Application security → **Turnstile** → Add widget
2. Widget name：`honobono-diary`
3. Hostnames：`honobono-diary.<あなたのサブドメイン>.workers.dev` を**最後まで入力して Enter**（「No results」と出ても追加できます）
4. Widget Mode：Managed（Recommended）のまま作成
5. **サイトキー**（公開してよい）と**シークレットキー**（秘密）が表示される

**3. キーをアプリに設定する**

- サイトキー → `wrangler.jsonc` の**公開サイト側**の `"TURNSTILE_SITE_KEY": ""` の `""` の中に貼る
- シークレットキー → Compute → Workers & Pages → **`honobono-diary`** → Settings → Variables and Secrets → Add
  - Type：**Secret**（Text ではなく）
  - Variable name：`TURNSTILE_SECRET_KEY`

**4. もう一度デプロイして確かめる（ターミナル）**

```bash
pnpm run deploy
curl -i -F name=bot -F body=bot https://honobono-diary.<あなたのサブドメイン>.workers.dev/posts/1/comments
#  → Location: /posts/1?error=Bot%20... となり、コメントが増えなければ成功
```

> デプロイ時に「The local configuration ... differs from the remote configuration」と聞かれたら **Y** で進めます。ダッシュボードでシークレットを登録したため、手元の設定で上書きしてよいかを確認しているだけです。Secret として登録した値は上書きされません。

> サイトキーだけ設定してシークレットキーを登録し忘れると、「Bot 対策（Turnstile）の設定が完了していないため、コメントできません。」と表示されます。画面には Turnstile が出ているのに守られていない、という状態を防ぐためです。

## 手元で動かす

```bash
pnpm db:init:local   # 手元用の D1 を作る（初回だけ）
pnpm dev             # http://localhost:8787
```

- 公開サイト：http://localhost:8787
- 管理画面：http://localhost:8787/admin（ユーザー名 `admin`、パスワード `local-dev-only-password`）

手元では1つのプロセスで両方を動かします（`APP_MODE=local` のときだけ、`/admin` から始まるパスを管理画面に回す）。Turnstile には Cloudflare 公式のテスト用キー（常に通過）が自動で使われます。

> Quick Tunnel（`cloudflared tunnel --url http://localhost:8787`）でスマホから見ることもできます。ただし URL を知っている人は誰でも管理画面のログイン画面に来られるので、使い終わったらすぐ Ctrl + C で止めてください。

### Turnstile のテスト用キー

Bot と判定されて弾かれる様子を確実に見せたいときは、公式のテスト用キーを使います（公式ドキュメント「Turnstile → Testing」）。

| 用途 | 値 |
|---|---|
| サイトキー（常に通過） | `1x00000000000000000000AA` |
| シークレットキー（常に成功） | `1x0000000000000000000000000000000AA` |
| シークレットキー（常に失敗） | `2x0000000000000000000000000000000AA` |

## 仕組み

| Worker | パス | 内容 |
|---|---|---|
| 公開サイト | `GET /` | 日記の一覧 |
| | `GET /posts/:id` | 日記の詳細とコメント |
| | `POST /posts/:id/comments` | コメントの投稿（Turnstile で検証） |
| 管理画面 | `GET /admin` | 日記の一覧と最近のコメント |
| | `GET /admin/posts/new`・`POST /admin/posts` | 日記の作成 |
| | `GET /admin/posts/:id/edit`・`POST /admin/posts/:id` | 日記の編集（画像の差し替え・削除） |
| | `POST /admin/posts/:id/delete` | 日記の削除（コメント・画像も一緒に） |
| | `POST /admin/comments/:id/delete` | コメントの削除 |
| 両方 | `GET /images/:id` | 画像（D1 または R2 から） |

| ファイル | 内容 |
|---|---|
| `src/index.js` | ルーティングと DB の読み書き |
| `src/auth.js` | 管理画面の認証（Access の JWT 検証・Basic 認証） |
| `src/images.js` | 画像の保存先の切り替え（R2 / D1） |
| `src/views.js` | 画面のテンプレート |
| `src/config.js` | 文字数・画像サイズなどの上限 |

セキュリティ上の工夫:

- **管理画面は「設定が無ければ開かない」**：Access もパスワードも未設定なら 503。設定漏れで管理画面が丸見えになるのを防ぐ
- **Access の JWT を検証**：署名・発行元（チームドメイン）・宛先（AUD）・有効期限を確かめる
- **CSRF 対策**：管理画面の POST は、Origin が自分自身のときだけ受け付ける（`hono/csrf`）
- **XSS 対策**：画面は `hono/html` で組み立て、埋め込んだ値を自動でエスケープする。画像は JPEG / PNG / GIF / WebP のみ（スクリプトを埋め込める SVG は拒否）
- **SQL インジェクション対策**：SQL はすべてプレースホルダ（`?` と `bind`）で値を渡す
- **個人情報**：投稿者（Access のメールアドレス）は管理画面にだけ表示し、公開サイトには出さない
- `hono/secure-headers` で X-Frame-Options などのセキュリティヘッダーを付ける

## 注意（勉強会用サンプルとしての割り切り）

- 日記は「公開」のみで、下書き・予約公開はありません。更新日時も記録しません
- コメントは承認制ではなく、投稿されるとすぐ表示されます（不適切なものは管理画面から削除）
- 画像は 1MB まで（R2 を使う場合も同じ）。大きい画像はブラウザ側で自動的に縮小してから送ります

## 後片付け

ダッシュボードで、次の順に削除します（Worker に紐づく設定を先に外し、消し漏れを防ぐため）。

1. `pnpm dev`・Tunnel を止める（Ctrl + C）
2. Access を外す：Workers & Pages → `honobono-diary-admin` → Access タブ → Remove。Zero Trust → Access controls の Applications・Policies に残っていないかも確認
3. Turnstile のウィジェットを削除：Application security → Turnstile
4. Worker を2つとも削除：Compute → Workers & Pages → `honobono-diary` と `honobono-diary-admin` → Settings → Delete（登録したシークレットも一緒に消える）
5. D1 を削除：Storage & databases → D1 SQLite Database → `honobono-db` → Settings → Delete
6. R2 を削除：R2 Object Storage → `honobono-images` を空にしてから削除

workers.dev のサブドメインは削除不要です（アカウントに1つで、次も使えます）。

<details>
<summary>Worker・D1・R2 を CLI で削除する場合</summary>

```bash
pnpm wrangler delete --env=                      # 公開サイト
pnpm wrangler delete --env admin                 # 管理画面
pnpm wrangler d1 delete honobono-db              # D1
pnpm wrangler r2 bucket delete honobono-images   # R2
```

Turnstile と Access はダッシュボードで削除してください。
</details>
