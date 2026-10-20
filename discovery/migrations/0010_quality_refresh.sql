CREATE TABLE tenx_quality_control (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_owner TEXT, lease_until TEXT,
  next_refresh_at TEXT, last_success TEXT, last_error TEXT, targets INTEGER NOT NULL DEFAULT 0
);
INSERT INTO tenx_quality_control(id) VALUES(1);
CREATE TABLE tenx_quality_usage(day TEXT PRIMARY KEY,used INTEGER NOT NULL CHECK(used>=0));
CREATE TABLE tenx_quality_attempts(address TEXT PRIMARY KEY,state_at TEXT,holder_at TEXT,holder_error TEXT);
