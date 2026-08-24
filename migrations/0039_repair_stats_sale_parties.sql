-- Repair buyer/seller identities for Stats sale rows initially derived from
-- legacy activity records. The activity table's actor/counterparty columns did
-- not consistently describe the OpenSea buyer and seller, while raw_payload
-- retained the canonical parties.

CREATE INDEX IF NOT EXISTS idx_wallet_farcaster_links_fid_wallet
  ON wallet_farcaster_links (fid, wallet);

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
    CASE
      WHEN a.transaction_hash IS NOT NULL AND TRIM(a.transaction_hash) <> ''
        THEN '8453:' || LOWER(TRIM(a.transaction_hash)) || ':' || a.token_id
      WHEN a.order_hash IS NOT NULL AND TRIM(a.order_hash) <> ''
        THEN '8453:' || LOWER(TRIM(a.order_hash)) || ':' || a.token_id
      ELSE 'activity:' || a.id
    END AS canonical_key,
    a.actor_wallet,
    a.actor_fid,
    a.counterparty_wallet,
    a.counterparty_fid,
    NULLIF(LOWER(TRIM(COALESCE(a.raw_buyer_wallet, a.counterparty_wallet))), '') AS buyer_wallet,
    NULLIF(LOWER(TRIM(COALESCE(a.raw_seller_wallet, a.actor_wallet))), '') AS seller_wallet
  FROM activity_raw a
),
resolved_activity AS (
  SELECT
    a.canonical_key,
    a.buyer_wallet,
    a.seller_wallet,
    COALESCE(
      (
        SELECT l.fid
        FROM wallet_farcaster_links l
        WHERE LOWER(TRIM(l.wallet)) = a.buyer_wallet
        ORDER BY COALESCE(l.score, -1) DESC, l.fid ASC
        LIMIT 1
      ),
      (
        SELECT u.fid
        FROM warplets_users u
        WHERE LOWER(TRIM(u.primary_eth_address)) = a.buyer_wallet
        ORDER BY u.fid ASC
        LIMIT 1
      ),
      CASE
        WHEN LOWER(TRIM(a.actor_wallet)) = a.buyer_wallet THEN a.actor_fid
        WHEN LOWER(TRIM(a.counterparty_wallet)) = a.buyer_wallet THEN a.counterparty_fid
        ELSE NULL
      END
    ) AS buyer_fid,
    COALESCE(
      (
        SELECT l.fid
        FROM wallet_farcaster_links l
        WHERE LOWER(TRIM(l.wallet)) = a.seller_wallet
        ORDER BY COALESCE(l.score, -1) DESC, l.fid ASC
        LIMIT 1
      ),
      (
        SELECT u.fid
        FROM warplets_users u
        WHERE LOWER(TRIM(u.primary_eth_address)) = a.seller_wallet
        ORDER BY u.fid ASC
        LIMIT 1
      ),
      CASE
        WHEN LOWER(TRIM(a.actor_wallet)) = a.seller_wallet THEN a.actor_fid
        WHEN LOWER(TRIM(a.counterparty_wallet)) = a.seller_wallet THEN a.counterparty_fid
        ELSE NULL
      END
    ) AS seller_fid
  FROM normalized_activity a
)
UPDATE warplet_sales
SET
  buyer_wallet = (
    SELECT a.buyer_wallet
    FROM resolved_activity a
    WHERE a.canonical_key = warplet_sales.canonical_key
  ),
  seller_wallet = (
    SELECT a.seller_wallet
    FROM resolved_activity a
    WHERE a.canonical_key = warplet_sales.canonical_key
  ),
  buyer_fid = (
    SELECT a.buyer_fid
    FROM resolved_activity a
    WHERE a.canonical_key = warplet_sales.canonical_key
  ),
  seller_fid = (
    SELECT a.seller_fid
    FROM resolved_activity a
    WHERE a.canonical_key = warplet_sales.canonical_key
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'warplet_activity_events'
  AND canonical_key IN (
    SELECT canonical_key
    FROM resolved_activity
  );
