-- Read-mostly metadata table for the full 10K Warplets collection.
-- Data is sourced from 10x-warplets-metadata.csv via migration 0003.
CREATE TABLE IF NOT EXISTS warplets_metadata (
  token_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  opensea_url TEXT NOT NULL,
  image_url TEXT NOT NULL,
  animation_url TEXT NOT NULL,

  x10_level TEXT,
  x10_rank INTEGER,
  x10_rarity INTEGER,

  cast_level TEXT,
  cast_rank INTEGER,
  cast_value INTEGER,

  fid_level TEXT,
  fid_rank INTEGER,
  fid_value INTEGER,

  follower_level TEXT,
  follower_rank INTEGER,
  follower_value INTEGER,

  holder_level TEXT,
  holder_rank INTEGER,
  holder_value INTEGER,

  luck_level TEXT,
  luck_rank INTEGER,
  luck_value INTEGER,

  minter_level TEXT,
  minter_rank INTEGER,
  minter_value TEXT,

  neynar_level TEXT,
  neynar_rank INTEGER,
  neynar_value TEXT,

  nft_level TEXT,
  nft_rank INTEGER,
  nft_value TEXT,

  token_level TEXT,
  token_rank INTEGER,
  token_value TEXT,

  volume_level TEXT,
  volume_rank INTEGER,
  volume_value TEXT,

  warplet_colours TEXT,
  warplet_keywords TEXT,
  warplet_traits TEXT,
  warplet_user_is_pro TEXT,
  warplet_username_farcaster TEXT,
  warplet_username_x TEXT,
  warplet_wallet TEXT,

  avif_url TEXT,
  jpg_url TEXT,
  png_url TEXT,
  webp_url TEXT,
  external_url TEXT,
  secret_level TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warplets_metadata_name
  ON warplets_metadata(name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warplets_metadata_opensea_url
  ON warplets_metadata(opensea_url);

-- Primary lookup path for matching a Farcaster viewer to collection metadata.
CREATE INDEX IF NOT EXISTS idx_warplets_metadata_fid_value
  ON warplets_metadata(fid_value);

CREATE INDEX IF NOT EXISTS idx_warplets_metadata_warplet_wallet
  ON warplets_metadata(warplet_wallet);

CREATE INDEX IF NOT EXISTS idx_warplets_metadata_username_farcaster
  ON warplets_metadata(warplet_username_farcaster);

CREATE INDEX IF NOT EXISTS idx_warplets_metadata_secret_level
  ON warplets_metadata(secret_level);
