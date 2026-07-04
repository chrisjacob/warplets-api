-- Canonical dynamic market layer for Warplets OpenSea state.
CREATE TABLE IF NOT EXISTS warplet_market_state (
  token_id INTEGER PRIMARY KEY,

  listing_eth REAL,
  listed_at TEXT,
  listing_order_hash TEXT,
  listing_seller_wallet TEXT,
  listing_raw_amount TEXT,
  listing_decimals INTEGER,
  listing_currency_symbol TEXT,
  listing_token_address TEXT,

  offer_eth REAL,
  offered_at TEXT,
  offer_order_hash TEXT,
  offerer_wallet TEXT,
  offer_raw_amount TEXT,
  offer_decimals INTEGER,
  offer_currency_symbol TEXT,
  offer_token_address TEXT,

  sale_eth REAL,
  sold_at TEXT,
  sale_tx_hash TEXT,
  seller_wallet TEXT,
  sale_raw_amount TEXT,
  sale_decimals INTEGER,
  sale_currency_symbol TEXT,
  sale_token_address TEXT,

  owner_wallet TEXT,
  owner_fid INTEGER,
  owner_checked_at TEXT,

  opensea_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opensea_ingest_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_farcaster_links (
  wallet TEXT NOT NULL,
  fid INTEGER NOT NULL,
  score REAL,
  username TEXT,
  pfp_url TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (wallet, fid)
);

CREATE INDEX IF NOT EXISTS idx_warplet_market_listing_eth
  ON warplet_market_state(listing_eth);
CREATE INDEX IF NOT EXISTS idx_warplet_market_offer_eth
  ON warplet_market_state(offer_eth);
CREATE INDEX IF NOT EXISTS idx_warplet_market_sale_eth
  ON warplet_market_state(sale_eth);
CREATE INDEX IF NOT EXISTS idx_warplet_market_listed_at
  ON warplet_market_state(listed_at);
CREATE INDEX IF NOT EXISTS idx_warplet_market_offered_at
  ON warplet_market_state(offered_at);
CREATE INDEX IF NOT EXISTS idx_warplet_market_sold_at
  ON warplet_market_state(sold_at);
CREATE INDEX IF NOT EXISTS idx_warplet_market_owner_wallet
  ON warplet_market_state(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_warplet_market_owner_fid
  ON warplet_market_state(owner_fid);
CREATE INDEX IF NOT EXISTS idx_wallet_farcaster_links_wallet
  ON wallet_farcaster_links(wallet, score DESC, fid ASC);

INSERT OR IGNORE INTO warplet_market_state (
  token_id,
  owner_wallet,
  owner_checked_at,
  created_at,
  updated_at
)
SELECT
  token_id,
  LOWER(TRIM(warplet_wallet)),
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM warplets_metadata
WHERE warplet_wallet IS NOT NULL
  AND TRIM(warplet_wallet) <> '';
