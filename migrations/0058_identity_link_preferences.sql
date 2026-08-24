CREATE TABLE IF NOT EXISTS app_identity_link_preferences (
  farcaster_fid INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  auto_link_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_link_enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (farcaster_fid, wallet_address)
);

