CREATE INDEX IF NOT EXISTS idx_market_activity_event_time
  ON warplet_market_activity (event_type, occurred_at DESC, canonical_key DESC);

CREATE INDEX IF NOT EXISTS idx_market_activity_token_event_time
  ON warplet_market_activity (token_id, event_type, occurred_at DESC, canonical_key DESC);
