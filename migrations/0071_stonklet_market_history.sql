CREATE TABLE IF NOT EXISTS stonklet_market_history (
  pair_id TEXT NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('5m', '1h', '1d')),
  bucket_at TEXT NOT NULL,
  price REAL NOT NULL CHECK (price > 0),
  market_cap REAL,
  source_updated_at TEXT NOT NULL,
  PRIMARY KEY (pair_id, granularity, bucket_at)
);

CREATE INDEX IF NOT EXISTS idx_stonklet_market_history_range
  ON stonklet_market_history (pair_id, granularity, bucket_at);
