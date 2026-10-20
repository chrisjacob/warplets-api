CREATE TABLE tenx_content_duplicate_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES tenx_content_submissions(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('RECORD','WITHDRAW')),
  request_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  event TEXT NOT NULL CHECK(json_valid(event)),
  UNIQUE(submission_id,revision)
);
CREATE INDEX tenx_duplicate_daily ON tenx_content_duplicate_events(action,created_at,id);
CREATE TRIGGER tenx_duplicate_no_update BEFORE UPDATE ON tenx_content_duplicate_events
BEGIN SELECT RAISE(ABORT,'immutable_duplicate_evidence'); END;
CREATE TRIGGER tenx_duplicate_no_delete BEFORE DELETE ON tenx_content_duplicate_events
BEGIN SELECT RAISE(ABORT,'immutable_duplicate_evidence'); END;
