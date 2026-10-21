-- Widen model identity without recomputing any retained artifact or checksum.
-- D1 applies a migration transactionally; defer the existing child reference
-- while replacing its parent table, then restore the original parent name.
PRAGMA defer_foreign_keys = on;
CREATE TABLE tenx_score_cohorts_next (
  address TEXT NOT NULL, model TEXT NOT NULL CHECK(model IN ('discovery-score-v1','discovery-score-v2','discovery-score-v3')),
  captured_at TEXT NOT NULL, day TEXT NOT NULL, cohort_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 1900000),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(address,model)
);
INSERT INTO tenx_score_cohorts_next SELECT * FROM tenx_score_cohorts;
DROP TABLE tenx_score_cohorts;
ALTER TABLE tenx_score_cohorts_next RENAME TO tenx_score_cohorts;
CREATE INDEX tenx_score_cohorts_time ON tenx_score_cohorts(captured_at,address);
CREATE INDEX tenx_score_cohorts_day ON tenx_score_cohorts(day);
CREATE TABLE tenx_score_attempts_next (
  address TEXT NOT NULL,model TEXT NOT NULL CHECK(model IN ('discovery-score-v1','discovery-score-v2','discovery-score-v3')),
  attempted_at TEXT NOT NULL,gap TEXT NOT NULL,PRIMARY KEY(address,model)
);
INSERT INTO tenx_score_attempts_next SELECT address,model,attempted_at,gap FROM tenx_score_attempts;
DROP TABLE tenx_score_attempts;
ALTER TABLE tenx_score_attempts_next RENAME TO tenx_score_attempts;
PRAGMA defer_foreign_keys = off;
