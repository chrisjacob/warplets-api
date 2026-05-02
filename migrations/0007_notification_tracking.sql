-- Open tracking: one row per app launch that originated from a notification.
-- FID may be null for unauthenticated open events (rare, but possible).
CREATE TABLE IF NOT EXISTS notification_opens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id TEXT    NOT NULL,
  fid             INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_opens_notification_id
  ON notification_opens(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_opens_fid
  ON notification_opens(fid);

-- Click tracking: one row per tap-through on a notification.
-- Recorded via the /n/:notificationId redirect endpoint before forwarding.
CREATE TABLE IF NOT EXISTS notification_clicks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id TEXT    NOT NULL,
  fid             INTEGER,
  target_url      TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_clicks_notification_id
  ON notification_clicks(notification_id);
