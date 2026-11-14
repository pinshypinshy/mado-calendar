-- 閲覧者（要件 3.3）
CREATE TABLE viewers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  -- 閲覧者 ID。管理画面で再表示するため、ハッシュ化ではなく暗号化して保存する（要件 7.2）
  code_enc TEXT NOT NULL,
  -- 照合用の鍵付きハッシュ
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
  viewer_id TEXT NOT NULL REFERENCES viewers (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  label_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('detail', 'category', 'busy', 'hidden')),
  PRIMARY KEY (viewer_id, calendar_id, label_key)
);

-- 個別設定（要件 3.5）。event_key は「この回のみ」なら予定の ID、「シリーズ全体」ならシリーズの ID
CREATE TABLE event_overrides (
  viewer_id TEXT NOT NULL REFERENCES viewers (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('inherit', 'detail', 'category', 'busy', 'hidden')),
  PRIMARY KEY (viewer_id, calendar_id, event_key)
);

-- 対象カレンダー（要件 3.2）
CREATE TABLE selected_calendars (
  calendar_id TEXT PRIMARY KEY,
  position INTEGER NOT NULL
);

-- カテゴリの表示名の上書き（要件 3.4）
CREATE TABLE label_names (
  calendar_id TEXT NOT NULL,
  label_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (calendar_id, label_key)
);

-- 管理者のセッション
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- オーナーの OAuth トークン（要件 7.4）。1行だけ
CREATE TABLE oauth_token (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at INTEGER,
  scope TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Google から取得したデータのキャッシュ（要件 6章）
CREATE TABLE cache_entries (
  key TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

-- 閲覧者 ID の入力失敗（要件 7.2 の総当たり対策）
CREATE TABLE join_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX join_failures_ip_at ON join_failures (ip, at);
