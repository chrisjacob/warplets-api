-- Add app_slug for deterministic app-scoped webhook attribution (path-based routing)
ALTER TABLE notification_webhook_events ADD COLUMN app_slug TEXT;

-- Backfill historical rows where app_fid maps to the legacy hub app.
UPDATE notification_webhook_events
SET app_slug = 'app'
WHERE app_slug IS NULL
  AND app_fid = 9152;

CREATE INDEX IF NOT EXISTS idx_webhook_events_app_slug_created_at
  ON notification_webhook_events(app_slug, created_at DESC);
