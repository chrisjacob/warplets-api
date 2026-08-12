CREATE TABLE IF NOT EXISTS wallet_profile_cache (
  wallet TEXT PRIMARY KEY,
  opensea_avatar_url TEXT,
  opensea_username TEXT,
  ens_name TEXT,
  ens_avatar_url TEXT,
  resolved_avatar_url TEXT,
  resolved_source TEXT NOT NULL DEFAULT 'none',
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_profile_cache_checked_at
  ON wallet_profile_cache(checked_at);
