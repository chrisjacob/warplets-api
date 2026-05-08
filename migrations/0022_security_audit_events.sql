CREATE TABLE IF NOT EXISTS security_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  ip_address TEXT,
  route TEXT,
  details TEXT,
  created_on TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_created_on
  ON security_audit_events(created_on DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_event_type
  ON security_audit_events(event_type, created_on DESC);
