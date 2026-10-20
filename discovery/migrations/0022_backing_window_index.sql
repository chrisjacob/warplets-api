CREATE TABLE tenx_backing_window_index (
  run_id TEXT PRIMARY KEY REFERENCES tenx_backing_runs(id),
  payload TEXT NOT NULL, reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK(reserved_calls BETWEEN 0 AND 64),
  lease_owner TEXT, lease_until TEXT, next_attempt_at TEXT, last_error TEXT
);
CREATE TABLE tenx_backing_index_usage (day TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK(used>=0));
