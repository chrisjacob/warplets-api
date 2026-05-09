ALTER TABLE warplets_users ADD COLUMN referrer_fid INTEGER;
ALTER TABLE warplets_users ADD COLUMN referrals_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_warplets_users_referrer_fid
  ON warplets_users(referrer_fid);

CREATE INDEX IF NOT EXISTS idx_warplets_users_referrals_count
  ON warplets_users(referrals_count DESC, fid);
