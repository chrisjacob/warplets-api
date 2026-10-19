ALTER TABLE tenx_control ADD COLUMN heartbeat_at TEXT;
ALTER TABLE tenx_control ADD COLUMN next_refresh_at TEXT;
ALTER TABLE tenx_control ADD COLUMN reviewed_at TEXT;
CREATE TABLE tenx_holder_evidence (
  payload_hash TEXT PRIMARY KEY, address TEXT NOT NULL, slot INTEGER NOT NULL,
  payload TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE tenx_market_history (
  address TEXT NOT NULL, fetched_at TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(address,fetched_at)
);
-- Existing saved snapshots retain their actual fetch timestamps, not migration time.
INSERT OR IGNORE INTO tenx_market_history(address,fetched_at,payload)
  SELECT address,json_extract(payload,'$.market.fetched_at'),json_extract(payload,'$.market')
  FROM tenx_candidates WHERE mode='live' AND json_type(payload,'$.market')='object';
CREATE TABLE tenx_cohorts (
  day TEXT NOT NULL, address TEXT NOT NULL, selected_at TEXT NOT NULL,
  recommended INTEGER NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(day,address)
);
CREATE INDEX tenx_cohorts_selected ON tenx_cohorts(day,selected_at);
CREATE TABLE tenx_selections (
  day TEXT NOT NULL, address TEXT NOT NULL, selected_at TEXT NOT NULL,
  input_hash TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(day,address)
);
CREATE TABLE tenx_reviews (
  day TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(day,input_hash)
);
CREATE TABLE tenx_wallet_signals (
  wallet TEXT NOT NULL, address TEXT NOT NULL, role TEXT NOT NULL,
  evidence_hash TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY(wallet,address,role,evidence_hash)
);
CREATE INDEX tenx_wallet_signals_address ON tenx_wallet_signals(address);
CREATE TABLE tenx_market_control (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_until TEXT, next_refresh_at TEXT,
  last_success TEXT, last_error TEXT
);
INSERT INTO tenx_market_control(id) VALUES(1);
CREATE TABLE tenx_market_attempts (address TEXT PRIMARY KEY, attempted_at TEXT NOT NULL);
