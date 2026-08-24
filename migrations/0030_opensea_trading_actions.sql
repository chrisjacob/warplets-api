-- Market trading support for Search app secondary-market actions.

ALTER TABLE warplet_market_state ADD COLUMN listing_protocol_address TEXT;
ALTER TABLE warplet_market_state ADD COLUMN offer_protocol_address TEXT;

CREATE TABLE IF NOT EXISTS opensea_collection_market_state (
  collection_slug TEXT PRIMARY KEY,

  floor_eth REAL,
  floor_raw_amount TEXT,
  floor_decimals INTEGER,
  floor_currency_symbol TEXT,
  floor_token_address TEXT,
  floor_updated_at TEXT,

  top_offer_eth REAL,
  top_offer_raw_amount TEXT,
  top_offer_decimals INTEGER,
  top_offer_currency_symbol TEXT,
  top_offer_token_address TEXT,
  top_offer_order_hash TEXT,
  top_offer_protocol_address TEXT,
  top_offerer_wallet TEXT,
  top_offer_created_at TEXT,
  top_offer_updated_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opensea_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL,
  action_name TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  fid INTEGER,
  token_id TEXT,
  wallet_from TEXT,
  wallet_to TEXT,
  order_hash TEXT,
  protocol_address TEXT,
  transaction_hash TEXT,
  expected_price_raw TEXT,
  actual_price_raw TEXT,
  payment_token TEXT,
  payment_decimals INTEGER,
  http_status INTEGER,
  wallet_error_code TEXT,
  error_message TEXT,
  raw_payload TEXT,
  created_on TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opensea_action_log_action_id
  ON opensea_action_log(action_id);
CREATE INDEX IF NOT EXISTS idx_opensea_action_log_token_id
  ON opensea_action_log(token_id);
CREATE INDEX IF NOT EXISTS idx_opensea_action_log_wallet_from
  ON opensea_action_log(wallet_from);
CREATE INDEX IF NOT EXISTS idx_opensea_action_log_action_status
  ON opensea_action_log(action_name, status);
CREATE INDEX IF NOT EXISTS idx_opensea_action_log_created_on
  ON opensea_action_log(created_on);
