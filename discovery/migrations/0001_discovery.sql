PRAGMA foreign_keys = ON;
CREATE TABLE tenx_control (
  id INTEGER PRIMARY KEY CHECK (id = 1), paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN(0,1)),
  lease_owner TEXT, lease_until TEXT, last_harvest TEXT, migration_cursor TEXT,
  last_success TEXT, last_error TEXT, retry_after TEXT
);
INSERT INTO tenx_control(id) VALUES(1);
CREATE TABLE tenx_pending_signatures (
  signature TEXT PRIMARY KEY, slot INTEGER NOT NULL, queued_at TEXT NOT NULL,
  processed_at TEXT, result TEXT
);
CREATE TABLE tenx_usage (
  provider TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL CHECK(used>=0),
  PRIMARY KEY(provider,day)
);
CREATE TABLE tenx_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('running','succeeded','failed','skipped')),
  started_at TEXT NOT NULL, finished_at TEXT, rpc_calls INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0, error_code TEXT
);
CREATE TABLE tenx_leads (
  address TEXT PRIMARY KEY, pool TEXT NOT NULL, migration_tx TEXT NOT NULL,
  migration_signature TEXT NOT NULL, first_seen_at TEXT NOT NULL,
  checked_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT
);
CREATE TABLE tenx_candidates (
  address TEXT PRIMARY KEY, pool TEXT NOT NULL, payload TEXT NOT NULL,
  checked_at TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN('live','fixture'))
);
CREATE INDEX tenx_candidates_checked ON tenx_candidates(mode,checked_at);
CREATE TABLE tenx_proofs (
  address TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('creation','graduation')),
  signature TEXT NOT NULL, instruction_index TEXT NOT NULL, slot INTEGER NOT NULL,
  payload_hash TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(address,kind), UNIQUE(signature,instruction_index,kind)
);
CREATE TABLE tenx_evidence (
  signature TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, payload TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE tenx_audit (
  id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
  data_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE tenx_dry_runs (
  id TEXT PRIMARY KEY, input_hash TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
