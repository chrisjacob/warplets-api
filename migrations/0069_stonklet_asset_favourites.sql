CREATE TABLE IF NOT EXISTS stonklet_asset_favourites (
  identity_wallet TEXT NOT NULL,
  pair_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('stock', 'stonklet')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notify_on_launch INTEGER NOT NULL DEFAULT 0 CHECK (notify_on_launch IN (0, 1)),
  first_favourited_at TEXT NOT NULL,
  favourited_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (identity_wallet, pair_id, asset)
);

INSERT OR IGNORE INTO stonklet_asset_favourites (
  identity_wallet,
  pair_id,
  asset,
  active,
  notify_on_launch,
  first_favourited_at,
  favourited_at,
  updated_at
)
SELECT
  identity_wallet,
  stonklet_id,
  'stonklet',
  active,
  notify_on_launch,
  first_favourited_at,
  favourited_at,
  updated_at
FROM stonklet_favourites;

CREATE INDEX IF NOT EXISTS idx_stonklet_asset_favourites_identity_active
  ON stonklet_asset_favourites (identity_wallet, asset, active);

CREATE INDEX IF NOT EXISTS idx_stonklet_asset_favourites_totals
  ON stonklet_asset_favourites (pair_id, asset, active);

CREATE INDEX IF NOT EXISTS idx_stonklet_asset_favourites_trending
  ON stonklet_asset_favourites (asset, active, favourited_at, pair_id);
