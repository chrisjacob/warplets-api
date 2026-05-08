-- Cost-safe performance indexes for hot paths.
-- Designed to reduce D1 read cost and latency without changing behavior.

CREATE INDEX IF NOT EXISTS idx_warplets_users_buys_recent
  ON warplets_users(buy_in_opensea_on DESC, buy_in_farcaster_wallet_on DESC, fid);

CREATE INDEX IF NOT EXISTS idx_warplets_users_rewarded_recent
  ON warplets_users(rewarded_on DESC, fid);

CREATE INDEX IF NOT EXISTS idx_actions_completed_user_action_created
  ON actions_completed(user_id, action_slug, created_on DESC);

CREATE INDEX IF NOT EXISTS idx_actions_completed_user_action_id
  ON actions_completed(user_id, action_id);

CREATE INDEX IF NOT EXISTS idx_warplets_user_best_friends_user_fid_score
  ON warplets_user_best_friends(user_fid, mutual_affinity_score DESC);

CREATE INDEX IF NOT EXISTS idx_wubfw_user_token_score
  ON warplets_user_best_friends_warplet(user_id, warplet_token_id, mutual_affinity_score DESC);

CREATE INDEX IF NOT EXISTS idx_warplets_metadata_outreach_token
  ON warplets_metadata(last_outreach_on, token_id DESC);
