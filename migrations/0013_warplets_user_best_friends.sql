-- Create table for storing best friends relationship
-- One-time fetch per user, cached for 30 days to avoid expensive Neynar API calls
CREATE TABLE IF NOT EXISTS warplets_user_best_friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  best_friend_fid INTEGER NOT NULL,
  mutual_affinity_score REAL,
  username TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES warplets_users(id),
  UNIQUE(user_id, best_friend_fid)
);

-- Index for efficient lookup of best friends for a user
CREATE INDEX IF NOT EXISTS idx_warplets_user_best_friends_user_id 
  ON warplets_user_best_friends(user_id);

-- Index for refresh logic (find stale data older than 30 days)
CREATE INDEX IF NOT EXISTS idx_warplets_user_best_friends_fetched_at 
  ON warplets_user_best_friends(fetched_at);
