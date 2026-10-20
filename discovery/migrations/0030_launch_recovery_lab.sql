CREATE TABLE tenx_launch_recovery_labs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  inputs TEXT NOT NULL CHECK(json_valid(inputs)),
  result TEXT NOT NULL CHECK(json_valid(result)),
  metadata TEXT NOT NULL CHECK(json_valid(metadata))
);
CREATE INDEX tenx_launch_recovery_labs_created ON tenx_launch_recovery_labs(created_at);
CREATE TRIGGER tenx_launch_recovery_labs_no_update BEFORE UPDATE ON tenx_launch_recovery_labs
BEGIN SELECT RAISE(ABORT,'launch_recovery_record_immutable'); END;
CREATE TRIGGER tenx_launch_recovery_labs_no_delete BEFORE DELETE ON tenx_launch_recovery_labs
BEGIN SELECT RAISE(ABORT,'launch_recovery_record_immutable'); END;
