-- Local review campaigns are separate from launches, rewards and hypothetical accounting.
CREATE TABLE tenx_content_campaigns (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  request_hash TEXT NOT NULL, record TEXT NOT NULL
);
CREATE INDEX tenx_content_campaign_time ON tenx_content_campaigns(created_at,id);
CREATE INDEX tenx_content_campaign_end ON tenx_content_campaigns(ends_at);
CREATE TABLE tenx_content_submissions (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES tenx_content_campaigns(id),
  identity_id TEXT NOT NULL REFERENCES tenx_identities(id), canonical_url TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
  revision INTEGER NOT NULL, request_hash TEXT NOT NULL, snapshot TEXT NOT NULL, event_hash TEXT NOT NULL,
  UNIQUE(campaign_id,canonical_url)
);
CREATE INDEX tenx_content_owner ON tenx_content_submissions(identity_id,updated_at,id);
CREATE INDEX tenx_content_feed ON tenx_content_submissions(campaign_id,status,updated_at,id);
CREATE INDEX tenx_content_queue ON tenx_content_submissions(status,updated_at,id);
CREATE INDEX tenx_content_time ON tenx_content_submissions(created_at);
CREATE INDEX tenx_content_url ON tenx_content_submissions(canonical_url);
CREATE TABLE tenx_content_events (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES tenx_content_submissions(id),
  revision INTEGER NOT NULL, created_at TEXT NOT NULL, request_hash TEXT NOT NULL,
  event TEXT NOT NULL, UNIQUE(submission_id,revision)
);
CREATE INDEX tenx_content_event_time ON tenx_content_events(created_at);
CREATE TRIGGER tenx_content_events_no_update BEFORE UPDATE ON tenx_content_events BEGIN SELECT RAISE(ABORT,'content_events_immutable'); END;
CREATE TRIGGER tenx_content_events_no_delete BEFORE DELETE ON tenx_content_events BEGIN SELECT RAISE(ABORT,'content_events_immutable'); END;
CREATE TRIGGER tenx_content_campaign_no_update BEFORE UPDATE ON tenx_content_campaigns BEGIN SELECT RAISE(ABORT,'content_campaign_immutable'); END;
CREATE TRIGGER tenx_content_campaign_no_delete BEFORE DELETE ON tenx_content_campaigns BEGIN SELECT RAISE(ABORT,'content_campaign_immutable'); END;
