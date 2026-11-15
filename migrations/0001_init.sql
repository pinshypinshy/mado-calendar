-- 窓カレンダーのデータベース。
-- すべてのデータはオーナーごとに分ける（要件 7.6）。オーナーのデータを持つ表には owner_id を持たせ、
-- 読み書きは必ず owner_id で絞り込む（src/worker/adapters/d1.ts の forOwner）。

-- オーナー（要件 3.9、3.10）。運営者もオーナーの1人として登録される
CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  -- 小文字にそろえて保存する
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- オーナーの管理画面のセッション。Cookie の値そのものではなく、その SHA-256 を保存する
CREATE TABLE owner_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX owner_sessions_owner_id ON owner_sessions (owner_id);

-- オーナーの OAuth トークン（要件 7.4）。オーナーごとに1行
CREATE TABLE oauth_tokens (
  owner_id TEXT PRIMARY KEY REFERENCES owners (id) ON DELETE CASCADE,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at INTEGER,
  scope TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 閲覧者（要件 3.3）。1人のオーナーに属する
CREATE TABLE viewers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  -- 閲覧者 ID。管理画面で再表示するため、ハッシュ化ではなく暗号化して保存する（要件 7.2）
  code_enc TEXT NOT NULL,
  -- 照合用の鍵付きハッシュ。参加のときは全オーナーの閲覧者から探す
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  default_week_start INTEGER NOT NULL DEFAULT 0 CHECK (default_week_start IN (0, 1)),
  week_start INTEGER CHECK (week_start IN (0, 1)),
  period_enabled INTEGER NOT NULL DEFAULT 0 CHECK (period_enabled IN (0, 1)),
  period_past_months INTEGER,
  period_future_months INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  last_forced_refresh_at INTEGER
);
CREATE INDEX viewers_owner_id ON viewers (owner_id);

-- 閲覧者のセッション（要件 7.3）。Cookie の値そのものではなく、その SHA-256 を保存する
CREATE TABLE viewer_sessions (
  token_hash TEXT PRIMARY KEY,
  viewer_id TEXT NOT NULL REFERENCES viewers (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  renewed_at INTEGER NOT NULL
);
CREATE INDEX viewer_sessions_viewer_id ON viewer_sessions (viewer_id);

-- 表示ルール（要件 3.4）
CREATE TABLE display_rules (
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES viewers (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  label_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('detail', 'category', 'busy', 'hidden')),
  PRIMARY KEY (owner_id, viewer_id, calendar_id, label_key)
);

-- 個別設定（要件 3.5）。event_key は「この回のみ」なら予定の ID、「シリーズ全体」ならシリーズの ID
CREATE TABLE event_overrides (
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES viewers (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('inherit', 'detail', 'category', 'busy', 'hidden')),
  PRIMARY KEY (owner_id, viewer_id, calendar_id, event_key)
);

-- 閲覧者ごとのカテゴリ名の上書き（要件 3.4）。全員共通の上書き（label_names）より優先する
CREATE TABLE viewer_label_names (
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES viewers (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  label_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (owner_id, viewer_id, calendar_id, label_key)
);

-- 対象カレンダー（要件 3.2）
CREATE TABLE selected_calendars (
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (owner_id, calendar_id)
);

-- 全員共通のカテゴリ名の上書き（要件 3.4）
CREATE TABLE label_names (
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  label_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (owner_id, calendar_id, label_key)
);

-- Google から取得したデータのキャッシュ（要件 6章）。オーナーごとに持つ
CREATE TABLE cache_entries (
  owner_id TEXT NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (owner_id, key)
);

-- 閲覧者 ID の入力失敗（要件 7.2 の総当たり対策）。オーナーに関係しない
CREATE TABLE join_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX join_failures_ip_at ON join_failures (ip, at);
