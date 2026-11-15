# 窓カレンダー

Google カレンダーを、閲覧者ごとに見せる範囲を変えて共有する Web アプリ。要件は [docs/requirements.md](docs/requirements.md)、設計は [docs/design.md](docs/design.md) を参照。

## 必要なもの

- Node.js 22 以降
- 本番にデプロイするときは Cloudflare のアカウント

## ローカルで動かす（Google につながないフェイクモード）

```sh
npm install
cp .dev.vars.example .dev.vars
# .dev.vars の ENCRYPTION_KEY に、次のコマンドの出力を入れる
openssl rand -base64 32
npm run db:migrate:local
npm run dev
```

- 管理画面：起動時に表示される URL（ふつうは <http://localhost:5173>。使用中なら別の番号になる）の `/admin`。「Google でログイン」を押すと、`.dev.vars` の `OPERATOR_EMAIL`（運営者）でそのままログインする。ほかのオーナーとして試すときは、運営者の「オーナー」タブでアドレスを追加し、ログイン画面の「アカウントを指定してログイン」にそのアドレスを入れる
- 閲覧画面：管理画面で閲覧者を追加し、表示される招待 URL を開く
- フェイクのカレンダーは、管理画面の「カレンダー」タブで選ぶと使える
- ローカルのデータベースを空にするときは `.wrangler/state` を消して、`npm run db:migrate:local` からやり直す

## テスト・型チェック

```sh
npm test            # 単体テストと API の結合テスト
npm run typecheck   # Worker・画面・テストの型チェック
```

## ローカルで本物の Google カレンダーを使う

1. Google Cloud で次を用意する。
   - Google Calendar API を有効にする
   - OAuth 同意画面を作り、公開ステータスを「本番（In production）」にする（テスト中のままだと、リフレッシュトークンが7日で失効する）
   - OAuth クライアント（種類は「ウェブ アプリケーション」）を作り、承認済みのリダイレクト URI に `http://localhost:5173/auth/callback` と `https://mado-cal.yuki-hiraishi.com/auth/callback` を加える
2. `.dev.vars` を次のようにする。

   ```sh
   CALENDAR_SOURCE=google
   OPERATOR_EMAIL=<運営者の Google アカウント>
   GOOGLE_CLIENT_ID=<クライアント ID>
   GOOGLE_CLIENT_SECRET=<クライアント シークレット>
   ```

3. `npm run dev -- --port 5173 --strictPort` で起動し、管理画面からログインする（リダイレクト URI と合わせるため、ポートを固定する）。

## 本番にデプロイする

```sh
npx wrangler login
npx wrangler d1 create mado-calendar
# 表示された database_id を wrangler.jsonc の d1_databases[0].database_id に書く
npm run db:migrate:remote

npx wrangler secret put ENCRYPTION_KEY       # openssl rand -base64 32 の出力
npx wrangler secret put OPERATOR_EMAIL      # 運営者の Google アカウント
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

npm run deploy
```

- Cloudflare のダッシュボードで、`yuki-hiraishi.com` の「SSL/TLS → エッジ証明書 → Always Use HTTPS」を有効にする（画面のファイルを http で配信させないため。[公式ドキュメント](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)）。
- `ENCRYPTION_KEY` を変えると、保存済みの閲覧者 ID とリフレッシュトークンを復号できなくなる。変えたら、閲覧者 ID の再発行と管理画面へのログインをやり直す。
- 独自ドメイン（`mado-cal.yuki-hiraishi.com`）は `wrangler.jsonc` の `routes` で設定している。

## その他のコマンド

```sh
npm run cf-typegen        # wrangler.jsonc を変えたあと、Workers の型を作り直す
node scripts/gen-icons.mjs  # ホーム画面用のアイコンを作り直す
```
