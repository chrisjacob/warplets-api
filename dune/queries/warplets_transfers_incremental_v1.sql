-- 10X Warplets: bounded daily ERC-721 transfer feed (v1)
--
-- This is the query referenced by DUNE_TRANSFERS_QUERY_ID. It scans a rolling
-- 48-hour window ending two hours before execution. The overlap makes a daily
-- schedule tolerant of indexing delays; D1 canonical-key upserts deduplicate
-- rows across executions.
--
-- Its output contract exactly matches warplets_transfers_backfill_v1.sql.

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
filtered_transfers AS (
  SELECT
    t.block_time,
    t.block_number,
    t."index" AS evt_index,
    CAST(VARBINARY_TO_UINT256(t.topic3) AS BIGINT) AS token_id,
    UINT256 '1' AS amount,
    VARBINARY_SUBSTRING(t.topic1, 13, 20) AS from_wallet,
    VARBINARY_SUBSTRING(t.topic2, 13, 20) AS to_wallet,
    t.tx_from AS executed_by,
    t.tx_hash,
    'single' AS transfer_type,
    '0x' || LOWER(TO_HEX(t.tx_hash)) || ':' ||
      CAST(t."index" AS VARCHAR) AS unique_transfer_id,
    b.coverage_start,
    b.coverage_end
  FROM base.logs AS t
  CROSS JOIN bounds AS b
  WHERE t.block_date >= CAST(b.coverage_start AS DATE)
    AND t.block_time >= b.coverage_start
    AND t.block_time < b.coverage_end
    AND t.contract_address = 0x780446dd12e080ae0db762fcd4daf313f3e359de
    AND t.topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    AND t.topic1 IS NOT NULL
    AND t.topic2 IS NOT NULL
    AND t.topic3 IS NOT NULL
    AND t.tx_hash IS NOT NULL
    AND VARBINARY_TO_UINT256(t.topic3) BETWEEN UINT256 '1' AND UINT256 '10000'
),
data_rows AS (
  SELECT
    'warplets_dune_transfers_v1' AS schema_version,
    'data' AS row_type,
    DATE_FORMAT(coverage_start, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_start,
    DATE_FORMAT(coverage_end, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_end,
    '8453:0x' || LOWER(TO_HEX(tx_hash)) || ':' ||
      CAST(evt_index AS VARCHAR) || ':' || CAST(token_id AS VARCHAR) AS canonical_key,
    8453 AS chain_id,
    '10xwarplets' AS collection_slug,
    '0x780446dd12e080ae0db762fcd4daf313f3e359de' AS contract_address,
    token_id,
    '0x' || LOWER(TO_HEX(tx_hash)) AS transaction_hash,
    evt_index AS event_index,
    CAST(block_number AS VARCHAR) AS block_number,
    CASE
      WHEN from_wallet IS NULL THEN NULL
      ELSE '0x' || LOWER(TO_HEX(from_wallet))
    END AS from_wallet,
    CASE
      WHEN to_wallet IS NULL THEN NULL
      ELSE '0x' || LOWER(TO_HEX(to_wallet))
    END AS to_wallet,
    CASE
      WHEN executed_by IS NULL THEN NULL
      ELSE '0x' || LOWER(TO_HEX(executed_by))
    END AS executed_by,
    CAST(amount AS VARCHAR) AS amount,
    transfer_type,
    unique_transfer_id AS event_id,
    DATE_FORMAT(block_time, '%Y-%m-%dT%H:%i:%s.000Z') AS transferred_at,
    'dune:nft.transfers:v1' AS source
  FROM filtered_transfers
),
coverage_row AS (
  SELECT
    'warplets_dune_transfers_v1' AS schema_version,
    'coverage' AS row_type,
    DATE_FORMAT(coverage_start, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_start,
    DATE_FORMAT(coverage_end, '%Y-%m-%dT%H:%i:%s.000Z') AS coverage_end,
    CAST(NULL AS VARCHAR) AS canonical_key,
    CAST(8453 AS BIGINT) AS chain_id,
    '10xwarplets' AS collection_slug,
    '0x780446dd12e080ae0db762fcd4daf313f3e359de' AS contract_address,
    CAST(NULL AS BIGINT) AS token_id,
    CAST(NULL AS VARCHAR) AS transaction_hash,
    CAST(NULL AS BIGINT) AS event_index,
    CAST(NULL AS VARCHAR) AS block_number,
    CAST(NULL AS VARCHAR) AS from_wallet,
    CAST(NULL AS VARCHAR) AS to_wallet,
    CAST(NULL AS VARCHAR) AS executed_by,
    CAST(NULL AS VARCHAR) AS amount,
    CAST(NULL AS VARCHAR) AS transfer_type,
    CAST(NULL AS VARCHAR) AS event_id,
    CAST(NULL AS VARCHAR) AS transferred_at,
    'dune:nft.transfers:v1' AS source
  FROM bounds
)
SELECT * FROM coverage_row
UNION ALL
SELECT * FROM data_rows
ORDER BY
  row_type DESC,
  transferred_at ASC,
  block_number ASC,
  event_index ASC,
  token_id ASC;
