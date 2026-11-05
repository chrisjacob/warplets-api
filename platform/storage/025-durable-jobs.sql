CREATE TABLE app_jobs (
 id TEXT PRIMARY KEY,business_key TEXT NOT NULL UNIQUE,type TEXT NOT NULL,
 payload_json TEXT NOT NULL,payload_digest TEXT NOT NULL,principal TEXT NOT NULL,
 request_key TEXT NOT NULL,request_digest TEXT NOT NULL,expected_revisions TEXT NOT NULL,
 source_key TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('queued','running','held','retry','completed','failed')),
 ready_ms INTEGER,attempt INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 20),
 lease_token TEXT,lease_until_ms INTEGER,lease_started_ms INTEGER,revision INTEGER NOT NULL DEFAULT 0,
 checkpoint_json TEXT NOT NULL DEFAULT '{}',checkpoint_seq INTEGER NOT NULL DEFAULT 0,
 result_json TEXT,result_digest TEXT,reason TEXT,dependency TEXT,wake_digest TEXT,
 created_ms INTEGER NOT NULL,finished_ms INTEGER,
 UNIQUE(principal,request_key),
 CHECK((state='running')=(lease_token IS NOT NULL AND lease_until_ms IS NOT NULL))
) STRICT;
CREATE INDEX app_jobs_ready ON app_jobs(state,ready_ms,id);
CREATE TABLE app_job_attempts (
 job_id TEXT NOT NULL REFERENCES app_jobs(id),attempt INTEGER NOT NULL,lease_token TEXT NOT NULL UNIQUE,
 started_ms INTEGER NOT NULL,ended_ms INTEGER,outcome TEXT,
 PRIMARY KEY(job_id,attempt)
) STRICT;
CREATE TABLE app_job_events (
 job_id TEXT NOT NULL REFERENCES app_jobs(id),event_key TEXT NOT NULL,payload_digest TEXT NOT NULL,wake_token TEXT NOT NULL,
 PRIMARY KEY(job_id,event_key)
) STRICT;
-- Source repositories append this row in their source-event transaction. The
-- manual runner reconciles it before claiming work; transport loss cannot erase
-- the durable enqueue obligation. No handler receives arbitrary SQL callbacks.
CREATE TABLE app_job_outbox (
 source_key TEXT PRIMARY KEY,command_json TEXT NOT NULL,request_digest TEXT NOT NULL,
 job_id TEXT REFERENCES app_jobs(id)
) STRICT;
CREATE TRIGGER app_job_outbox_identity BEFORE UPDATE ON app_job_outbox WHEN
 NEW.source_key<>OLD.source_key OR NEW.command_json<>OLD.command_json OR NEW.request_digest<>OLD.request_digest
 OR (OLD.job_id IS NOT NULL AND NEW.job_id IS NOT OLD.job_id)
 BEGIN SELECT RAISE(ABORT,'Job source identity is immutable'); END;
CREATE TRIGGER app_job_outbox_no_delete BEFORE DELETE ON app_job_outbox BEGIN SELECT RAISE(ABORT,'Retain job source obligation'); END;
CREATE TRIGGER app_jobs_identity BEFORE UPDATE ON app_jobs WHEN
 NEW.id<>OLD.id OR NEW.business_key<>OLD.business_key OR NEW.type<>OLD.type OR NEW.payload_json<>OLD.payload_json
 OR NEW.payload_digest<>OLD.payload_digest OR NEW.principal<>OLD.principal OR NEW.request_key<>OLD.request_key
 OR NEW.request_digest<>OLD.request_digest OR NEW.expected_revisions<>OLD.expected_revisions
 OR NEW.source_key<>OLD.source_key OR NEW.created_ms<>OLD.created_ms OR NEW.max_attempts<>OLD.max_attempts
 BEGIN SELECT RAISE(ABORT,'Job identity is immutable'); END;
CREATE TRIGGER app_jobs_terminal BEFORE UPDATE ON app_jobs WHEN OLD.state IN ('completed','failed')
 BEGIN SELECT RAISE(ABORT,'Terminal job result is immutable'); END;
CREATE TRIGGER app_jobs_no_delete BEFORE DELETE ON app_jobs BEGIN SELECT RAISE(ABORT,'Retain job receipts'); END;
CREATE TRIGGER app_jobs_claim AFTER UPDATE ON app_jobs WHEN NEW.state='running' AND NEW.lease_token IS NOT OLD.lease_token BEGIN
 UPDATE app_job_attempts SET ended_ms=NEW.lease_started_ms,outcome='lease-replaced'
  WHERE job_id=NEW.id AND ended_ms IS NULL;
 INSERT INTO app_job_attempts VALUES(NEW.id,NEW.attempt,NEW.lease_token,NEW.lease_started_ms,NULL,NULL);
 INSERT INTO app_execution_fences VALUES(NEW.business_key,NEW.lease_token,NEW.lease_until_ms,NEW.revision,NEW.payload_digest)
  ON CONFLICT(business_key) DO UPDATE SET holder_token=excluded.holder_token,expires_ms=excluded.expires_ms,
   revision=excluded.revision,payload_digest=excluded.payload_digest;
END;
CREATE TRIGGER app_jobs_finish AFTER UPDATE ON app_jobs WHEN OLD.state='running' AND NEW.state<>'running' BEGIN
 UPDATE app_job_attempts SET ended_ms=NEW.finished_ms,outcome=NEW.state WHERE job_id=NEW.id AND lease_token=OLD.lease_token;
 UPDATE app_execution_fences SET expires_ms=0 WHERE business_key=NEW.business_key AND holder_token=OLD.lease_token;
END;
