CREATE TABLE IF NOT EXISTS warplets_user_best_friends_cache_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_fid INTEGER NOT NULL UNIQUE,
  fetched_at TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES warplets_users(id)
);

CREATE INDEX IF NOT EXISTS idx_wubf_cache_state_user_id
  ON warplets_user_best_friends_cache_state(user_id);

CREATE INDEX IF NOT EXISTS idx_wubf_cache_state_fetched_at
  ON warplets_user_best_friends_cache_state(fetched_at);

INSERT INTO warplets_user_best_friends_cache_state (user_id, user_fid, fetched_at, result_count)
SELECT
  wu.id,
  wu.fid,
  MAX(wubf.fetched_at),
  COUNT(wubf.id)
FROM warplets_users wu
JOIN warplets_user_best_friends wubf
  ON wubf.user_id = wu.id
WHERE wu.fid IS NOT NULL
GROUP BY wu.id, wu.fid
ON CONFLICT(user_fid) DO UPDATE SET
  user_id = excluded.user_id,
  fetched_at = excluded.fetched_at,
  result_count = excluded.result_count;
