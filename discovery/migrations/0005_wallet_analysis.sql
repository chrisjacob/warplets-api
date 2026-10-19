CREATE TABLE tenx_wallet_control (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_owner TEXT, lease_until TEXT,
  next_refresh_at TEXT, last_success TEXT, last_error TEXT, last_address TEXT
);
INSERT INTO tenx_wallet_control(id) VALUES(1);
CREATE TABLE tenx_wallet_usage (day TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK(used>=0));
CREATE TABLE tenx_wallet_attempts (address TEXT PRIMARY KEY, attempted_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL);
CREATE TABLE tenx_wallet_transactions (
  signature TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE tenx_wallet_evidence (
  payload_hash TEXT PRIMARY KEY, address TEXT NOT NULL, payload TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE INDEX tenx_wallet_evidence_address ON tenx_wallet_evidence(address,observed_at);
CREATE TABLE tenx_wallet_profiles (
  address TEXT NOT NULL, wallet TEXT NOT NULL, payload_hash TEXT NOT NULL,
  payload TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY(address,wallet)
);
