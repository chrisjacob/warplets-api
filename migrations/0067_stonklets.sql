CREATE TABLE IF NOT EXISTS stonklet_favourites (
  identity_wallet TEXT NOT NULL,
  stonklet_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notify_on_launch INTEGER NOT NULL DEFAULT 1 CHECK (notify_on_launch IN (0, 1)),
  first_favourited_at TEXT NOT NULL,
  favourited_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (identity_wallet, stonklet_id)
);

CREATE INDEX IF NOT EXISTS idx_stonklet_favourites_identity_active
  ON stonklet_favourites (identity_wallet, active);

CREATE INDEX IF NOT EXISTS idx_stonklet_favourites_totals
  ON stonklet_favourites (stonklet_id, active);

CREATE INDEX IF NOT EXISTS idx_stonklet_favourites_trending
  ON stonklet_favourites (active, favourited_at, stonklet_id);

CREATE TABLE IF NOT EXISTS stonklet_launch_deliveries (
  stonklet_id TEXT NOT NULL,
  identity_wallet TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  PRIMARY KEY (stonklet_id, identity_wallet)
);
