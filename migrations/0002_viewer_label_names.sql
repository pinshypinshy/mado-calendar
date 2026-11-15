-- 閲覧者ごとのカテゴリ名の上書き（要件 3.4）。全員共通の上書き（label_names）より優先する
CREATE TABLE viewer_label_names (
  viewer_id TEXT NOT NULL REFERENCES viewers (id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  label_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (viewer_id, calendar_id, label_key)
);
