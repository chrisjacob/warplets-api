-- New prospective score observations; historical cohorts remain unchanged.
CREATE TABLE tenx_score_cohorts (
  address TEXT NOT NULL, model TEXT NOT NULL CHECK(model='discovery-score-v1'),
  captured_at TEXT NOT NULL, day TEXT NOT NULL, cohort_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 1900000),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(address,model)
);
CREATE INDEX tenx_score_cohorts_time ON tenx_score_cohorts(captured_at,address);
CREATE INDEX tenx_score_cohorts_day ON tenx_score_cohorts(day);
CREATE TABLE tenx_score_outcomes (
  address TEXT NOT NULL, model TEXT NOT NULL, cohort_hash TEXT NOT NULL,
  finalized_at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(address,model), FOREIGN KEY(address,model) REFERENCES tenx_score_cohorts(address,model)
);
CREATE TABLE tenx_score_attempts (address TEXT PRIMARY KEY,attempted_at TEXT NOT NULL,gap TEXT NOT NULL);
CREATE TABLE tenx_score_control (id INTEGER PRIMARY KEY CHECK(id=1),lease_owner TEXT,lease_until TEXT,next_at TEXT,last_success TEXT,last_error TEXT);
INSERT INTO tenx_score_control(id) VALUES(1);
