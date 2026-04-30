-- OpenSea event log: one row per NFT event fetched from the OpenSea REST API
CREATE TABLE IF NOT EXISTS opensea (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type        TEXT    NOT NULL,           -- 'sale', 'transfer', 'listing', etc.
  token_id          TEXT,                       -- NFT token identifier
  wallet_from       TEXT,                       -- seller / sender address
  wallet_to         TEXT,                       -- buyer / recipient address
  transaction_hash  TEXT,                       -- on-chain tx hash (NULL for off-chain events)
  sale_price_wei    TEXT,                       -- raw payment quantity (in smallest unit)
  payment_token     TEXT,                       -- e.g. 'ETH', 'USDC'
  event_timestamp   TEXT    NOT NULL,           -- ISO 8601 from OpenSea
  raw_payload       TEXT,                       -- full JSON blob for future use
  created_on        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Deduplicate on-chain sale events (tx hash is always present for sales)
CREATE UNIQUE INDEX IF NOT EXISTS idx_opensea_tx_hash
  ON opensea (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

-- Fast lookup when updating warplets_users.buy_on
CREATE INDEX IF NOT EXISTS idx_opensea_wallet_to   ON opensea (wallet_to);
CREATE INDEX IF NOT EXISTS idx_opensea_event_type  ON opensea (event_type);
CREATE INDEX IF NOT EXISTS idx_opensea_token_id    ON opensea (token_id);
CREATE INDEX IF NOT EXISTS idx_opensea_event_ts    ON opensea (event_timestamp);
