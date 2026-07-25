-- 10X Warplets: bounded daily NFT sales feed (v1)
--
-- This is the query referenced by DUNE_TRADES_QUERY_ID. It scans a rolling
-- 48-hour window ending two hours before execution. The overlap makes a daily
-- schedule tolerant of indexing delays; D1 canonical-key upserts deduplicate
-- rows across executions.
--
-- Its output contract exactly matches warplets_sales_backfill_v1.sql.

WITH end_bound AS (
  SELECT CURRENT_TIMESTAMP - INTERVAL '2' HOUR AS coverage_end
),
bounds AS (
  SELECT
    GREATEST(
      TIMESTAMP '2026-07-02 00:00:00',
      coverage_end - INTERVAL '48' HOUR
    ) AS coverage_start,
    coverage_end
  FROM end_bound
),
filtered_sales AS (
  SELECT
    t.block_time,
    t.block_number,
    CAST(t.token_id AS BIGINT) AS token_id,
    t.tx_hash,
    t.buyer,
    t.seller,
    t.project,
    t.version AS project_version,
    t.aggregator_name,
    t.trade_type,
    t.trade_category,
    t.number_of_items,
    t.amount_raw,
    t.amount_original,
    t.amount_usd,
    t.currency_symbol,
    t.currency_contract,
    t.unique_trade_id,
    CASE
      WHEN payment.decimals IS NOT NULL THEN payment.decimals
      WHEN UPPER(t.currency_symbol) IN ('ETH', 'WETH') THEN 18
      ELSE NULL
    END AS payment_decimals,
    b.coverage_start,
    b.coverage_end,
    ROW_NUMBER() OVER (
      PARTITION BY t.tx_hash, CAST(t.token_id AS BIGINT)
      ORDER BY t.unique_trade_id ASC
    ) AS duplicate_rank
  FROM nft.trades AS t
  CROSS JOIN bounds AS b
  LEFT JOIN tokens.erc20 AS payment
    ON payment.blockchain = t.blockchain
   AND payment.contract_address = t.currency_contract
  WHERE t.blockchain = 'base'
    AND t.block_month >= CAST(DATE_TRUNC('month', b.coverage_start) AS DATE)
    AND t.block_time >= b.coverage_start
    AND t.block_time < b.coverage_end
    AND t.nft_contract_address = 0x780446dd12e080ae0db762fcd4daf313f3e359de
    AND t.evt_type = 'Trade'
    AND t.tx_hash IS NOT NULL
    AND t.token_id IS NOT NULL
    AND t.token_id BETWEEN 1 AND 10000
),
data_rows AS (
  SELECT
    'warplets_dune_sales_v1' AS schema_version,
    'data' AS row_type,
    DATE_FORMAT(coverage_start, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_start,
    DATE_FORMAT(coverage_end, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_end,
    '8453:0x' || LOWER(TO_HEX(tx_hash)) || ':' ||
      CAST(token_id AS VARCHAR) AS canonical_key,
    8453 AS chain_id,
    '10xwarplets' AS collection_slug,
    '0x780446dd12e080ae0db762fcd4daf313f3e359de' AS contract_address,
    token_id,
    '0x' || LOWER(TO_HEX(tx_hash)) AS transaction_hash,
    CAST(NULL AS VARCHAR) AS order_hash,
    unique_trade_id AS event_id,
    CASE
      WHEN buyer IS NULL THEN NULL
      ELSE '0x' || LOWER(TO_HEX(buyer))
    END AS buyer_wallet,
    CASE
      WHEN seller IS NULL THEN NULL
      ELSE '0x' || LOWER(TO_HEX(seller))
    END AS seller_wallet,
    COALESCE(project, 'unknown') AS marketplace,
    CAST(amount_raw AS VARCHAR) AS price_raw,
    payment_decimals,
    UPPER(currency_symbol) AS payment_symbol,
    UPPER(currency_symbol) AS currency_symbol,
    CASE
      WHEN currency_contract IS NULL THEN NULL
      ELSE '0x' || LOWER(TO_HEX(currency_contract))
    END AS payment_address,
    CASE
      WHEN UPPER(currency_symbol) IN ('ETH', 'WETH') THEN amount_original
      ELSE NULL
    END AS price_eth,
    amount_usd AS price_usd,
    DATE_FORMAT(block_time, '%Y-%m-%dT%H:%i:%s.000Z') AS sold_at,
    'dune:nft.trades:v1' AS source,
    CAST(block_number AS VARCHAR) AS block_number,
    project_version,
    aggregator_name,
    trade_type,
    trade_category,
    CAST(number_of_items AS VARCHAR) AS number_of_items,
    buyer IS NOT NULL AND seller IS NOT NULL AND buyer = seller AS is_self_trade
  FROM filtered_sales
  WHERE duplicate_rank = 1
),
coverage_row AS (
  SELECT
    'warplets_dune_sales_v1' AS schema_version,
    'coverage' AS row_type,
    DATE_FORMAT(coverage_start, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_start,
    DATE_FORMAT(coverage_end, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_end,
    CAST(NULL AS VARCHAR) AS canonical_key,
    CAST(8453 AS BIGINT) AS chain_id,
    '10xwarplets' AS collection_slug,
    '0x780446dd12e080ae0db762fcd4daf313f3e359de' AS contract_address,
    CAST(NULL AS BIGINT) AS token_id,
    CAST(NULL AS VARCHAR) AS transaction_hash,
    CAST(NULL AS VARCHAR) AS order_hash,
    CAST(NULL AS VARCHAR) AS event_id,
    CAST(NULL AS VARCHAR) AS buyer_wallet,
    CAST(NULL AS VARCHAR) AS seller_wallet,
    CAST(NULL AS VARCHAR) AS marketplace,
    CAST(NULL AS VARCHAR) AS price_raw,
    CAST(NULL AS INTEGER) AS payment_decimals,
    CAST(NULL AS VARCHAR) AS payment_symbol,
    CAST(NULL AS VARCHAR) AS currency_symbol,
    CAST(NULL AS VARCHAR) AS payment_address,
    CAST(NULL AS DOUBLE) AS price_eth,
    CAST(NULL AS DOUBLE) AS price_usd,
    CAST(NULL AS VARCHAR) AS sold_at,
    'dune:nft.trades:v1' AS source,
    CAST(NULL AS VARCHAR) AS block_number,
    CAST(NULL AS VARCHAR) AS project_version,
    CAST(NULL AS VARCHAR) AS aggregator_name,
    CAST(NULL AS VARCHAR) AS trade_type,
    CAST(NULL AS VARCHAR) AS trade_category,
    CAST(NULL AS VARCHAR) AS number_of_items,
    CAST(NULL AS BOOLEAN) AS is_self_trade
  FROM bounds
)
SELECT * FROM coverage_row
UNION ALL
SELECT * FROM data_rows
ORDER BY
  row_type DESC,
  sold_at ASC,
  block_number ASC,
  transaction_hash ASC,
  token_id ASC;
