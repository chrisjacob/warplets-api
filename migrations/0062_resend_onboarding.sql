-- Durable, idempotent state for the future-only 10X Resend onboarding sequence.

CREATE TABLE IF NOT EXISTS email_onboarding_state (
  email TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('queued', 'dispatching', 'active', 'interrupted', 'uncertain', 'completed')),
  current_step INTEGER NOT NULL DEFAULT -1 CHECK(current_step BETWEEN -1 AND 7),
  source TEXT NOT NULL,
  claim_id TEXT,
  automation_run_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  interrupted_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_onboarding_state_status
  ON email_onboarding_state(status, updated_at);

CREATE TABLE IF NOT EXISTS email_onboarding_outbox (
  email TEXT PRIMARY KEY,
  start_step INTEGER NOT NULL DEFAULT 0 CHECK(start_step BETWEEN 0 AND 7),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  dispatch_started_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (email) REFERENCES email_onboarding_state(email) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_onboarding_outbox_due
  ON email_onboarding_outbox(next_attempt_at, attempts);

CREATE TABLE IF NOT EXISTS email_onboarding_templates (
  version INTEGER NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index BETWEEN 0 AND 7),
  step_key TEXT NOT NULL,
  template_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (version, step_index),
  UNIQUE (template_id)
);

CREATE TABLE IF NOT EXISTS email_onboarding_webhook_events (
  svix_id TEXT PRIMARY KEY,
  email_id TEXT,
  email TEXT,
  template_id TEXT,
  step_index INTEGER,
  event_type TEXT NOT NULL,
  link_url TEXT,
  occurred_at TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_onboarding_events_email_step
  ON email_onboarding_webhook_events(email, step_index, event_type);

CREATE INDEX IF NOT EXISTS idx_email_onboarding_events_received
  ON email_onboarding_webhook_events(received_at DESC);

CREATE TABLE IF NOT EXISTS email_onboarding_runs (
  automation_run_id TEXT PRIMARY KEY,
  email TEXT,
  status TEXT NOT NULL,
  start_step INTEGER,
  last_checked_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_onboarding_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_onboarding_reconcile_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_checked_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO email_onboarding_reconcile_state (id, updated_at)
VALUES (1, CURRENT_TIMESTAMP);
