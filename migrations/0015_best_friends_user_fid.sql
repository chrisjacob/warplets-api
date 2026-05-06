ALTER TABLE warplets_user_best_friends ADD COLUMN user_fid INTEGER;

UPDATE warplets_user_best_friends
SET user_fid = (
  SELECT fid
  FROM warplets_users
  WHERE warplets_users.id = warplets_user_best_friends.user_id
)
WHERE user_fid IS NULL;

CREATE INDEX IF NOT EXISTS idx_warplets_user_best_friends_user_fid
  ON warplets_user_best_friends(user_fid);
