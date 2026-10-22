-- Original dispatch selection is retained atomically with the existing job.
-- One attempt per accepted activity; never reopen a job after a lost response.
CREATE TABLE tenx_gmgn_event_collections (
  activity_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES tenx_jobs(id),
  plan_hash TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(json_valid(plan) AND length(CAST(plan AS BLOB))<=32000),
  created_at TEXT NOT NULL
);
CREATE TRIGGER tenx_gmgn_event_collection_immutable_update
BEFORE UPDATE ON tenx_gmgn_event_collections BEGIN SELECT RAISE(ABORT,'gmgn_event_collection_immutable'); END;
CREATE TRIGGER tenx_gmgn_event_collection_immutable_delete
BEFORE DELETE ON tenx_gmgn_event_collections BEGIN SELECT RAISE(ABORT,'gmgn_event_collection_immutable'); END;
