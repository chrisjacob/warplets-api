CREATE TABLE IF NOT EXISTS stonklet_cmc_assets (
  asset_key TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('stock', 'stonklet')),
  symbol TEXT NOT NULL,
  cmc_id INTEGER,
  contract_address TEXT,
  quote_json TEXT,
  quote_updated_at TEXT,
  holders INTEGER,
  holders_updated_at TEXT,
  mapping_updated_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stonklet_cmc_assets_pair_asset
  ON stonklet_cmc_assets (pair_id, asset);

CREATE INDEX IF NOT EXISTS idx_stonklet_cmc_assets_holder_due
  ON stonklet_cmc_assets (holders_updated_at, asset_key);

CREATE TABLE IF NOT EXISTS stonklet_cmc_credit_usage (
  month_key TEXT PRIMARY KEY,
  credits INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stonklet_cmc_ingest_locks (
  lock_key TEXT PRIMARY KEY,
  lease_until TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
