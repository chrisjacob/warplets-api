CREATE TABLE tenx_election_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('manual','daily')),
  created_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  inputs TEXT NOT NULL
);
CREATE INDEX tenx_election_runs_created ON tenx_election_runs(created_at);
CREATE TRIGGER tenx_election_runs_no_update BEFORE UPDATE ON tenx_election_runs BEGIN SELECT RAISE(ABORT,'immutable_election'); END;
CREATE TRIGGER tenx_election_runs_no_delete BEFORE DELETE ON tenx_election_runs BEGIN SELECT RAISE(ABORT,'immutable_election'); END;
ALTER TABLE tenx_control ADD COLUMN election_error TEXT;
