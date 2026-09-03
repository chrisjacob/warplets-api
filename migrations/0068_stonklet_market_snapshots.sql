CREATE TABLE IF NOT EXISTS stonklet_market_snapshots (
  pair_id TEXT PRIMARY KEY,
  contract_address TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  chart_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stonklet_market_snapshots_updated
  ON stonklet_market_snapshots (updated_at);
