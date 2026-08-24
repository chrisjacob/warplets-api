ALTER TABLE web_push_subscriptions
  ADD COLUMN app_slug TEXT NOT NULL DEFAULT 'warplets';

CREATE INDEX IF NOT EXISTS idx_web_push_app_enabled
  ON web_push_subscriptions(app_slug, enabled, updated_at);
