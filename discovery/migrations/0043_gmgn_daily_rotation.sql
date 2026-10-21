-- Separate from first-grade scoring cohorts. Freeze the full inventory before IO.
CREATE TABLE tenx_gmgn_daily_cohorts (
  day TEXT PRIMARY KEY,
  cutoff TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=400000),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  CHECK(json_extract(payload,'$.version')='gmgn-daily-rotation-v1'),
  CHECK(json_extract(payload,'$.day')=day),
  CHECK(json_extract(payload,'$.cutoff')=cutoff),
  CHECK(json_array_length(payload,'$.selected')<=3)
);
CREATE TRIGGER tenx_gmgn_daily_cohorts_no_update BEFORE UPDATE ON tenx_gmgn_daily_cohorts BEGIN SELECT RAISE(ABORT,'immutable_gmgn_daily_cohort'); END;
CREATE TRIGGER tenx_gmgn_daily_cohorts_no_delete BEFORE DELETE ON tenx_gmgn_daily_cohorts BEGIN SELECT RAISE(ABORT,'immutable_gmgn_daily_cohort'); END;
