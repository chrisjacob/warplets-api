-- Private review obligations. Suggestions never write final scores or rewards.
CREATE TABLE ai_review_jobs (
 id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES earn_submissions(id),
 kind TEXT NOT NULL CHECK(kind IN ('initial','appeal')),previous_report_id TEXT,appeal_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('awaiting-capture','ready','running','completed','failed','unknown','held')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
 lease_token TEXT,lease_until_ms INTEGER,dispatched_ms INTEGER,reason TEXT,
 created_ms INTEGER NOT NULL CHECK(created_ms>=0),updated_ms INTEGER NOT NULL CHECK(updated_ms>=created_ms),
 CHECK((kind='initial' AND previous_report_id IS NULL AND appeal_id IS NULL) OR (kind='appeal' AND previous_report_id IS NOT NULL AND appeal_id IS NOT NULL)),
 CHECK((state='running' AND lease_token IS NOT NULL AND lease_until_ms IS NOT NULL) OR (state<>'running' AND lease_token IS NULL AND lease_until_ms IS NULL))
) STRICT;
CREATE UNIQUE INDEX ai_review_initial ON ai_review_jobs(submission_id) WHERE kind='initial';
CREATE UNIQUE INDEX ai_review_appeal_job ON ai_review_jobs(appeal_id) WHERE appeal_id IS NOT NULL;
CREATE UNIQUE INDEX ai_review_child_report ON ai_review_jobs(previous_report_id) WHERE previous_report_id IS NOT NULL;
CREATE INDEX ai_review_ready ON ai_review_jobs(state,created_ms,id);
CREATE INDEX ai_review_submission ON ai_review_jobs(submission_id,created_ms DESC,id);
CREATE TABLE ai_review_captures (
 job_id TEXT PRIMARY KEY REFERENCES ai_review_jobs(id),job_json TEXT NOT NULL CHECK(json_valid(job_json) AND length(CAST(job_json AS BLOB))<=131072),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64),evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 512),
 captured_by TEXT NOT NULL,created_ms INTEGER NOT NULL CHECK(created_ms>=0)
) STRICT;
CREATE TABLE ai_review_reports (
 report_id TEXT PRIMARY KEY CHECK(length(report_id)=64),job_id TEXT NOT NULL UNIQUE REFERENCES ai_review_jobs(id),
 submission_id TEXT NOT NULL REFERENCES earn_submissions(id),report_json TEXT NOT NULL CHECK(json_valid(report_json) AND length(CAST(report_json AS BLOB))<=131072),
 created_ms INTEGER NOT NULL CHECK(created_ms>=0)
) STRICT;
CREATE INDEX ai_review_report_submission ON ai_review_reports(submission_id,created_ms DESC,report_id);
CREATE TABLE ai_review_appeals (
 appeal_id TEXT PRIMARY KEY CHECK(length(appeal_id)=64),submission_id TEXT NOT NULL REFERENCES earn_submissions(id),
 report_id TEXT NOT NULL UNIQUE REFERENCES ai_review_reports(report_id),job_id TEXT NOT NULL UNIQUE REFERENCES ai_review_jobs(id),
 wallet TEXT NOT NULL,request_key TEXT NOT NULL,request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 appeal_json TEXT NOT NULL CHECK(json_valid(appeal_json) AND length(CAST(appeal_json AS BLOB))<=16384),created_ms INTEGER NOT NULL CHECK(created_ms>=0),
 UNIQUE(wallet,request_key)
) STRICT;
CREATE TABLE ai_review_attempts (
 job_id TEXT NOT NULL REFERENCES ai_review_jobs(id),attempt INTEGER NOT NULL CHECK(attempt>0),lease_token TEXT NOT NULL UNIQUE,
 started_ms INTEGER NOT NULL CHECK(started_ms>=0),dispatched_ms INTEGER,ended_ms INTEGER,outcome TEXT,
 PRIMARY KEY(job_id,attempt),CHECK((ended_ms IS NULL AND outcome IS NULL) OR (ended_ms IS NOT NULL AND outcome IS NOT NULL))
) STRICT;
CREATE TRIGGER ai_review_job_identity BEFORE UPDATE ON ai_review_jobs WHEN
 NEW.id IS NOT OLD.id OR NEW.submission_id IS NOT OLD.submission_id OR NEW.kind IS NOT OLD.kind OR NEW.previous_report_id IS NOT OLD.previous_report_id OR NEW.appeal_id IS NOT OLD.appeal_id OR NEW.created_ms IS NOT OLD.created_ms OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'Retain review job identity and revision'); END;
CREATE TRIGGER ai_review_job_terminal BEFORE UPDATE ON ai_review_jobs WHEN OLD.state IN ('completed','failed','unknown') BEGIN SELECT RAISE(ABORT,'Retain terminal review outcome'); END;
CREATE TRIGGER ai_review_attempt_identity BEFORE UPDATE ON ai_review_attempts WHEN
 NEW.job_id IS NOT OLD.job_id OR NEW.attempt IS NOT OLD.attempt OR NEW.lease_token IS NOT OLD.lease_token OR NEW.started_ms IS NOT OLD.started_ms OR OLD.ended_ms IS NOT NULL OR (OLD.dispatched_ms IS NOT NULL AND NEW.dispatched_ms IS NOT OLD.dispatched_ms)
 BEGIN SELECT RAISE(ABORT,'Retain review attempt evidence'); END;
-- Source and obligation commit together, including lost HTTP responses.
CREATE TRIGGER ai_review_submission_obligation AFTER INSERT ON earn_submissions
 WHEN NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE status='restoring')
 BEGIN INSERT INTO ai_review_jobs(id,submission_id,kind,state,created_ms,updated_ms) VALUES('submission:'||NEW.id,NEW.id,'initial','awaiting-capture',NEW.submitted_ms,NEW.submitted_ms); END;
-- Do not reopen settled historical submissions when upgrading an existing demo.
INSERT INTO ai_review_jobs(id,submission_id,kind,state,created_ms,updated_ms)
 SELECT 'submission:'||s.id,s.id,'initial','awaiting-capture',s.submitted_ms,s.submitted_ms FROM earn_submissions s
 WHERE NOT EXISTS(SELECT 1 FROM earn_reviews r WHERE r.submission_id=s.id)
 AND EXISTS(SELECT 1 FROM app_recovery_state WHERE mode<>'public' AND status IN ('live','ready'));
CREATE TRIGGER ai_review_jobs_no_delete BEFORE DELETE ON ai_review_jobs BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER recovery_guard_ai_review_jobs_insert BEFORE INSERT ON ai_review_jobs WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_jobs_insert AFTER INSERT ON ai_review_jobs BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_jobs_update BEFORE UPDATE ON ai_review_jobs WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_jobs_update AFTER UPDATE ON ai_review_jobs BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_jobs_delete BEFORE DELETE ON ai_review_jobs WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_jobs_delete AFTER DELETE ON ai_review_jobs BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER ai_review_captures_no_delete BEFORE DELETE ON ai_review_captures BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER ai_review_captures_no_update BEFORE UPDATE ON ai_review_captures BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER recovery_guard_ai_review_captures_insert BEFORE INSERT ON ai_review_captures WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_captures_insert AFTER INSERT ON ai_review_captures BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_captures_update BEFORE UPDATE ON ai_review_captures WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_captures_update AFTER UPDATE ON ai_review_captures BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_captures_delete BEFORE DELETE ON ai_review_captures WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_captures_delete AFTER DELETE ON ai_review_captures BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER ai_review_reports_no_delete BEFORE DELETE ON ai_review_reports BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER ai_review_reports_no_update BEFORE UPDATE ON ai_review_reports BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER recovery_guard_ai_review_reports_insert BEFORE INSERT ON ai_review_reports WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_reports_insert AFTER INSERT ON ai_review_reports BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_reports_update BEFORE UPDATE ON ai_review_reports WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_reports_update AFTER UPDATE ON ai_review_reports BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_reports_delete BEFORE DELETE ON ai_review_reports WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_reports_delete AFTER DELETE ON ai_review_reports BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER ai_review_appeals_no_delete BEFORE DELETE ON ai_review_appeals BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER ai_review_appeals_no_update BEFORE UPDATE ON ai_review_appeals BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER recovery_guard_ai_review_appeals_insert BEFORE INSERT ON ai_review_appeals WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_appeals_insert AFTER INSERT ON ai_review_appeals BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_appeals_update BEFORE UPDATE ON ai_review_appeals WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_appeals_update AFTER UPDATE ON ai_review_appeals BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_appeals_delete BEFORE DELETE ON ai_review_appeals WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_appeals_delete AFTER DELETE ON ai_review_appeals BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER ai_review_attempts_no_delete BEFORE DELETE ON ai_review_attempts BEGIN SELECT RAISE(ABORT,'Retain private review evidence'); END;
CREATE TRIGGER recovery_guard_ai_review_attempts_insert BEFORE INSERT ON ai_review_attempts WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_attempts_insert AFTER INSERT ON ai_review_attempts BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_attempts_update BEFORE UPDATE ON ai_review_attempts WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_attempts_update AFTER UPDATE ON ai_review_attempts BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_ai_review_attempts_delete BEFORE DELETE ON ai_review_attempts WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_watermark_ai_review_attempts_delete AFTER DELETE ON ai_review_attempts BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
