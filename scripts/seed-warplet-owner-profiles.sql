-- Seed current-owner Farcaster links from existing Warplets metadata and any
-- already-enriched warplets_users rows in the target D1 database.
--
-- Intended use:
--   pnpm --dir app exec wrangler d1 execute warplets --local --file ../scripts/seed-warplet-owner-profiles.sql
--
-- Later, the same file can be run remotely after migrations are applied.

INSERT OR IGNORE INTO wallet_farcaster_links (
  wallet,
  fid,
  score,
  username,
  display_name,
  pfp_url,
  profile_bio_text,
  follower_count,
  following_count,
  fetched_at
)
SELECT
  source.wallet,
  source.fid,
  NULL AS score,
  source.username,
  NULL AS display_name,
  NULL AS pfp_url,
  NULL AS profile_bio_text,
  NULL AS follower_count,
  NULL AS following_count,
  CURRENT_TIMESTAMP AS fetched_at
FROM (
  SELECT
    LOWER(TRIM(warplet_wallet)) AS wallet,
    CAST(fid_value AS INTEGER) AS fid,
    MAX(NULLIF(TRIM(warplet_username_farcaster), '')) AS username
  FROM warplets_metadata
  WHERE warplet_wallet IS NOT NULL
    AND TRIM(warplet_wallet) <> ''
    AND fid_value IS NOT NULL
    AND CAST(fid_value AS INTEGER) > 0
  GROUP BY LOWER(TRIM(warplet_wallet)), CAST(fid_value AS INTEGER)
) AS source
;

UPDATE wallet_farcaster_links
SET username = COALESCE(username, (
  SELECT MAX(NULLIF(TRIM(warplets_metadata.warplet_username_farcaster), ''))
  FROM warplets_metadata
  WHERE LOWER(TRIM(warplets_metadata.warplet_wallet)) = wallet_farcaster_links.wallet
    AND CAST(warplets_metadata.fid_value AS INTEGER) = wallet_farcaster_links.fid
))
WHERE username IS NULL
  AND EXISTS (
    SELECT 1
    FROM warplets_metadata
    WHERE LOWER(TRIM(warplets_metadata.warplet_wallet)) = wallet_farcaster_links.wallet
      AND CAST(warplets_metadata.fid_value AS INTEGER) = wallet_farcaster_links.fid
  );

INSERT OR IGNORE INTO wallet_farcaster_links (
  wallet,
  fid,
  score,
  username,
  display_name,
  pfp_url,
  profile_bio_text,
  follower_count,
  following_count,
  fetched_at
)
SELECT
  LOWER(TRIM(primary_eth_address)) AS wallet,
  fid,
  score,
  username,
  display_name,
  pfp_url,
  profile_bio_text,
  follower_count,
  following_count,
  CURRENT_TIMESTAMP AS fetched_at
FROM warplets_users
WHERE primary_eth_address IS NOT NULL
  AND TRIM(primary_eth_address) <> ''
  AND fid IS NOT NULL;

UPDATE wallet_farcaster_links
SET
  score = COALESCE((
    SELECT warplets_users.score
    FROM warplets_users
    WHERE warplets_users.fid = wallet_farcaster_links.fid
    LIMIT 1
  ), score),
  username = COALESCE((
    SELECT warplets_users.username
    FROM warplets_users
    WHERE warplets_users.fid = wallet_farcaster_links.fid
    LIMIT 1
  ), username),
  display_name = COALESCE((
    SELECT warplets_users.display_name
    FROM warplets_users
    WHERE warplets_users.fid = wallet_farcaster_links.fid
    LIMIT 1
  ), display_name),
  pfp_url = COALESCE((
    SELECT warplets_users.pfp_url
    FROM warplets_users
    WHERE warplets_users.fid = wallet_farcaster_links.fid
    LIMIT 1
  ), pfp_url),
  profile_bio_text = COALESCE((
    SELECT warplets_users.profile_bio_text
    FROM warplets_users
    WHERE warplets_users.fid = wallet_farcaster_links.fid
    LIMIT 1
  ), profile_bio_text),
  follower_count = COALESCE((
    SELECT warplets_users.follower_count
    FROM warplets_users
    WHERE warplets_users.fid = wallet_farcaster_links.fid
    LIMIT 1
  ), follower_count),
  following_count = COALESCE((
    SELECT warplets_users.following_count
    FROM warplets_users
    WHERE warplets_users.fid = wallet_farcaster_links.fid
    LIMIT 1
  ), following_count),
  fetched_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM warplets_users
  WHERE warplets_users.fid = wallet_farcaster_links.fid
);

INSERT OR IGNORE INTO warplet_market_state (
  token_id,
  owner_wallet,
  owner_fid,
  owner_checked_at,
  created_at,
  updated_at
)
SELECT
  token_id,
  LOWER(TRIM(warplet_wallet)) AS owner_wallet,
  CAST(fid_value AS INTEGER) AS owner_fid,
  NULL AS owner_checked_at,
  CURRENT_TIMESTAMP AS created_at,
  CURRENT_TIMESTAMP AS updated_at
FROM warplets_metadata
WHERE warplet_wallet IS NOT NULL
  AND TRIM(warplet_wallet) <> ''
  AND fid_value IS NOT NULL
  AND CAST(fid_value AS INTEGER) > 0;

UPDATE warplet_market_state
SET
  owner_wallet = COALESCE(owner_wallet, (
    SELECT LOWER(TRIM(warplets_metadata.warplet_wallet))
    FROM warplets_metadata
    WHERE warplets_metadata.token_id = warplet_market_state.token_id
    LIMIT 1
  )),
  owner_fid = (
    SELECT CAST(warplets_metadata.fid_value AS INTEGER)
    FROM warplets_metadata
    WHERE warplets_metadata.token_id = warplet_market_state.token_id
      AND LOWER(TRIM(warplets_metadata.warplet_wallet)) = LOWER(TRIM(warplet_market_state.owner_wallet))
    LIMIT 1
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE owner_fid IS NULL
  AND EXISTS (
    SELECT 1
    FROM warplets_metadata
    WHERE warplets_metadata.token_id = warplet_market_state.token_id
      AND LOWER(TRIM(warplets_metadata.warplet_wallet)) = LOWER(TRIM(warplet_market_state.owner_wallet))
      AND fid_value IS NOT NULL
      AND CAST(fid_value AS INTEGER) > 0
  );
