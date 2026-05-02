-- Notification dispatches: one row per (fid, notification_id) send.
-- Enforces 24h idempotency via the UNIQUE constraint.
-- status: pending | delivered | rate_limited | invalid | failed
CREATE TABLE IF NOT EXISTS notification_dispatches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fid             INTEGER NOT NULL,
  notification_id TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  target_url      TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fid, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_fid
  ON notification_dispatches(fid);
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_status
  ON notification_dispatches(status);
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_created_at
  ON notification_dispatches(created_at);

-- Notification attempts: one row per outbound HTTP attempt.
-- result: success | rate_limited | invalid | error
CREATE TABLE IF NOT EXISTS notification_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_id      INTEGER NOT NULL REFERENCES notification_dispatches(id),
  fid              INTEGER NOT NULL,
  notification_url TEXT    NOT NULL,
  response_status  INTEGER,
  result           TEXT    NOT NULL DEFAULT 'unknown',
  error_message    TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_dispatch_id
  ON notification_attempts(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_notification_attempts_fid
  ON notification_attempts(fid);

-- Webhook event log: raw ingest for audit and replay.
CREATE TABLE IF NOT EXISTS notification_webhook_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fid         INTEGER NOT NULL,
  app_fid     INTEGER,
  event       TEXT    NOT NULL,
  raw_payload TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_webhook_events_fid
  ON notification_webhook_events(fid);
CREATE INDEX IF NOT EXISTS idx_notification_webhook_events_created_at
  ON notification_webhook_events(created_at);
