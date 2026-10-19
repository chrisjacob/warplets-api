CREATE TABLE tenx_account_evidence (
  payload_hash TEXT PRIMARY KEY, address TEXT NOT NULL, slot INTEGER NOT NULL,
  payload TEXT NOT NULL, observed_at TEXT NOT NULL
);
