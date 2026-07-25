-- Harden the optional Dune ingestion path before it is enabled.
--
-- Results are staged by execution and only promoted into the public analytics
-- tables after every page has passed the declared query contract. Usage
-- snapshots use Dune's billing-period totals, which include result exports.

ALTER TABLE analytics_dune_executions
  ADD COLUMN rejected_rows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_dune_executions
  ADD COLUMN schema_version TEXT;

ALTER TABLE warplet_sale_sources
  ADD COLUMN buyer_wallet TEXT;
ALTER TABLE warplet_sale_sources
  ADD COLUMN seller_wallet TEXT;
ALTER TABLE warplet_sale_sources
  ADD COLUMN marketplace TEXT;
ALTER TABLE warplet_sale_sources
  ADD COLUMN price_eth REAL;
ALTER TABLE warplet_sale_sources
  ADD COLUMN price_usd REAL;
ALTER TABLE warplet_sale_sources
  ADD COLUMN payment_symbol TEXT;

UPDATE warplet_sale_sources
SET
  buyer_wallet = (
    SELECT buyer_wallet FROM warplet_sales
    WHERE warplet_sales.canonical_key = warplet_sale_sources.canonical_key
  ),
  seller_wallet = (
    SELECT seller_wallet FROM warplet_sales
    WHERE warplet_sales.canonical_key = warplet_sale_sources.canonical_key
  ),
  marketplace = (
    SELECT marketplace FROM warplet_sales
    WHERE warplet_sales.canonical_key = warplet_sale_sources.canonical_key
  ),
  price_eth = (
    SELECT price_eth FROM warplet_sales
    WHERE warplet_sales.canonical_key = warplet_sale_sources.canonical_key
  ),
  price_usd = (
    SELECT price_usd FROM warplet_sales
    WHERE warplet_sales.canonical_key = warplet_sale_sources.canonical_key
  ),
  payment_symbol = (
    SELECT payment_symbol FROM warplet_sales
    WHERE warplet_sales.canonical_key = warplet_sale_sources.canonical_key
  );

CREATE TABLE IF NOT EXISTS analytics_dune_result_stage (
  execution_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (execution_id, source_event_key)
);

CREATE INDEX IF NOT EXISTS idx_analytics_dune_result_stage_execution
  ON analytics_dune_result_stage (execution_id, source_key);

CREATE TABLE IF NOT EXISTS analytics_dune_leases (
  source_key TEXT PRIMARY KEY,
  lease_token TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analytics_dune_usage_snapshots (
  billing_period_start TEXT NOT NULL,
  billing_period_end TEXT NOT NULL,
  credits_used REAL NOT NULL,
  credits_included REAL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (billing_period_start, billing_period_end)
);

CREATE INDEX IF NOT EXISTS idx_analytics_dune_usage_snapshots_fetched
  ON analytics_dune_usage_snapshots (fetched_at DESC);
