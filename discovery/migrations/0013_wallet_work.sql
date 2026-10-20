-- Mutable collection progress is separate from eligibility snapshots and frozen inputs.
CREATE TABLE tenx_wallet_work (
  address TEXT PRIMARY KEY,
  source_evidence_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
