-- Multi-app notification analytics support.
-- Adds app_slug to dispatch/open/click records so each mini app can be tracked independently.

ALTER TABLE notification_dispatches ADD COLUMN app_slug TEXT;
ALTER TABLE notification_opens ADD COLUMN app_slug TEXT;
ALTER TABLE notification_clicks ADD COLUMN app_slug TEXT;

-- Existing notification data originated from the original drop flow.
UPDATE notification_dispatches SET app_slug = 'drop' WHERE app_slug IS NULL;
UPDATE notification_opens SET app_slug = 'drop' WHERE app_slug IS NULL;
UPDATE notification_clicks SET app_slug = 'drop' WHERE app_slug IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_app_slug
  ON notification_dispatches(app_slug);

CREATE INDEX IF NOT EXISTS idx_notification_opens_app_slug
  ON notification_opens(app_slug);

CREATE INDEX IF NOT EXISTS idx_notification_clicks_app_slug
  ON notification_clicks(app_slug);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_app_slug_notification_id
  ON notification_dispatches(app_slug, notification_id);
