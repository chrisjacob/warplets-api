-- Extend guarded commands without changing prior migration history.
CREATE TABLE app_provider_attempts (
 attempt_id TEXT PRIMARY KEY,provider TEXT NOT NULL,units TEXT NOT NULL,quota TEXT NOT NULL,
 at_ms INTEGER NOT NULL,actor TEXT NOT NULL,evidence_ref TEXT NOT NULL,
 usage_receipt TEXT NOT NULL UNIQUE REFERENCES ops_usage(receipt)
) STRICT;
CREATE TABLE app_private_artifacts (
 object_key TEXT PRIMARY KEY,byte_digest TEXT NOT NULL,size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 262144),
 semantic_digest TEXT,content_type TEXT NOT NULL,recorded_ms INTEGER NOT NULL,
 operation_id TEXT NOT NULL UNIQUE REFERENCES app_command_receipts(operation_id)
) STRICT;
CREATE TRIGGER app_attempts_immutable_update BEFORE UPDATE ON app_provider_attempts BEGIN SELECT RAISE(ABORT,'Provider attempts are immutable'); END;
CREATE TRIGGER app_attempts_immutable_delete BEFORE DELETE ON app_provider_attempts BEGIN SELECT RAISE(ABORT,'Provider attempts are retained'); END;
CREATE TRIGGER app_artifacts_immutable_update BEFORE UPDATE ON app_private_artifacts BEGIN SELECT RAISE(ABORT,'Private object identity is immutable'); END;
CREATE TRIGGER app_artifacts_immutable_delete BEFORE DELETE ON app_private_artifacts BEGIN SELECT RAISE(ABORT,'Private evidence references are retained'); END;
CREATE TRIGGER app_attempt_revision AFTER INSERT ON app_provider_attempts BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_artifact_revision AFTER INSERT ON app_private_artifacts BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
DROP TRIGGER app_receipt_mandatory_effects;
CREATE TRIGGER app_receipt_mandatory_effects BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' BEGIN
 SELECT RAISE(ABORT,'Missing mandatory submission') WHERE NEW.operation_kind='earn.admit-submission.v1' AND NOT EXISTS(
  SELECT 1 FROM earn_submissions s WHERE s.id=NEW.result_ref AND s.wallet=json_extract(NEW.input_json,'$.wallet')
   AND s.token_id=json_extract(NEW.input_json,'$.tokenId') AND s.url=json_extract(NEW.input_json,'$.url')
   AND s.epoch=json_extract(NEW.input_json,'$.epoch') AND s.request_key=NEW.request_key
   AND s.entry_read_id=json_extract(NEW.input_json,'$.entryReadId') AND s.submitted_ms=NEW.created_ms
   AND EXISTS(SELECT 1 FROM earn_admission_counts c WHERE c.epoch=s.epoch AND c.admitted=(SELECT COUNT(*) FROM earn_submissions counted WHERE counted.epoch=s.epoch))
 );
 SELECT RAISE(ABORT,'Missing mandatory review') WHERE NEW.operation_kind='earn.final-review.v1' AND NOT EXISTS(
  SELECT 1 FROM earn_reviews r WHERE r.submission_id=NEW.result_ref
   AND r.content_score=json_extract(NEW.input_json,'$.score') AND r.reason=json_extract(NEW.input_json,'$.reason')
   AND r.moderator=json_extract(NEW.input_json,'$.moderator') AND r.source_ref=json_extract(NEW.input_json,'$.sourceRef')
   AND r.reviewed_ms=NEW.created_ms
 );
 SELECT RAISE(ABORT,'Missing scope or audit') WHERE NEW.operation_kind='ops.change-scope.v1' AND NOT EXISTS(
 SELECT 1 FROM ops_scope_log r WHERE r.revision=NEW.result_ref AND r.revision=json_extract(NEW.input_json,'$.revision')
 AND r.scope=json_extract(NEW.input_json,'$.scope') AND r.paused=json_extract(NEW.input_json,'$.paused') AND r.previous_revision IS json_extract(NEW.input_json,'$.previousRevision')
 AND r.at_ms=NEW.created_ms AND r.actor=json_extract(NEW.input_json,'$.actor') AND r.reason=json_extract(NEW.input_json,'$.reason') AND r.evidence_ref=json_extract(NEW.input_json,'$.evidenceRef')
 AND r.request_key=NEW.request_key AND EXISTS(SELECT 1 FROM ops_config_audit a WHERE a.seq=json_extract(NEW.input_json,'$.audit.seq')
 AND a.previous_hash IS json_extract(NEW.input_json,'$.audit.previousHash') AND a.event_hash=json_extract(NEW.input_json,'$.audit.eventHash')
 AND a.payload=json_extract(NEW.input_json,'$.audit.payload') AND a.category='scope-change' AND a.entity=json_extract(NEW.input_json,'$.scope') AND a.change_key=NEW.request_key
 AND a.recorded_ms=NEW.created_ms AND a.actor=json_extract(NEW.input_json,'$.actor') AND a.evidence_ref=json_extract(NEW.input_json,'$.evidenceRef'))
 );
 SELECT RAISE(ABORT,'Missing staffing or audit') WHERE NEW.operation_kind='ops.configure-workload.v1' AND NOT EXISTS(
 SELECT 1 FROM earn_workload_policies r WHERE r.revision=NEW.result_ref AND r.revision=json_extract(NEW.input_json,'$.revision')
 AND r.effective_epoch=json_extract(NEW.input_json,'$.effectiveEpoch') AND r.recorded_ms=NEW.created_ms AND r.staffed_minutes=json_extract(NEW.input_json,'$.staffedMinutes')
 AND r.seconds_per_review=json_extract(NEW.input_json,'$.secondsPerReview') AND r.admission_limit=json_extract(NEW.input_json,'$.admissionLimit')
 AND r.operator=json_extract(NEW.input_json,'$.actor') AND r.reason=json_extract(NEW.input_json,'$.reason') AND EXISTS(SELECT 1 FROM ops_config_audit a WHERE a.seq=json_extract(NEW.input_json,'$.audit.seq')
 AND a.previous_hash IS json_extract(NEW.input_json,'$.audit.previousHash') AND a.event_hash=json_extract(NEW.input_json,'$.audit.eventHash')
 AND a.payload=json_extract(NEW.input_json,'$.audit.payload') AND a.category='staffing' AND a.entity='Earn' AND a.change_key=json_extract(NEW.input_json,'$.revision')
 AND a.recorded_ms=NEW.created_ms AND a.actor=json_extract(NEW.input_json,'$.actor') AND a.evidence_ref=json_extract(NEW.input_json,'$.reason'))
 );
 SELECT RAISE(ABORT,'Missing cost reservation') WHERE NEW.operation_kind='ops.reserve-cost.v1' AND NOT EXISTS(
 SELECT 1 FROM ops_optional_spend r WHERE r.request_key=NEW.result_ref AND r.request_key=NEW.request_key
 AND r.scope=json_extract(NEW.input_json,'$.scope') AND r.period=json_extract(NEW.input_json,'$.period') AND r.at_ms=NEW.created_ms AND r.limit_usd_micros=json_extract(NEW.input_json,'$.upperUsdMicros')
 AND r.actor=json_extract(NEW.input_json,'$.actor') AND r.quote_ref=json_extract(NEW.input_json,'$.quoteRef') AND r.status='reserved'
 AND r.actual_usd_micros IS NULL AND r.settlement_ref IS NULL AND r.settled_ms IS NULL
 );
 SELECT RAISE(ABORT,'Missing cost settlement') WHERE NEW.operation_kind='ops.settle-cost.v1' AND NOT EXISTS(
 SELECT 1 FROM ops_optional_spend r WHERE r.request_key=NEW.result_ref AND r.request_key=json_extract(NEW.input_json,'$.reservationKey')
 AND r.status='settled' AND r.actual_usd_micros=json_extract(NEW.input_json,'$.actualUsdMicros') AND r.settlement_ref=json_extract(NEW.input_json,'$.evidenceRef')
 AND r.settled_ms=NEW.created_ms
 );
 SELECT RAISE(ABORT,'Missing provider attempt or usage') WHERE NEW.operation_kind='ops.meter-attempt.v1' AND NOT EXISTS(
 SELECT 1 FROM app_provider_attempts p JOIN ops_usage u ON u.receipt=p.usage_receipt
 WHERE p.attempt_id=NEW.result_ref AND p.attempt_id=json_extract(NEW.input_json,'$.attemptId') AND p.provider=json_extract(NEW.input_json,'$.provider')
 AND p.units=json_extract(NEW.input_json,'$.units') AND p.quota=json_extract(NEW.input_json,'$.quota') AND p.at_ms=NEW.created_ms AND p.actor=json_extract(NEW.input_json,'$.actor')
 AND p.evidence_ref=json_extract(NEW.input_json,'$.evidenceRef') AND p.usage_receipt=json_extract(NEW.input_json,'$.usageReceipt')
 AND u.provider=p.provider AND u.metric='daily-provider-units' AND u.period=json_extract(NEW.input_json,'$.period')
 AND u.at_ms=NEW.created_ms AND u.measured=json_extract(NEW.input_json,'$.measured') AND u.quota=p.quota AND u.evidence_ref=p.evidence_ref
 );
 SELECT RAISE(ABORT,'Missing verified private reference') WHERE NEW.operation_kind='evidence.private-reference.v1' AND NOT EXISTS(
 SELECT 1 FROM app_private_artifacts a WHERE a.object_key=NEW.result_ref AND a.object_key=json_extract(NEW.input_json,'$.key')
 AND a.byte_digest=json_extract(NEW.input_json,'$.byteDigest') AND a.size=json_extract(NEW.input_json,'$.size') AND a.semantic_digest IS json_extract(NEW.input_json,'$.semanticDigest')
 AND a.content_type=json_extract(NEW.input_json,'$.contentType') AND a.recorded_ms=NEW.created_ms AND a.operation_id=NEW.operation_id
 );
 SELECT RAISE(ABORT,'Unknown guarded operation') WHERE NEW.operation_kind NOT IN ('earn.admit-submission.v1','earn.final-review.v1','ops.change-scope.v1','ops.configure-workload.v1','ops.reserve-cost.v1','ops.settle-cost.v1','ops.meter-attempt.v1','evidence.private-reference.v1');
END;
