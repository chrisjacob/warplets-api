-- Rename the unreleased Search application identity to Warplets. Search remains
-- a feature name; only whole-application identity values are changed here.

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_notification_queue_status_due;
DROP INDEX IF EXISTS idx_notification_queue_fid_status;
DROP INDEX IF EXISTS idx_notification_queue_category_status;
ALTER TABLE notification_queue RENAME TO notification_queue_search_legacy;

CREATE TABLE notification_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_key TEXT NOT NULL UNIQUE,
  notification_id TEXT NOT NULL,
  app_slug TEXT NOT NULL DEFAULT 'warplets',
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
  collapse_key TEXT,
  expires_at TEXT,
  FOREIGN KEY(event_id) REFERENCES warplet_activity_events(id)
);

INSERT INTO notification_queue (
  id, queue_key, notification_id, app_slug, category, priority, fid, event_id,
  title, body, target_url, status, attempt_count, next_attempt_at, last_error,
  created_at, updated_at, sent_at
)
SELECT
  id,
  REPLACE(queue_key, 'search:', 'warplets:'),
  REPLACE(notification_id, 'search:', 'warplets:'),
  CASE WHEN app_slug = 'search' THEN 'warplets' ELSE app_slug END,
  category, priority, fid, event_id, title, body,
  REPLACE(
    REPLACE(
      REPLACE(target_url, 'https://search-local.10x.meme', 'https://warplet-local.10x.meme'),
      'https://search-dev.10x.meme', 'https://warplet-dev.10x.meme'
    ),
    'https://search.10x.meme', 'https://warplet.10x.meme'
  ),
  status,
  attempt_count, next_attempt_at, last_error, created_at, updated_at, sent_at
FROM notification_queue_search_legacy;

DROP TABLE notification_queue_search_legacy;

CREATE INDEX idx_notification_queue_status_due
  ON notification_queue(status, next_attempt_at, priority);
CREATE INDEX idx_notification_queue_fid_status
  ON notification_queue(fid, status);
CREATE INDEX idx_notification_queue_category_status
  ON notification_queue(category, status);

ALTER TABLE notification_channel_attempts RENAME TO notification_channel_attempts_search_legacy;
ALTER TABLE notification_channel_deliveries RENAME TO notification_channel_deliveries_search_legacy;
DROP INDEX IF EXISTS idx_notification_channel_status;

CREATE TABLE notification_channel_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  app_slug TEXT NOT NULL DEFAULT 'warplets',
  channel TEXT NOT NULL CHECK(channel IN ('farcaster', 'base', 'web-push', 'telegram', 'discord')),
  recipient_key TEXT NOT NULL,
  farcaster_fid INTEGER,
  wallet_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opened_at TEXT,
  clicked_at TEXT,
  UNIQUE(campaign_id, app_slug, channel, recipient_key)
);

INSERT INTO notification_channel_deliveries (
  id, campaign_id, app_slug, channel, recipient_key, farcaster_fid,
  wallet_address, status, attempts, last_error, created_at, updated_at,
  opened_at, clicked_at
)
SELECT
  id, REPLACE(campaign_id, 'search:', 'warplets:'),
  CASE WHEN app_slug = 'search' THEN 'warplets' ELSE app_slug END,
  channel, recipient_key, farcaster_fid, wallet_address, status, attempts,
  last_error, created_at, updated_at, opened_at, clicked_at
FROM notification_channel_deliveries_search_legacy;

CREATE INDEX idx_notification_channel_status
  ON notification_channel_deliveries(channel, status, updated_at);

CREATE TABLE notification_channel_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL,
  response_status INTEGER,
  result TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(delivery_id) REFERENCES notification_channel_deliveries(id)
);

INSERT INTO notification_channel_attempts (
  id, delivery_id, response_status, result, error_message, created_at
)
SELECT id, delivery_id, response_status, result, error_message, created_at
FROM notification_channel_attempts_search_legacy;

DROP TABLE notification_channel_attempts_search_legacy;
DROP TABLE notification_channel_deliveries_search_legacy;

UPDATE miniapp_notification_tokens SET app_slug = 'warplets' WHERE app_slug = 'search';
UPDATE notification_dispatches SET app_slug = 'warplets' WHERE app_slug = 'search';
UPDATE notification_opens SET app_slug = 'warplets' WHERE app_slug = 'search';
UPDATE notification_clicks SET app_slug = 'warplets' WHERE app_slug = 'search';
UPDATE notification_webhook_events SET app_slug = 'warplets' WHERE app_slug = 'search';
UPDATE actions SET app_slug = 'warplets' WHERE app_slug = 'search';

UPDATE warplet_activity_events
SET
  event_key = REPLACE(event_key, 'search:favourited:', 'warplets:favourited:'),
  source = CASE source
    WHEN 'search:trade' THEN 'warplets:trade'
    WHEN 'search:collection-offers' THEN 'warplets:collection-offers'
    WHEN 'search:favourites' THEN 'warplets:favourites'
    ELSE source
  END
WHERE
  event_key LIKE 'search:favourited:%'
  OR source IN ('search:trade', 'search:collection-offers', 'search:favourites');

UPDATE notification_dispatches
SET
  notification_id = REPLACE(notification_id, 'search:', 'warplets:'),
  target_url = REPLACE(
    REPLACE(
      REPLACE(target_url, 'https://search-local.10x.meme', 'https://warplet-local.10x.meme'),
      'https://search-dev.10x.meme', 'https://warplet-dev.10x.meme'
    ),
    'https://search.10x.meme', 'https://warplet.10x.meme'
  )
WHERE app_slug = 'warplets';

UPDATE notification_clicks
SET
  notification_id = REPLACE(notification_id, 'search:', 'warplets:'),
  target_url = REPLACE(
    REPLACE(
      REPLACE(target_url, 'https://search-local.10x.meme', 'https://warplet-local.10x.meme'),
      'https://search-dev.10x.meme', 'https://warplet-dev.10x.meme'
    ),
    'https://search.10x.meme', 'https://warplet.10x.meme'
  )
WHERE app_slug = 'warplets';

UPDATE notification_opens
SET notification_id = REPLACE(notification_id, 'search:', 'warplets:')
WHERE app_slug = 'warplets';

INSERT OR IGNORE INTO notification_job_state (job_key, value, updated_at)
SELECT REPLACE(job_key, 'search:', 'warplets:'), value, updated_at
FROM notification_job_state
WHERE job_key LIKE 'search:%';

DELETE FROM notification_job_state WHERE job_key LIKE 'search:%';

PRAGMA foreign_keys = ON;
