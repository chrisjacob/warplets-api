-- Operational measurements only; not evidence, eligibility or model inputs.
CREATE TABLE tenx_wallet_runs (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  source_evidence_hash TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('funding','snapshot')),
  state TEXT NOT NULL CHECK(state IN ('succeeded','failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  rpc_calls INTEGER NOT NULL CHECK(rpc_calls BETWEEN 0 AND 18),
  completed_windows INTEGER NOT NULL CHECK(completed_windows >= 0),
  new_buyers INTEGER NOT NULL CHECK(new_buyers >= 0),
  error_code TEXT
);
CREATE INDEX tenx_wallet_runs_finished ON tenx_wallet_runs(finished_at);
