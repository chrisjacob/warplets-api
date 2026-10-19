CREATE TABLE IF NOT EXISTS network_alchemy_budgets (
  period TEXT PRIMARY KEY,
  reserved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS network_alchemy_rate (
  name TEXT PRIMARY KEY,
  next_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS network_alchemy_metadata (
  asset TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS network_asset_prices_priced ON network_asset_prices(asset) WHERE payload<>'null';
