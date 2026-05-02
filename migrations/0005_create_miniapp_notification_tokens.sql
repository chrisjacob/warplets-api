-- Stores Farcaster notification tokens per FID.
-- One active token per FID (last writer wins via ON CONFLICT in webhook handler).
-- The notification_url is provided by the client (e.g. https://api.warpcast.com/v1/frame-notifications).
-- Used by the app server to push notifications to users who have added the Mini App.

CREATE TABLE IF NOT EXISTS miniapp_notification_tokens (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  fid                INTEGER NOT NULL UNIQUE,
  notification_url   TEXT    NOT NULL,
  notification_token TEXT    NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_miniapp_notification_tokens_enabled
  ON miniapp_notification_tokens (enabled);
