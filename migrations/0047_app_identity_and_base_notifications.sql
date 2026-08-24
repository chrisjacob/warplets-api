CREATE TABLE IF NOT EXISTS app_auth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  uri TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_auth_nonces_expires
  ON app_auth_nonces(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS app_auth_sessions (
  session_hash TEXT PRIMARY KEY,
  farcaster_fid INTEGER,
  wallet_address TEXT,
  farcaster_signer_uuid TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_auth_sessions_fid
  ON app_auth_sessions(farcaster_fid);

CREATE INDEX IF NOT EXISTS idx_app_auth_sessions_wallet
  ON app_auth_sessions(wallet_address);

CREATE TABLE IF NOT EXISTS app_identity_links (
  farcaster_fid INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  PRIMARY KEY (farcaster_fid, wallet_address)
);

CREATE TABLE IF NOT EXISTS base_notification_status_cache (
  wallet_address TEXT PRIMARY KEY,
  app_url TEXT NOT NULL,
  app_pinned INTEGER NOT NULL DEFAULT 0,
  notifications_enabled INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL,
  response_json TEXT
);

CREATE TABLE IF NOT EXISTS notification_channel_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  app_slug TEXT NOT NULL DEFAULT 'warplets',
  channel TEXT NOT NULL CHECK(channel IN ('farcaster', 'base')),
  recipient_key TEXT NOT NULL,
  farcaster_fid INTEGER,
  wallet_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opened_at TEXT,
  clicked_at TEXT,
  UNIQUE(campaign_id, app_slug, channel, recipient_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_channel_status
  ON notification_channel_deliveries(channel, status, updated_at);

CREATE TABLE IF NOT EXISTS notification_channel_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL,
  response_status INTEGER,
  result TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(delivery_id) REFERENCES notification_channel_deliveries(id)
);
