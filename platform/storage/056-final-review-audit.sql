-- Existing committed review receipts remain unchanged and replayable. Every
-- newly committed review (including explicit reference adoption) owns an audit.
CREATE TRIGGER app_final_review_audit_mandatory BEFORE UPDATE OF state ON app_command_receipts
WHEN OLD.state='staging' AND NEW.state='committed' AND NEW.operation_kind='earn.final-review.v1'
BEGIN
 SELECT RAISE(ABORT,'Missing exact final review audit') WHERE NOT EXISTS(
  SELECT 1 FROM ops_config_audit a WHERE a.seq=json_extract(NEW.input_json,'$.audit.seq')
   AND a.previous_hash IS json_extract(NEW.input_json,'$.audit.previousHash')
   AND a.event_hash=json_extract(NEW.input_json,'$.audit.eventHash')
   AND a.payload=json_extract(NEW.input_json,'$.audit.payload')
   AND a.category=CASE WHEN json_extract(NEW.input_json,'$.adoptedReference')=1 THEN 'final-review-adoption' ELSE 'final-review' END
   AND a.entity=NEW.result_ref AND a.entity=json_extract(NEW.input_json,'$.submissionId')
   AND a.change_key=NEW.request_key AND NEW.principal_key='operator:'||a.actor
   AND a.actor=json_extract(NEW.input_json,'$.moderator') AND a.evidence_ref=json_extract(NEW.input_json,'$.sourceRef')
   AND a.recorded_ms=json_extract(NEW.input_json,'$.audit.recordedMs') AND a.recorded_ms>=NEW.created_ms
   AND (json_extract(NEW.input_json,'$.adoptedReference')=1 OR a.recorded_ms=NEW.created_ms)
   AND json_extract(a.payload,'$.score')=json_extract(NEW.input_json,'$.score')
   AND json_extract(a.payload,'$.reason')=json_extract(NEW.input_json,'$.reason')
   AND json_extract(a.payload,'$.requestDigest')=NEW.request_digest
   AND json_extract(a.payload,'$.reviewedAtMs')=NEW.created_ms
   AND json_extract(a.payload,'$.adoptedReference')=COALESCE(json_extract(NEW.input_json,'$.adoptedReference'),0)
   AND (SELECT COUNT(*) FROM json_each(a.payload))=5
   AND a.seq=(SELECT MAX(seq) FROM ops_config_audit)
   AND ((a.seq=1 AND a.previous_hash IS NULL) OR EXISTS(SELECT 1 FROM ops_config_audit prior WHERE prior.seq=a.seq-1 AND prior.event_hash=a.previous_hash))
 );
END;
