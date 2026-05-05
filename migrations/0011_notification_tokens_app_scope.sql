-- App-scoped notification tokens.
--
-- Why:
-- - A single FID can install multiple mini apps (hub/drop/etc) and each app may have
--   a distinct notification token lifecycle.
-- - We need per-app audience targeting while still supporting "all" broadcasts.

CREATE TABLE IF NOT EXISTS miniapp_notification_tokens_v2 (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  fid                INTEGER NOT NULL,
  app_fid            INTEGER,
  app_slug           TEXT    NOT NULL DEFAULT 'app',
  notification_url   TEXT    NOT NULL,
  notification_token TEXT    NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fid, app_slug)
);

-- Backfill existing tokens into hub app scope.
INSERT INTO miniapp_notification_tokens_v2 (
  id, fid, app_fid, app_slug, notification_url, notification_token, enabled, created_at, updated_at
)
SELECT
  id, fid, NULL, 'app', notification_url, notification_token, enabled, created_at, updated_at
FROM miniapp_notification_tokens;

DROP TABLE miniapp_notification_tokens;
ALTER TABLE miniapp_notification_tokens_v2 RENAME TO miniapp_notification_tokens;

CREATE INDEX IF NOT EXISTS idx_miniapp_notification_tokens_enabled
  ON miniapp_notification_tokens (enabled);

CREATE INDEX IF NOT EXISTS idx_miniapp_notification_tokens_app_slug_enabled
  ON miniapp_notification_tokens (app_slug, enabled);

CREATE INDEX IF NOT EXISTS idx_miniapp_notification_tokens_fid
  ON miniapp_notification_tokens (fid);
