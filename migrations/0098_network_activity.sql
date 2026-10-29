-- Positive activity evidence. Missing messages do not establish inactivity.
CREATE TABLE IF NOT EXISTS network_activity_months (
  fid INTEGER NOT NULL, month TEXT NOT NULL, action_at INTEGER NOT NULL,
  message_hash TEXT NOT NULL, action_type TEXT NOT NULL, source TEXT NOT NULL,
  observed_at INTEGER NOT NULL, PRIMARY KEY (fid, month)
);
CREATE INDEX IF NOT EXISTS network_activity_month_idx ON network_activity_months(month, fid);
CREATE TABLE IF NOT EXISTS network_activity_checks (
  fid INTEGER NOT NULL, month TEXT NOT NULL, checked_at INTEGER NOT NULL,
  PRIMARY KEY (fid, month)
);
