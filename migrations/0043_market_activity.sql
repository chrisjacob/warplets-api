CREATE TABLE IF NOT EXISTS warplet_market_activity (
  canonical_key TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('sale', 'listing', 'offer', 'transfer')),
  token_id INTEGER NOT NULL CHECK (token_id BETWEEN 1 AND 10000),
  price_eth REAL,
  amount_raw TEXT,
  currency_symbol TEXT,
  transaction_hash TEXT,
  order_hash TEXT,
  from_wallet TEXT,
  from_fid INTEGER,
  to_wallet TEXT,
  to_fid INTEGER,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_activity_time
  ON warplet_market_activity (occurred_at DESC, canonical_key DESC);
CREATE INDEX IF NOT EXISTS idx_market_activity_token_time
  ON warplet_market_activity (token_id, occurred_at DESC, canonical_key DESC);
CREATE INDEX IF NOT EXISTS idx_market_activity_from_time
  ON warplet_market_activity (from_fid, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_activity_to_time
  ON warplet_market_activity (to_fid, occurred_at DESC);

INSERT OR IGNORE INTO warplet_market_activity (
  canonical_key, event_type, token_id, price_eth, amount_raw, currency_symbol,
  transaction_hash, order_hash, from_wallet, from_fid, to_wallet, to_fid,
  occurred_at, source, raw_payload
)
SELECT
  'sale:' || canonical_key, 'sale', token_id, price_eth, price_raw, payment_symbol,
  transaction_hash, order_hash, seller_wallet, seller_fid, buyer_wallet, buyer_fid,
  sold_at, source, raw_payload
FROM warplet_sales
WHERE token_id BETWEEN 1 AND 10000
  AND sold_at >= '2026-07-02T00:00:00.000Z';

INSERT OR IGNORE INTO warplet_market_activity (
  canonical_key, event_type, token_id, price_eth, amount_raw, currency_symbol,
  transaction_hash, order_hash, from_wallet, from_fid, to_wallet, to_fid,
  occurred_at, source, raw_payload
)
SELECT
  'activity:' || event_key,
  CASE
    WHEN LOWER(event_type) IN ('listed', 'listing') THEN 'listing'
    WHEN LOWER(event_type) IN ('offered', 'offer') THEN 'offer'
  END,
  token_id, amount_eth, amount_raw, currency_symbol, transaction_hash, order_hash,
  actor_wallet, actor_fid, NULL, NULL,
  occurred_at, source, raw_payload
FROM warplet_activity_events
WHERE token_id BETWEEN 1 AND 10000
  AND occurred_at >= '2026-07-02T00:00:00.000Z'
  AND LOWER(event_type) IN ('listed', 'listing', 'offered', 'offer');

INSERT OR IGNORE INTO warplet_market_activity (
  canonical_key, event_type, token_id, transaction_hash, from_wallet, to_wallet,
  occurred_at, source, raw_payload
)
SELECT
  'transfer:' || canonical_key, 'transfer', token_id, transaction_hash,
  from_wallet, to_wallet, transferred_at, source, raw_payload
FROM warplet_transfers t
WHERE token_id BETWEEN 1 AND 10000
  AND transferred_at >= '2026-07-02T00:00:00.000Z'
  AND NOT EXISTS (
    SELECT 1 FROM warplet_sales s
    WHERE s.token_id = t.token_id
      AND LOWER(s.transaction_hash) = LOWER(t.transaction_hash)
  );

CREATE TRIGGER IF NOT EXISTS trg_market_activity_from_notification
AFTER INSERT ON warplet_activity_events
WHEN NEW.token_id BETWEEN 1 AND 10000
  AND NEW.occurred_at >= '2026-07-02T00:00:00.000Z'
  AND LOWER(NEW.event_type) IN ('listed', 'listing', 'offered', 'offer')
BEGIN
  INSERT OR REPLACE INTO warplet_market_activity (
    canonical_key, event_type, token_id, price_eth, amount_raw, currency_symbol,
    transaction_hash, order_hash, from_wallet, from_fid, occurred_at, source,
    raw_payload, updated_at
  ) VALUES (
    'activity:' || NEW.event_key,
    CASE WHEN LOWER(NEW.event_type) IN ('listed', 'listing') THEN 'listing' ELSE 'offer' END,
    NEW.token_id, NEW.amount_eth, NEW.amount_raw, NEW.currency_symbol,
    NEW.transaction_hash, NEW.order_hash, NEW.actor_wallet, NEW.actor_fid,
    NEW.occurred_at, NEW.source, NEW.raw_payload, CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_market_activity_from_sale
AFTER INSERT ON warplet_sales
WHEN NEW.token_id BETWEEN 1 AND 10000
  AND NEW.sold_at >= '2026-07-02T00:00:00.000Z'
BEGIN
  INSERT OR REPLACE INTO warplet_market_activity (
    canonical_key, event_type, token_id, price_eth, amount_raw, currency_symbol,
    transaction_hash, order_hash, from_wallet, from_fid, to_wallet, to_fid,
    occurred_at, source, raw_payload, updated_at
  ) VALUES (
    'sale:' || NEW.canonical_key, 'sale', NEW.token_id, NEW.price_eth,
    NEW.price_raw, NEW.payment_symbol, NEW.transaction_hash, NEW.order_hash,
    NEW.seller_wallet, NEW.seller_fid, NEW.buyer_wallet, NEW.buyer_fid,
    NEW.sold_at, NEW.source, NEW.raw_payload, CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_market_activity_from_transfer
AFTER INSERT ON warplet_transfers
WHEN NEW.token_id BETWEEN 1 AND 10000
  AND NEW.transferred_at >= '2026-07-02T00:00:00.000Z'
  AND NOT EXISTS (
    SELECT 1 FROM warplet_sales s
    WHERE s.token_id = NEW.token_id
      AND LOWER(s.transaction_hash) = LOWER(NEW.transaction_hash)
  )
BEGIN
  INSERT OR REPLACE INTO warplet_market_activity (
    canonical_key, event_type, token_id, transaction_hash, from_wallet, to_wallet,
    occurred_at, source, raw_payload, updated_at
  ) VALUES (
    'transfer:' || NEW.canonical_key, 'transfer', NEW.token_id,
    NEW.transaction_hash, NEW.from_wallet, NEW.to_wallet, NEW.transferred_at,
    NEW.source, NEW.raw_payload, CURRENT_TIMESTAMP
  );
END;
