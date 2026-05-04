-- Email waitlist and campaign tracking schema.

CREATE TABLE IF NOT EXISTS email_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  fid INTEGER,
  username TEXT,
  token_id INTEGER,
  matched INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT NOT NULL UNIQUE,
  subscribed_at TEXT NOT NULL,
  verified_at TEXT,
  unsubscribed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_waitlist_verified
  ON email_waitlist(verified);

CREATE INDEX IF NOT EXISTS idx_email_waitlist_subscribed_at
  ON email_waitlist(subscribed_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_waitlist_fid
  ON email_waitlist(fid);

CREATE TABLE IF NOT EXISTS email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_sends_sent_at
  ON email_sends(sent_at DESC);

CREATE TABLE IF NOT EXISTS email_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_id TEXT,
  email TEXT,
  url TEXT NOT NULL,
  clicked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_clicks_send_id
  ON email_clicks(send_id);

CREATE INDEX IF NOT EXISTS idx_email_clicks_clicked_at
  ON email_clicks(clicked_at DESC);
