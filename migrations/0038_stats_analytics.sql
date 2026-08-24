-- Analytics storage for the Search app Stats pages.
--
-- Historical analytics deliberately start after the collection reset/airdrop:
-- 2026-07-02 00:00:00 UTC. The OpenSea aggregate values at that instant are
-- intentionally left NULL until they can be verified against OpenSea evidence.

CREATE TABLE IF NOT EXISTS analytics_metric_baselines (
  collection_slug TEXT NOT NULL,
  analytics_epoch TEXT NOT NULL,
  opensea_total_sales INTEGER,
  opensea_total_volume_text TEXT,
  currency_basis TEXT NOT NULL DEFAULT 'opensea_eth_equivalent',
  verification_method TEXT,
  evidence_hash TEXT,
  evidence_json TEXT,
  verified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection_slug, analytics_epoch, version)
);

INSERT OR IGNORE INTO analytics_metric_baselines (
  collection_slug,
  analytics_epoch,
  opensea_total_sales,
  opensea_total_volume_text,
  currency_basis,
  verification_method,
  evidence_hash,
  evidence_json,
  verified_at,
  version
) VALUES (
  '10xwarplets',
  '2026-07-02T00:00:00.000Z',
  NULL,
  NULL,
  'opensea_eth_equivalent',
  NULL,
  NULL,
  NULL,
  NULL,
  1
);

CREATE TABLE IF NOT EXISTS opensea_stats_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_slug TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  total_sales INTEGER,
  total_volume_text TEXT,
  one_day_sales INTEGER,
  one_day_volume_text TEXT,
  seven_day_sales INTEGER,
  seven_day_volume_text TEXT,
  thirty_day_sales INTEGER,
  thirty_day_volume_text TEXT,
  floor_eth REAL,
  owners_count INTEGER,
  listed_count INTEGER,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (collection_slug, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_opensea_stats_snapshots_collection_time
  ON opensea_stats_snapshots (collection_slug, captured_at DESC);

CREATE TABLE IF NOT EXISTS warplet_sales (
  canonical_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL DEFAULT 8453,
  collection_slug TEXT NOT NULL DEFAULT '10xwarplets',
  token_id INTEGER NOT NULL,
  transaction_hash TEXT,
  order_hash TEXT,
  event_id TEXT,
  buyer_wallet TEXT,
  seller_wallet TEXT,
  buyer_fid INTEGER,
  seller_fid INTEGER,
  marketplace TEXT,
  price_raw TEXT,
  payment_decimals INTEGER,
  payment_symbol TEXT,
  payment_address TEXT,
  price_eth REAL,
  price_usd REAL,
  sold_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warplet_sales_sold_at
  ON warplet_sales (sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_warplet_sales_token_time
  ON warplet_sales (token_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_warplet_sales_buyer_time
  ON warplet_sales (buyer_wallet, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_warplet_sales_seller_time
  ON warplet_sales (seller_wallet, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_warplet_sales_transaction
  ON warplet_sales (transaction_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warplet_sales_transaction_token
  ON warplet_sales (transaction_hash, token_id)
  WHERE transaction_hash IS NOT NULL;

-- Backfill the already-normalized "sold" half of existing activity pairs.
-- "purchased" rows are intentionally excluded to avoid double counting.
WITH activity_raw AS (
  SELECT
    e.*,
    CASE
      WHEN json_valid(e.raw_payload) AND json_type(e.raw_payload, '$.buyer') = 'text'
        THEN json_extract(e.raw_payload, '$.buyer')
      WHEN json_valid(e.raw_payload) AND json_type(e.raw_payload, '$.buyer') = 'object'
        THEN json_extract(e.raw_payload, '$.buyer.address')
      ELSE NULL
    END AS raw_buyer_wallet,
    CASE
      WHEN json_valid(e.raw_payload) AND json_type(e.raw_payload, '$.seller') = 'text'
        THEN json_extract(e.raw_payload, '$.seller')
      WHEN json_valid(e.raw_payload) AND json_type(e.raw_payload, '$.seller') = 'object'
        THEN json_extract(e.raw_payload, '$.seller.address')
      ELSE NULL
    END AS raw_seller_wallet
  FROM warplet_activity_events e
  WHERE e.event_type = 'sold'
    AND e.token_id BETWEEN 1 AND 10000
    AND e.occurred_at >= '2026-07-02T00:00:00.000Z'
),
normalized_activity AS (
  SELECT
    a.*,
    NULLIF(LOWER(TRIM(COALESCE(a.raw_buyer_wallet, a.counterparty_wallet))), '') AS normalized_buyer_wallet,
    NULLIF(LOWER(TRIM(COALESCE(a.raw_seller_wallet, a.actor_wallet))), '') AS normalized_seller_wallet
  FROM activity_raw a
)
INSERT OR IGNORE INTO warplet_sales (
  canonical_key,
  chain_id,
  collection_slug,
  token_id,
  transaction_hash,
  order_hash,
  buyer_wallet,
  seller_wallet,
  buyer_fid,
  seller_fid,
  marketplace,
  price_raw,
  payment_symbol,
  price_eth,
  sold_at,
  source,
  raw_payload
)
SELECT
  CASE
    WHEN a.transaction_hash IS NOT NULL AND TRIM(a.transaction_hash) <> ''
      THEN '8453:' || LOWER(TRIM(a.transaction_hash)) || ':' || a.token_id
    WHEN a.order_hash IS NOT NULL AND TRIM(a.order_hash) <> ''
      THEN '8453:' || LOWER(TRIM(a.order_hash)) || ':' || a.token_id
    ELSE 'activity:' || a.id
  END,
  8453,
  '10xwarplets',
  a.token_id,
  NULLIF(LOWER(TRIM(a.transaction_hash)), ''),
  NULLIF(LOWER(TRIM(a.order_hash)), ''),
  a.normalized_buyer_wallet,
  a.normalized_seller_wallet,
  COALESCE(
    (
      SELECT l.fid
      FROM wallet_farcaster_links l
      WHERE LOWER(TRIM(l.wallet)) = a.normalized_buyer_wallet
      ORDER BY COALESCE(l.score, -1) DESC, l.fid ASC
      LIMIT 1
    ),
    (
      SELECT u.fid
      FROM warplets_users u
      WHERE LOWER(TRIM(u.primary_eth_address)) = a.normalized_buyer_wallet
      ORDER BY u.fid ASC
      LIMIT 1
    ),
    CASE
      WHEN LOWER(TRIM(a.actor_wallet)) = a.normalized_buyer_wallet THEN a.actor_fid
      WHEN LOWER(TRIM(a.counterparty_wallet)) = a.normalized_buyer_wallet THEN a.counterparty_fid
      ELSE NULL
    END
  ),
  COALESCE(
    (
      SELECT l.fid
      FROM wallet_farcaster_links l
      WHERE LOWER(TRIM(l.wallet)) = a.normalized_seller_wallet
      ORDER BY COALESCE(l.score, -1) DESC, l.fid ASC
      LIMIT 1
    ),
    (
      SELECT u.fid
      FROM warplets_users u
      WHERE LOWER(TRIM(u.primary_eth_address)) = a.normalized_seller_wallet
      ORDER BY u.fid ASC
      LIMIT 1
    ),
    CASE
      WHEN LOWER(TRIM(a.actor_wallet)) = a.normalized_seller_wallet THEN a.actor_fid
      WHEN LOWER(TRIM(a.counterparty_wallet)) = a.normalized_seller_wallet THEN a.counterparty_fid
      ELSE NULL
    END
  ),
  COALESCE(NULLIF(TRIM(a.source), ''), 'search'),
  a.amount_raw,
  UPPER(a.currency_symbol),
  a.amount_eth,
  a.occurred_at,
  'warplet_activity_events',
  a.raw_payload
FROM normalized_activity a;

CREATE TABLE IF NOT EXISTS collection_market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_slug TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  floor_eth REAL,
  top_offer_eth REAL,
  listed_count INTEGER,
  owners_count INTEGER,
  source TEXT NOT NULL DEFAULT 'opensea',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (collection_slug, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_collection_market_snapshots_collection_time
  ON collection_market_snapshots (collection_slug, captured_at DESC);

CREATE TABLE IF NOT EXISTS analytics_owner_baseline (
  token_id INTEGER PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  owner_fid INTEGER,
  baseline_at TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_owner_baseline_wallet
  ON analytics_owner_baseline (owner_wallet);
CREATE INDEX IF NOT EXISTS idx_analytics_owner_baseline_fid
  ON analytics_owner_baseline (owner_fid);

-- The static metadata allocation is the completed reset-airdrop cohort.
-- Current ownership lives separately in warplet_market_state and can diverge.
INSERT OR IGNORE INTO analytics_owner_baseline (
  token_id,
  owner_wallet,
  owner_fid,
  baseline_at,
  source
)
SELECT
  token_id,
  LOWER(TRIM(warplet_wallet)),
  CAST(fid_value AS INTEGER),
  '2026-07-02T00:00:00.000Z',
  'airdrop_metadata'
FROM warplets_metadata
WHERE warplet_wallet IS NOT NULL
  AND TRIM(warplet_wallet) <> ''
  AND LOWER(TRIM(warplet_wallet)) <> '0x0000000000000000000000000000000000000000';

CREATE TABLE IF NOT EXISTS holder_leaderboard (
  wallet TEXT PRIMARY KEY,
  owned_count INTEGER NOT NULL CHECK (owned_count > 0),
  best_rarity_rank INTEGER NOT NULL,
  best_token_id INTEGER NOT NULL,
  preview_token_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_holder_leaderboard_order
  ON holder_leaderboard (
    owned_count DESC,
    best_rarity_rank ASC,
    wallet ASC
  );

CREATE TABLE IF NOT EXISTS analytics_ingest_state (
  source_key TEXT PRIMARY KEY,
  cursor TEXT,
  coverage_start TEXT,
  coverage_end TEXT,
  complete INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_ingest_state_updated
  ON analytics_ingest_state (updated_at DESC);
