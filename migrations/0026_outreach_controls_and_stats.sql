ALTER TABLE warplets_metadata ADD COLUMN outreach_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_warplets_metadata_outreach_count
  ON warplets_metadata(outreach_count DESC, token_id);

CREATE TABLE IF NOT EXISTS warplets_outreach_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL,
  sender_fid INTEGER NOT NULL,
  action_slug TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('farcaster', 'x')),
  verification TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_user_id) REFERENCES warplets_users(id)
);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_messages_created
  ON warplets_outreach_messages(created_on DESC);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_messages_sender
  ON warplets_outreach_messages(sender_fid, created_on DESC);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_messages_action
  ON warplets_outreach_messages(action_slug, created_on DESC);

CREATE TABLE IF NOT EXISTS warplets_outreach_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  sender_fid INTEGER NOT NULL,
  recipient_fid INTEGER NOT NULL,
  warplet_token_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('farcaster', 'x')),
  farcaster_username TEXT,
  x_username TEXT,
  mutual_affinity_score REAL,
  source TEXT,
  created_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES warplets_outreach_messages(id),
  FOREIGN KEY (warplet_token_id) REFERENCES warplets_metadata(token_id)
);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_recipients_created
  ON warplets_outreach_recipients(created_on DESC);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_recipients_recipient
  ON warplets_outreach_recipients(recipient_fid, created_on DESC);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_recipients_sender
  ON warplets_outreach_recipients(sender_fid, created_on DESC);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_recipients_token
  ON warplets_outreach_recipients(warplet_token_id, created_on DESC);

CREATE TABLE IF NOT EXISTS warplets_outreach_opt_outs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fid INTEGER NOT NULL UNIQUE,
  username TEXT,
  opted_out_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opted_back_in_on TEXT,
  updated_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_opt_outs_active
  ON warplets_outreach_opt_outs(fid, opted_back_in_on);

CREATE INDEX IF NOT EXISTS idx_warplets_outreach_opt_outs_opted_out_on
  ON warplets_outreach_opt_outs(opted_out_on DESC);
