CREATE TABLE IF NOT EXISTS farcaster_auth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  uri TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_farcaster_auth_nonces_expires
  ON farcaster_auth_nonces(expires_at, consumed_at);
