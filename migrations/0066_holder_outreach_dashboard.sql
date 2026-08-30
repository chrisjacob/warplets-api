ALTER TABLE app_auth_sessions ADD COLUMN last_warplets_seen_at TEXT;

CREATE INDEX IF NOT EXISTS idx_app_auth_sessions_warplets_seen
  ON app_auth_sessions(farcaster_fid, last_warplets_seen_at);

CREATE TABLE IF NOT EXISTS holder_outreach_casts (
  fid INTEGER PRIMARY KEY,
  cast_hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT,
  pfp_url TEXT,
  x_username TEXT,
  cast_text TEXT NOT NULL,
  cast_at TEXT NOT NULL,
  parent_hash TEXT,
  token_id INTEGER NOT NULL,
  owned_count INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_holder_outreach_casts_cast_at
  ON holder_outreach_casts(cast_at DESC);

CREATE INDEX IF NOT EXISTS idx_holder_outreach_casts_username
  ON holder_outreach_casts(username);

CREATE TABLE IF NOT EXISTS holder_outreach_events (
  id TEXT PRIMARY KEY,
  tracking_code TEXT NOT NULL UNIQUE,
  fid INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  cast_hash TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('farcaster', 'x')),
  template_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  first_opened_at TEXT,
  last_opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_holder_outreach_events_fid_created
  ON holder_outreach_events(fid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_holder_outreach_events_created
  ON holder_outreach_events(created_at DESC);

CREATE TABLE IF NOT EXISTS holder_outreach_sync_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  after_fid INTEGER NOT NULL DEFAULT 0,
  scanned_holders INTEGER NOT NULL DEFAULT 0,
  total_holders INTEGER NOT NULL DEFAULT 0,
  active_holders INTEGER NOT NULL DEFAULT 0,
  truncated_groups INTEGER NOT NULL DEFAULT 0,
  cycle_started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO holder_outreach_sync_state (singleton) VALUES (1);
