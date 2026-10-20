CREATE TABLE tenx_content_reports (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES tenx_content_submissions(id),
  reporter_identity_id TEXT NOT NULL REFERENCES tenx_identities(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('OPEN','UPHELD','DISMISSED','RELEASED')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 2), request_hash TEXT NOT NULL, snapshot TEXT NOT NULL, event_hash TEXT NOT NULL,
  UNIQUE(submission_id,reporter_identity_id)
);
CREATE INDEX tenx_report_hold ON tenx_content_reports(submission_id,status);
CREATE INDEX tenx_report_owner ON tenx_content_reports(reporter_identity_id,updated_at,id);
CREATE INDEX tenx_report_queue ON tenx_content_reports(status,updated_at,id);
CREATE INDEX tenx_report_time ON tenx_content_reports(created_at);
CREATE TABLE tenx_content_report_events (
  id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES tenx_content_reports(id), revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 2),
  created_at TEXT NOT NULL, request_hash TEXT NOT NULL, event TEXT NOT NULL, UNIQUE(report_id,revision)
);
CREATE INDEX tenx_report_event_time ON tenx_content_report_events(created_at);
CREATE TRIGGER tenx_report_event_no_update BEFORE UPDATE ON tenx_content_report_events BEGIN SELECT RAISE(ABORT,'immutable_report_event'); END;
CREATE TRIGGER tenx_report_event_no_delete BEFORE DELETE ON tenx_content_report_events BEGIN SELECT RAISE(ABORT,'immutable_report_event'); END;
CREATE TRIGGER tenx_report_identity_immutable BEFORE UPDATE ON tenx_content_reports
WHEN NEW.id<>OLD.id OR NEW.submission_id<>OLD.submission_id OR NEW.reporter_identity_id<>OLD.reporter_identity_id OR NEW.created_at<>OLD.created_at OR NEW.request_hash<>OLD.request_hash
BEGIN SELECT RAISE(ABORT,'immutable_report_identity'); END;
CREATE TRIGGER tenx_report_no_delete BEFORE DELETE ON tenx_content_reports BEGIN SELECT RAISE(ABORT,'immutable_report_identity'); END;
