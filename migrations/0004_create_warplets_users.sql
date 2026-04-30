-- Tracks unique users who click the claim CTA and optional enrichment from Neynar.
CREATE TABLE IF NOT EXISTS warplets_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fid INTEGER NOT NULL UNIQUE,

  username TEXT,
  display_name TEXT,
  pfp_url TEXT,
  registered_at TEXT,
  pro_status TEXT,
  profile_bio_text TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  primary_eth_address TEXT,
  primary_sol_address TEXT,
  x_username TEXT,
  url TEXT,
  viewer_following INTEGER,
  viewer_followed_by INTEGER,
  score REAL,

  matched_on TEXT,
  buy_on TEXT,

  created_on TEXT NOT NULL DEFAULT (datetime('now')),
  updated_on TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_warplets_users_fid
  ON warplets_users(fid);

CREATE INDEX IF NOT EXISTS idx_warplets_users_matched_on
  ON warplets_users(matched_on);

CREATE INDEX IF NOT EXISTS idx_warplets_users_buy_on
  ON warplets_users(buy_on);

CREATE INDEX IF NOT EXISTS idx_warplets_users_primary_eth_address
  ON warplets_users(primary_eth_address);
