-- Optional Dune round-two analytics enrichment.
--
-- Dune is never a runtime dependency for the public Stats pages. Scheduled or
-- admin-triggered ingestion writes normalized post-reset data into these compact
-- D1 tables; public APIs continue to serve OpenSea/current D1 data when Dune is
-- disabled, delayed, over budget, or unavailable.

CREATE TABLE IF NOT EXISTS analytics_dune_executions (
  execution_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  query_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  range_start TEXT NOT NULL,
  range_end TEXT,
  next_offset INTEGER NOT NULL DEFAULT 0,
  rows_ingested INTEGER NOT NULL DEFAULT 0,
  execution_cost_credits REAL,
  submitted_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_dune_executions_source_status
  ON analytics_dune_executions (source_key, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_dune_executions_query
  ON analytics_dune_executions (query_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_dune_executions_submitted
  ON analytics_dune_executions (submitted_at DESC);

-- Preserve provenance when OpenSea and Dune observe the same canonical sale.
CREATE TABLE IF NOT EXISTS warplet_sale_sources (
  canonical_key TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT,
  observed_at TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (canonical_key, source),
  FOREIGN KEY (canonical_key) REFERENCES warplet_sales(canonical_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_warplet_sale_sources_source_time
  ON warplet_sale_sources (source, observed_at DESC);

INSERT OR IGNORE INTO warplet_sale_sources (
  canonical_key,
  source,
  external_id,
  observed_at,
  raw_payload
)
SELECT
  canonical_key,
  source,
  event_id,
  sold_at,
  raw_payload
FROM warplet_sales;

CREATE TABLE IF NOT EXISTS warplet_transfers (
  canonical_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL DEFAULT 8453,
  collection_slug TEXT NOT NULL DEFAULT '10xwarplets',
  token_id INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  block_number INTEGER,
  from_wallet TEXT,
  to_wallet TEXT,
  executed_by_wallet TEXT,
  transferred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (transaction_hash, event_index, token_id)
);

CREATE INDEX IF NOT EXISTS idx_warplet_transfers_token_time
  ON warplet_transfers (token_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_warplet_transfers_from_time
  ON warplet_transfers (from_wallet, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_warplet_transfers_to_time
  ON warplet_transfers (to_wallet, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_warplet_transfers_transaction
  ON warplet_transfers (transaction_hash);
CREATE INDEX IF NOT EXISTS idx_warplet_transfers_time
  ON warplet_transfers (transferred_at DESC);

-- Current ownership remains authoritative in warplet_market_state. This table
-- contains optional activity/holding-duration enrichment only.
CREATE TABLE IF NOT EXISTS holder_activity_summary (
  wallet TEXT PRIMARY KEY,
  current_owned_count INTEGER NOT NULL DEFAULT 0,
  acquired_since_epoch INTEGER NOT NULL DEFAULT 0,
  disposed_since_epoch INTEGER NOT NULL DEFAULT 0,
  first_acquired_at TEXT,
  last_acquired_at TEXT,
  last_disposed_at TEXT,
  last_activity_at TEXT,
  oldest_current_holding_at TEXT,
  average_current_holding_days REAL,
  source TEXT NOT NULL DEFAULT 'dune_transfers',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_holder_activity_summary_last_activity
  ON holder_activity_summary (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_holder_activity_summary_average_holding
  ON holder_activity_summary (average_current_holding_days DESC);

CREATE TABLE IF NOT EXISTS analytics_daily_chain_activity (
  day TEXT PRIMARY KEY,
  sales_count INTEGER NOT NULL DEFAULT 0,
  volume_eth REAL NOT NULL DEFAULT 0,
  volume_usd REAL NOT NULL DEFAULT 0,
  median_sale_eth REAL,
  unique_buyers INTEGER NOT NULL DEFAULT 0,
  unique_sellers INTEGER NOT NULL DEFAULT 0,
  marketplace_count INTEGER NOT NULL DEFAULT 0,
  transfer_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'dune',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_chain_activity_day
  ON analytics_daily_chain_activity (day DESC);

CREATE TABLE IF NOT EXISTS analytics_marketplace_summary (
  marketplace TEXT PRIMARY KEY,
  sales_count INTEGER NOT NULL DEFAULT 0,
  volume_eth REAL NOT NULL DEFAULT 0,
  volume_usd REAL NOT NULL DEFAULT 0,
  unique_buyers INTEGER NOT NULL DEFAULT 0,
  unique_sellers INTEGER NOT NULL DEFAULT 0,
  coverage_start TEXT NOT NULL,
  coverage_end TEXT,
  source TEXT NOT NULL DEFAULT 'dune',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_marketplace_summary_volume
  ON analytics_marketplace_summary (volume_eth DESC, marketplace ASC);
