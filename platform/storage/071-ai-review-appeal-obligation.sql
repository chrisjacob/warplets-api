-- A single creator appeal insert creates its durable child job. Immediate
-- foreign keys are checked after this trigger, so no partially accepted appeal
-- or orphan child is visible, including when the D1 response is lost.
CREATE TRIGGER ai_review_appeal_obligation AFTER INSERT ON ai_review_appeals
 WHEN NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL)
 BEGIN
 SELECT RAISE(ABORT,'Appeal source binding mismatch') WHERE
  NEW.job_id<>'appeal:'||NEW.appeal_id OR
  json_extract(NEW.appeal_json,'$.appealId') IS NOT NEW.appeal_id OR
  json_extract(NEW.appeal_json,'$.payload.kind') IS NOT '10x.ai-review-appeal.v1' OR
  json_extract(NEW.appeal_json,'$.payload.reportId') IS NOT NEW.report_id OR
  json_extract(NEW.appeal_json,'$.payload.submissionId') IS NOT NEW.submission_id OR
  NOT EXISTS(SELECT 1 FROM ai_review_reports r JOIN earn_submissions s ON s.id=r.submission_id
   WHERE r.report_id=NEW.report_id AND s.id=NEW.submission_id AND s.wallet=NEW.wallet);
 INSERT INTO ai_review_jobs(id,submission_id,kind,previous_report_id,appeal_id,state,created_ms,updated_ms)
 VALUES(NEW.job_id,NEW.submission_id,'appeal',NEW.report_id,NEW.appeal_id,'awaiting-capture',NEW.created_ms,NEW.created_ms)
 ON CONFLICT(id) DO NOTHING;
 SELECT RAISE(ABORT,'Appeal job binding mismatch') WHERE NOT EXISTS(
  SELECT 1 FROM ai_review_jobs j WHERE j.id=NEW.job_id AND j.submission_id=NEW.submission_id
   AND j.kind='appeal' AND j.previous_report_id=NEW.report_id AND j.appeal_id=NEW.appeal_id
   AND j.state='awaiting-capture' AND j.revision=0 AND j.attempt=0 AND j.lease_token IS NULL
   AND j.lease_until_ms IS NULL AND j.dispatched_ms IS NULL AND j.reason IS NULL
   AND j.created_ms=NEW.created_ms AND j.updated_ms=NEW.created_ms);
 END;
