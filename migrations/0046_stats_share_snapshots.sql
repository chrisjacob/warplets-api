CREATE TABLE IF NOT EXISTS stats_share_snapshots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  request_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  title TEXT NOT NULL,
  farcaster_text TEXT NOT NULL,
  twitter_text TEXT NOT NULL,
  launch_path TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (image_status IN ('pending', 'ready', 'error')),
  image_error TEXT,
  renderer_version TEXT NOT NULL,
  data_as_of TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stats_share_snapshots_kind_as_of
  ON stats_share_snapshots (kind, data_as_of DESC);

CREATE INDEX IF NOT EXISTS idx_stats_share_snapshots_created_at
  ON stats_share_snapshots (created_at DESC);
