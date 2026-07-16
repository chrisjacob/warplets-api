ALTER TABLE warplets_users ADD COLUMN search_onboarding_completed_at TEXT;
ALTER TABLE warplets_users ADD COLUMN search_airdrop_modal_completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_warplets_users_search_onboarding_completed_at
  ON warplets_users(search_onboarding_completed_at);

CREATE INDEX IF NOT EXISTS idx_warplets_users_search_airdrop_modal_completed_at
  ON warplets_users(search_airdrop_modal_completed_at);
