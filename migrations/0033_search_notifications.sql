CREATE TABLE IF NOT EXISTS warplet_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  token_id INTEGER,
  actor_wallet TEXT,
  actor_fid INTEGER,
  actor_username TEXT,
  owner_wallet TEXT,
  owner_fid INTEGER,
  counterparty_wallet TEXT,
  counterparty_fid INTEGER,
  amount_eth REAL,
  amount_raw TEXT,
  currency_symbol TEXT,
  order_hash TEXT,
  transaction_hash TEXT,
  source TEXT NOT NULL DEFAULT 'search',
  occurred_at TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  queued_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_warplet_activity_events_type_time
  ON warplet_activity_events(event_type, occurred_at);

CREATE INDEX IF NOT EXISTS idx_warplet_activity_events_token_time
  ON warplet_activity_events(token_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_warplet_activity_events_actor_time
  ON warplet_activity_events(actor_fid, occurred_at);

CREATE INDEX IF NOT EXISTS idx_warplet_activity_events_owner_time
  ON warplet_activity_events(owner_fid, occurred_at);

CREATE TABLE IF NOT EXISTS warplet_active_item_offers (
  order_hash TEXT PRIMARY KEY,
  token_id INTEGER NOT NULL,
  offerer_wallet TEXT,
  offerer_fid INTEGER,
  amount_eth REAL,
  amount_raw TEXT,
  currency_symbol TEXT,
  protocol_address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warplet_active_item_offers_token_active
  ON warplet_active_item_offers(token_id, active, amount_eth);

CREATE INDEX IF NOT EXISTS idx_warplet_active_item_offers_offerer
  ON warplet_active_item_offers(offerer_fid, active);

CREATE TABLE IF NOT EXISTS notification_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_key TEXT NOT NULL UNIQUE,
  notification_id TEXT NOT NULL,
  app_slug TEXT NOT NULL DEFAULT 'search',
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  fid INTEGER NOT NULL,
  event_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY(event_id) REFERENCES warplet_activity_events(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_status_due
  ON notification_queue(status, next_attempt_at, priority);

CREATE INDEX IF NOT EXISTS idx_notification_queue_fid_status
  ON notification_queue(fid, status);

CREATE INDEX IF NOT EXISTS idx_notification_queue_category_status
  ON notification_queue(category, status);

CREATE TABLE IF NOT EXISTS notification_job_state (
  job_key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
