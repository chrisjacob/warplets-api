ALTER TABLE warplets_users RENAME COLUMN shared_on TO rewarded_on;

DROP INDEX IF EXISTS idx_warplets_users_shared_on;

CREATE INDEX IF NOT EXISTS idx_warplets_users_rewarded_on
  ON warplets_users(rewarded_on);
