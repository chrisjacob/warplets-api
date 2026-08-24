-- Active OpenSea criteria offers for collection and trait-based offers.
-- Trait matching is resolved against local warplets_metadata, not OpenSea counts.

CREATE TABLE IF NOT EXISTS opensea_criteria_offers (
  order_hash TEXT PRIMARY KEY,
  collection_slug TEXT NOT NULL,
  criteria_kind TEXT NOT NULL CHECK (criteria_kind IN ('trait', 'collection')),
  traits_json TEXT,

  offer_eth REAL,
  offer_raw_amount TEXT,
  offer_decimals INTEGER,
  offer_currency_symbol TEXT,
  offer_token_address TEXT,

  offerer_wallet TEXT,
  protocol_address TEXT,
  encoded_token_ids TEXT,
  active INTEGER NOT NULL DEFAULT 1,

  offered_at TEXT,
  opensea_updated_at TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_opensea_criteria_offers_active_price
  ON opensea_criteria_offers(collection_slug, criteria_kind, active, offer_eth);

CREATE INDEX IF NOT EXISTS idx_opensea_criteria_offers_offerer
  ON opensea_criteria_offers(offerer_wallet, active);

CREATE INDEX IF NOT EXISTS idx_opensea_criteria_offers_updated
  ON opensea_criteria_offers(opensea_updated_at);

CREATE TABLE IF NOT EXISTS opensea_criteria_offer_matches (
  order_hash TEXT NOT NULL,
  collection_slug TEXT NOT NULL,
  criteria_kind TEXT NOT NULL CHECK (criteria_kind IN ('trait', 'collection')),
  token_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_hash, token_id),
  FOREIGN KEY (order_hash) REFERENCES opensea_criteria_offers(order_hash)
);

CREATE INDEX IF NOT EXISTS idx_opensea_criteria_offer_matches_token
  ON opensea_criteria_offer_matches(token_id, criteria_kind);
