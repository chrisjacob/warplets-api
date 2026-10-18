CREATE TABLE IF NOT EXISTS network_wallet_associations (
  fid INTEGER PRIMARY KEY, observed_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'neynar-verified-evm'
);
CREATE TABLE IF NOT EXISTS network_wallet_links (
  fid INTEGER NOT NULL, address TEXT NOT NULL, observed_at INTEGER NOT NULL,
  PRIMARY KEY(fid,address)
);
CREATE INDEX IF NOT EXISTS network_wallet_links_address ON network_wallet_links(address,fid);
CREATE TABLE IF NOT EXISTS network_wallet_values (
  address TEXT PRIMARY KEY, usd_units TEXT NOT NULL, positions TEXT NOT NULL,
  excluded INTEGER NOT NULL, observed_at INTEGER NOT NULL, price_oldest_at INTEGER,
  source TEXT NOT NULL DEFAULT 'neynar-base+defillama'
);
CREATE TABLE IF NOT EXISTS network_wallet_retries (address TEXT PRIMARY KEY,retry_after INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS network_asset_prices (
  asset TEXT PRIMARY KEY, payload TEXT NOT NULL, observed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS network_holdings (
  fid INTEGER PRIMARY KEY, asset TEXT, status TEXT NOT NULL, calculated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS network_credit_budgets (
  month TEXT PRIMARY KEY, reserved INTEGER NOT NULL DEFAULT 0
);
