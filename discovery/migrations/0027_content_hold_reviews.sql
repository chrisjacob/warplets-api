CREATE TABLE tenx_content_hold_reviews (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES tenx_content_submissions(id),
  owner_identity_id TEXT NOT NULL REFERENCES tenx_identities(id), hold_set_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','NEEDS_INFO','RESUBMITTED','CLOSED')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 3), request_hash TEXT NOT NULL,
  snapshot TEXT NOT NULL, event_hash TEXT NOT NULL, UNIQUE(submission_id,hold_set_hash)
);
CREATE UNIQUE INDEX tenx_hold_review_active ON tenx_content_hold_reviews(submission_id) WHERE status<>'CLOSED';
CREATE INDEX tenx_hold_review_owner ON tenx_content_hold_reviews(owner_identity_id,updated_at,id);
CREATE INDEX tenx_hold_review_queue ON tenx_content_hold_reviews(status,updated_at,id);
CREATE INDEX tenx_hold_review_time ON tenx_content_hold_reviews(created_at);
CREATE TABLE tenx_content_hold_events (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES tenx_content_hold_reviews(id),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 3), created_at TEXT NOT NULL,
  request_hash TEXT NOT NULL, event TEXT NOT NULL, UNIQUE(review_id,revision)
);
CREATE INDEX tenx_hold_event_time ON tenx_content_hold_events(created_at);
CREATE TRIGGER tenx_hold_event_no_update BEFORE UPDATE ON tenx_content_hold_events BEGIN SELECT RAISE(ABORT,'immutable_hold_event'); END;
CREATE TRIGGER tenx_hold_event_no_delete BEFORE DELETE ON tenx_content_hold_events BEGIN SELECT RAISE(ABORT,'immutable_hold_event'); END;
CREATE TRIGGER tenx_hold_identity_immutable BEFORE UPDATE ON tenx_content_hold_reviews
WHEN NEW.id<>OLD.id OR NEW.submission_id<>OLD.submission_id OR NEW.owner_identity_id<>OLD.owner_identity_id OR NEW.hold_set_hash<>OLD.hold_set_hash OR NEW.created_at<>OLD.created_at OR NEW.request_hash<>OLD.request_hash
BEGIN SELECT RAISE(ABORT,'immutable_hold_identity'); END;
CREATE TRIGGER tenx_hold_no_delete BEFORE DELETE ON tenx_content_hold_reviews BEGIN SELECT RAISE(ABORT,'immutable_hold_identity'); END;
