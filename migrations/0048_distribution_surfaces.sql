-- Shared distribution primitives for PWA push, bots, developer API access and
-- x402 receipts. Platform identities are intentionally independent of wallet
-- and Farcaster identity until a verified link is completed.

PRAGMA foreign_keys = OFF;

ALTER TABLE notification_channel_attempts RENAME TO notification_channel_attempts_legacy;
ALTER TABLE notification_channel_deliveries RENAME TO notification_channel_deliveries_legacy;
DROP INDEX IF EXISTS idx_notification_channel_status;

CREATE TABLE notification_channel_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  app_slug TEXT NOT NULL DEFAULT 'search',
  channel TEXT NOT NULL CHECK(channel IN ('farcaster', 'base', 'web-push', 'telegram', 'discord')),
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

INSERT INTO notification_channel_deliveries (
  id, campaign_id, app_slug, channel, recipient_key, farcaster_fid,
  wallet_address, status, attempts, last_error, created_at, updated_at,
  opened_at, clicked_at
)
SELECT
  id, campaign_id, app_slug, channel, recipient_key, farcaster_fid,
  wallet_address, status, attempts, last_error, created_at, updated_at,
  opened_at, clicked_at
FROM notification_channel_deliveries_legacy;

CREATE INDEX idx_notification_channel_status
  ON notification_channel_deliveries(channel, status, updated_at);

CREATE TABLE notification_channel_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL,
  response_status INTEGER,
  result TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(delivery_id) REFERENCES notification_channel_deliveries(id)
);

INSERT INTO notification_channel_attempts (
  id, delivery_id, response_status, result, error_message, created_at
)
SELECT id, delivery_id, response_status, result, error_message, created_at
FROM notification_channel_attempts_legacy;

DROP TABLE notification_channel_attempts_legacy;
DROP TABLE notification_channel_deliveries_legacy;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS external_identity_links (
  provider TEXT NOT NULL CHECK(provider IN ('telegram', 'discord', 'x')),
  provider_user_id TEXT NOT NULL,
  wallet_address TEXT,
  farcaster_fid INTEGER,
  display_name TEXT,
  verified_at TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  metadata_json TEXT,
  app_session_hash TEXT,
  PRIMARY KEY(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_external_identity_wallet
  ON external_identity_links(wallet_address);

CREATE INDEX IF NOT EXISTS idx_external_identity_fid
  ON external_identity_links(farcaster_fid);

CREATE INDEX IF NOT EXISTS idx_external_identity_session
  ON external_identity_links(app_session_hash);

CREATE TABLE IF NOT EXISTS external_auth_challenges (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('x', 'telegram', 'discord')),
  app_session_hash TEXT NOT NULL,
  provider_user_id TEXT,
  bot_challenge_hash TEXT,
  pkce_verifier TEXT,
  nonce TEXT NOT NULL,
  return_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_external_auth_challenges_expiry
  ON external_auth_challenges(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS bot_link_challenges (
  challenge_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('telegram', 'discord')),
  provider_user_id TEXT NOT NULL,
  wallet_address TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  platform_auth_verified_at TEXT,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_hash TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  wallet_address TEXT,
  farcaster_fid INTEGER,
  topics_json TEXT NOT NULL DEFAULT '["announcements"]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_web_push_enabled
  ON web_push_subscriptions(enabled, updated_at);

CREATE TABLE IF NOT EXISTS notification_preferences (
  identity_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('farcaster', 'base', 'web-push', 'telegram', 'discord')),
  topic TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(identity_key, channel, topic)
);

CREATE TABLE IF NOT EXISTS api_credentials (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_credentials_wallet
  ON api_credentials(wallet_address, revoked_at);

CREATE TABLE IF NOT EXISTS x402_receipts (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  payer_address TEXT,
  payment_hash TEXT NOT NULL,
  verification_json TEXT,
  settlement_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  settled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_x402_receipts_status
  ON x402_receipts(status, created_at);
