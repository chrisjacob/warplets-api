ALTER TABLE warplets_users ADD COLUMN best_friends_warplets_on TEXT;

ALTER TABLE warplets_metadata ADD COLUMN last_outreach_on TEXT;

CREATE INDEX IF NOT EXISTS idx_warplets_metadata_last_outreach_on
  ON warplets_metadata(last_outreach_on);

CREATE TABLE IF NOT EXISTS warplets_user_best_friends_warplet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_fid INTEGER NOT NULL,
  best_friend_fid INTEGER NOT NULL,
  warplet_token_id INTEGER NOT NULL,
  mutual_affinity_score REAL,
  username TEXT,
  created_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES warplets_users(id),
  FOREIGN KEY (warplet_token_id) REFERENCES warplets_metadata(token_id),
  UNIQUE(user_id, best_friend_fid, warplet_token_id)
);

CREATE INDEX IF NOT EXISTS idx_wubfw_user_id_score
  ON warplets_user_best_friends_warplet(user_id, mutual_affinity_score DESC);

CREATE INDEX IF NOT EXISTS idx_wubfw_user_fid
  ON warplets_user_best_friends_warplet(user_fid);
