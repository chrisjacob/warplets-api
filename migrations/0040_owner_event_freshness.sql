-- Preserve the newest observed ownership event when OpenSea event pages arrive
-- newest-first or a resumable cursor spans more than one ingest run.

ALTER TABLE warplet_market_state ADD COLUMN owner_event_at TEXT;

CREATE INDEX IF NOT EXISTS idx_warplet_market_owner_event_at
  ON warplet_market_state (owner_event_at);
