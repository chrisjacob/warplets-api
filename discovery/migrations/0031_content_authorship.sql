CREATE TABLE tenx_content_authorship_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES tenx_content_submissions(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9),
  created_at TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('MANUAL_REVIEWED','WITHDRAWN')),
  request_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  event TEXT NOT NULL CHECK(json_valid(event)),
  UNIQUE(submission_id,revision)
);
CREATE INDEX tenx_authorship_daily ON tenx_content_authorship_events(decision,created_at);
CREATE TRIGGER tenx_authorship_no_update BEFORE UPDATE ON tenx_content_authorship_events
BEGIN SELECT RAISE(ABORT,'immutable_authorship_review'); END;
CREATE TRIGGER tenx_authorship_no_delete BEFORE DELETE ON tenx_content_authorship_events
BEGIN SELECT RAISE(ABORT,'immutable_authorship_review'); END;
