-- Owned market turns and two bounded diagnostic cache slots. Existing market
-- history remains append-only; these slots do not claim to archive all batches.
ALTER TABLE tenx_market_control ADD COLUMN lease_owner TEXT;
ALTER TABLE tenx_market_control ADD COLUMN last_commit_owner TEXT;
CREATE TABLE tenx_market_batch_cache (
  slot TEXT PRIMARY KEY CHECK(slot IN ('latest','latest_issue')),
  captured_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=1100000)
);
