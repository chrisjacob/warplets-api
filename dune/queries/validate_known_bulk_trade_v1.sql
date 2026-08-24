-- One-time validation query. Do not schedule or ingest this result.
--
-- This known app-originated bulk purchase should expose separate Warplet rows
-- for #4512 and #9234. Compare amount_original, number_of_items and the
-- OpenSea receipt before enabling automated Dune ingestion.

SELECT
  t.block_time,
  CAST(t.block_number AS VARCHAR) AS block_number,
  '0x' || LOWER(TO_HEX(t.tx_hash)) AS transaction_hash,
  CAST(t.token_id AS BIGINT) AS token_id,
  t.project AS marketplace,
  t.version AS project_version,
  t.trade_type,
  t.trade_category,
  CAST(t.number_of_items AS VARCHAR) AS number_of_items,
  CAST(t.amount_raw AS VARCHAR) AS amount_raw,
  t.amount_original,
  t.amount_usd,
  UPPER(t.currency_symbol) AS currency_symbol,
  t.unique_trade_id,
  CASE
    WHEN CAST(t.number_of_items AS DOUBLE) > 0
      THEN t.amount_original / CAST(t.number_of_items AS DOUBLE)
    ELSE NULL
  END AS amount_if_evenly_divided
FROM nft.trades AS t
WHERE t.blockchain = 'base'
  AND t.block_month >= DATE '2026-07-01'
  AND t.block_time >= TIMESTAMP '2026-07-02 00:00:00'
  AND t.nft_contract_address = 0x780446dd12e080ae0db762fcd4daf313f3e359de
  AND t.tx_hash = 0xad4aaf07b5c2e3f57403d518a5b95fe0d0b5a248855518e7caed39b486add3c8
ORDER BY
  CAST(t.token_id AS BIGINT) ASC,
  t.unique_trade_id ASC;
