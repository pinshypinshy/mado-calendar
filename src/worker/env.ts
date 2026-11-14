// Worker の環境変数・バインディング。
// Secret（ENCRYPTION_KEY など）は本番では `wrangler secret put`、ローカルでは .dev.vars で渡す。

export interface AppEnv {
  DB: D1Database;
  /** "google"（本番）または "fake"（ローカル開発用。localhost 以外では起動しない） */
  CALENDAR_SOURCE: string;
  /** 管理画面に入れるメールアドレス */
  ADMIN_EMAIL: string;
  /** 暗号鍵。32バイトを base64 で表したもの */
  ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
