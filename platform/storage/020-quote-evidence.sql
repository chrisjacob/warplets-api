CREATE TABLE quote_sources (
  market_id TEXT PRIMARY KEY REFERENCES market_fixtures(id),
  og_feed TEXT NOT NULL,
  source_ref TEXT NOT NULL
) STRICT;
CREATE TABLE quote_pool_snapshots (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES market_fixtures(id),
  observed_ms INTEGER NOT NULL,
  context_slot INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('verified','pending')),
  reason TEXT,
  body TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  UNIQUE(market_id,observed_ms)
) STRICT;
CREATE INDEX quote_pool_latest ON quote_pool_snapshots(market_id,observed_ms DESC);
