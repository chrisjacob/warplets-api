-- Keep collection-offer supersession and notification cleanup bounded as the
-- transactional queue grows.
CREATE INDEX IF NOT EXISTS idx_notification_queue_event_status
  ON notification_queue(event_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_queue_app_status_created
  ON notification_queue(app_slug, status, created_at);
