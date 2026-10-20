CREATE TABLE tenx_backing_runs (
  id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  ends_at TEXT NOT NULL, deadline TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('open','frozen')),
  opening TEXT NOT NULL, opening_hash TEXT NOT NULL,
  evidence TEXT, evidence_hash TEXT, result TEXT, result_hash TEXT, record_hash TEXT, last_error TEXT
);
CREATE UNIQUE INDEX tenx_backing_one_open ON tenx_backing_runs(state) WHERE state='open';
CREATE INDEX tenx_backing_created ON tenx_backing_runs(created_at);
