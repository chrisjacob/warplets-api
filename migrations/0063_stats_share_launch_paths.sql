CREATE INDEX IF NOT EXISTS idx_stats_share_snapshots_launch_ready_created
  ON stats_share_snapshots (launch_path, image_status, created_at DESC);
