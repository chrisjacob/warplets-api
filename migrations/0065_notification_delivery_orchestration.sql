-- Make transactional notifications coalescible and time-bounded. Provider
-- delivery attempts remain independently durable in notification_channel_deliveries.
CREATE INDEX IF NOT EXISTS idx_notification_queue_collapse_status
  ON notification_queue(app_slug, collapse_key, status, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_queue_expiry_status
  ON notification_queue(app_slug, expires_at, status);

-- Historical retries are no longer useful after a day. The processor also
-- applies this rule so databases upgraded later receive the same cleanup.
UPDATE notification_queue
SET status = 'expired',
    last_error = 'Notification expired before delivery',
    updated_at = CURRENT_TIMESTAMP
WHERE status IN ('pending', 'retry', 'processing')
  AND datetime(created_at) < datetime('now', '-1 day');

-- Warplets previously exposed a single enable/disable control and therefore
-- saved only the announcements topic. Identity-linked subscribers opted into
-- Warplets notifications generally, so bring those existing subscriptions in
-- line with the now-supported transactional topics.
UPDATE web_push_subscriptions
SET topics_json = '["announcements","favourites","offers","market","activity"]',
    updated_at = CURRENT_TIMESTAMP
WHERE app_slug = 'warplets'
  AND enabled = 1
  AND (farcaster_fid IS NOT NULL OR wallet_address IS NOT NULL)
  AND topics_json = '["announcements"]';
