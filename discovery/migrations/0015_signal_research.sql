-- New baselines; never rewrite selection/recommendation/wallet cohorts.
CREATE TABLE tenx_signal_cohorts (
  address TEXT NOT NULL, signal TEXT NOT NULL CHECK(signal IN('new_token_high_cap','smooth_price_rise')),
  captured_at TEXT NOT NULL, record_hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(address,signal)
);
CREATE INDEX tenx_signal_cohorts_time ON tenx_signal_cohorts(captured_at);
CREATE TABLE tenx_signal_outcomes (
  address TEXT NOT NULL, signal TEXT NOT NULL, cohort_hash TEXT NOT NULL,
  finalized_at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(address,signal), FOREIGN KEY(address,signal) REFERENCES tenx_signal_cohorts(address,signal)
);
CREATE TABLE tenx_signal_attempts (
  address TEXT PRIMARY KEY, symbol TEXT NOT NULL, attempted_at TEXT NOT NULL,
  gaps TEXT NOT NULL CHECK(json_valid(gaps))
);
CREATE TABLE tenx_signal_control (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_owner TEXT, lease_until TEXT,
  next_at TEXT, last_success TEXT, last_error TEXT
);
INSERT INTO tenx_signal_control(id) VALUES(1);
