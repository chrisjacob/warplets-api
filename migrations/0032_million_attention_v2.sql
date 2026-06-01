CREATE TABLE IF NOT EXISTS million_attention_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_month TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  user_fid INTEGER NOT NULL,
  action_key TEXT NOT NULL,
  auction_day INTEGER NOT NULL DEFAULT 0,
  points_awarded INTEGER NOT NULL,
  payload_json TEXT,
  created_on TEXT NOT NULL,
  updated_on TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES warplets_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_million_attention_completions_unique
  ON million_attention_completions(user_id, grant_month, action_key, auction_day);

CREATE INDEX IF NOT EXISTS idx_million_attention_completions_month
  ON million_attention_completions(grant_month, action_key, auction_day);
