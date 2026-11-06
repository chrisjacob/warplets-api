-- Private normalized stage authority. Populated legacy adoption is separate.
CREATE TABLE app_collection_authorities (
 inventory_id TEXT PRIMARY KEY REFERENCES collect_inventories(id),origin_kind TEXT NOT NULL CHECK(origin_kind IN ('empty-reference','verified-source-import')),
 initial_state_digest TEXT NOT NULL,initial_revision INTEGER NOT NULL CHECK(initial_revision>=0),
 revision INTEGER NOT NULL CHECK(revision>=0),admitted INTEGER NOT NULL CHECK(admitted BETWEEN 0 AND 1000),
 fulfilled INTEGER NOT NULL CHECK(fulfilled>=0 AND fulfilled<=admitted),remaining_json TEXT NOT NULL CHECK(json_valid(remaining_json) AND length(CAST(remaining_json AS BLOB))<=512),
 activation_command_id TEXT NOT NULL UNIQUE REFERENCES app_command_receipts(operation_id)
) STRICT;
CREATE TABLE app_collection_stages (
 inventory_id TEXT NOT NULL REFERENCES app_collection_authorities(inventory_id),stage_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 31),stage_type TEXT NOT NULL CHECK(stage_type IN ('whitelist','free','public','founder')),
 published_ms INTEGER NOT NULL,opens_ms INTEGER NOT NULL,closes_ms INTEGER NOT NULL,
 terms_digest TEXT NOT NULL UNIQUE,terms_json TEXT NOT NULL CHECK(json_valid(terms_json) AND length(CAST(terms_json AS BLOB))<=8192),
 eligibility_kind TEXT NOT NULL CHECK(eligibility_kind IN ('list','pending','unrestricted')),
 list_id TEXT REFERENCES app_collection_list_seals(id),eligible_count INTEGER CHECK(eligible_count BETWEEN 0 AND 10000),
 command_operation_id TEXT NOT NULL UNIQUE REFERENCES app_command_receipts(operation_id),
 PRIMARY KEY(inventory_id,stage_id),UNIQUE(inventory_id,ordinal),
 CHECK(published_ms>=0 AND opens_ms>=published_ms AND closes_ms>opens_ms),
 CHECK((eligibility_kind='list' AND stage_type IN ('whitelist','founder') AND list_id IS NOT NULL AND eligible_count IS NOT NULL)
  OR (eligibility_kind='pending' AND stage_type='free' AND list_id IS NULL AND eligible_count IS NULL)
  OR (eligibility_kind='unrestricted' AND stage_type='public' AND list_id IS NULL AND eligible_count IS NULL))
) STRICT;
CREATE TRIGGER app_collection_authority_origin_immutable BEFORE UPDATE OF inventory_id,origin_kind,initial_state_digest,initial_revision,activation_command_id ON app_collection_authorities BEGIN SELECT RAISE(ABORT,'Collection authority origin is immutable'); END;
CREATE TRIGGER app_collection_authority_no_delete BEFORE DELETE ON app_collection_authorities BEGIN SELECT RAISE(ABORT,'Retain collection authority'); END;
CREATE TRIGGER app_collection_stages_no_update BEFORE UPDATE ON app_collection_stages BEGIN SELECT RAISE(ABORT,'Published collection stage is immutable'); END;
CREATE TRIGGER app_collection_stages_no_delete BEFORE DELETE ON app_collection_stages BEGIN SELECT RAISE(ABORT,'Retain published collection stage'); END;
CREATE TRIGGER normalized_collection_header_frozen BEFORE UPDATE OF state,revision,kind,tranche,season_start,season_month,origin_digest ON collect_inventories
 WHEN EXISTS(SELECT 1 FROM app_collection_authorities WHERE inventory_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'Normalized collection authority requires guarded transitions'); END;
CREATE TRIGGER recovery_guard_app_collection_authorities_insert BEFORE INSERT ON app_collection_authorities
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER stage_source_app_collection_authorities_insert AFTER INSERT ON app_collection_authorities BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_guard_app_collection_authorities_update BEFORE UPDATE ON app_collection_authorities
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER stage_source_app_collection_authorities_update AFTER UPDATE ON app_collection_authorities BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_guard_app_collection_authorities_delete BEFORE DELETE ON app_collection_authorities
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER stage_source_app_collection_authorities_delete AFTER DELETE ON app_collection_authorities BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_guard_app_collection_stages_insert BEFORE INSERT ON app_collection_stages
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER stage_source_app_collection_stages_insert AFTER INSERT ON app_collection_stages BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_guard_app_collection_stages_update BEFORE UPDATE ON app_collection_stages
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER stage_source_app_collection_stages_update AFTER UPDATE ON app_collection_stages BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_guard_app_collection_stages_delete BEFORE DELETE ON app_collection_stages
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER stage_source_app_collection_stages_delete AFTER DELETE ON app_collection_stages BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER app_collection_stage_mandatory_effect BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' AND NEW.operation_kind='collection.publish-stage.v1' BEGIN
 SELECT RAISE(ABORT,'Missing atomic collection publication') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_stages s JOIN app_collection_authorities a ON a.inventory_id=s.inventory_id
 JOIN collect_inventories h ON h.id=s.inventory_id
 WHERE s.command_operation_id=NEW.operation_id AND json_array(s.inventory_id,s.stage_id)=NEW.result_ref
 AND NEW.business_key=NEW.result_ref
 AND substr(NEW.principal_key,1,9)='operator:'
 AND s.inventory_id=json_extract(NEW.input_json,'$.inventoryId')
 AND s.stage_id=json_extract(NEW.input_json,'$.stageId')
 AND s.inventory_id=json_extract(NEW.result_json,'$.inventoryId')
 AND s.stage_id=json_extract(NEW.result_json,'$.stageId')
 AND s.terms_digest=json_extract(NEW.result_json,'$.termsDigest')
 AND a.revision=json_extract(NEW.result_json,'$.publicationRevision'));
 SELECT RAISE(ABORT,'Missing atomic collection publication') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_stages s JOIN app_collection_authorities a ON a.inventory_id=s.inventory_id
 JOIN collect_inventories h ON h.id=s.inventory_id
 WHERE s.command_operation_id=NEW.operation_id AND json_array(s.inventory_id,s.stage_id)=NEW.result_ref
 AND s.stage_type=json_extract(NEW.input_json,'$.type')
 AND s.published_ms=json_extract(NEW.input_json,'$.publishedAt')
 AND s.opens_ms=json_extract(NEW.input_json,'$.opensAt')
 AND s.closes_ms=json_extract(NEW.input_json,'$.closesAt')
 AND s.published_ms<=NEW.created_ms
 AND s.ordinal=(SELECT COUNT(*)-1 FROM app_collection_stages WHERE inventory_id=s.inventory_id)
 AND json_extract(s.terms_json,'$.id')=s.stage_id
 AND json_extract(s.terms_json,'$.type')=s.stage_type);
 SELECT RAISE(ABORT,'Missing atomic collection publication') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_stages s JOIN app_collection_authorities a ON a.inventory_id=s.inventory_id
 JOIN collect_inventories h ON h.id=s.inventory_id
 WHERE s.command_operation_id=NEW.operation_id AND json_array(s.inventory_id,s.stage_id)=NEW.result_ref
 AND json_extract(s.terms_json,'$.termsDigest')=s.terms_digest
 AND json_extract(s.terms_json,'$.publishedAt')=s.published_ms
 AND json_extract(s.terms_json,'$.opensAt')=s.opens_ms
 AND json_extract(s.terms_json,'$.closesAt')=s.closes_ms
 AND json_extract(s.terms_json,'$.priceLamports."$lamports"')=json_extract(NEW.input_json,'$.priceLamports')
 AND json_extract(s.terms_json,'$.costLamports."$lamports"')=json_extract(NEW.input_json,'$.costLamports')
 AND json_extract(s.terms_json,'$.allocation')=json_extract(NEW.input_json,'$.allocation')
 AND json_extract(s.terms_json,'$.approvedSpendLamports."$lamports"') IS json_extract(NEW.input_json,'$.approvedSpendLamports'));
 SELECT RAISE(ABORT,'Missing atomic collection publication') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_stages s JOIN app_collection_authorities a ON a.inventory_id=s.inventory_id
 JOIN collect_inventories h ON h.id=s.inventory_id
 WHERE s.command_operation_id=NEW.operation_id AND json_array(s.inventory_id,s.stage_id)=NEW.result_ref
 AND json_extract(s.terms_json,'$.ballotId') IS json_extract(NEW.input_json,'$.ballotId')
 AND json_extract(s.terms_json,'$.inventoryOverrideReason') IS json_extract(NEW.input_json,'$.inventoryOverrideReason')
 AND json_extract(s.terms_json,'$.walletLimit')=CASE WHEN h.kind='genesis' OR s.stage_type='free' THEN 1 ELSE json_extract(NEW.input_json,'$.walletLimit') END
 AND json_extract(NEW.input_json,'$.sourceKind')='synthetic-local-operator-fixture'
 AND s.eligibility_kind=json_extract(NEW.result_json,'$.eligibility.kind')
 AND s.list_id IS json_extract(NEW.input_json,'$.eligibilityListId')
 AND s.list_id IS json_extract(NEW.result_json,'$.eligibility.listId')
 AND s.eligible_count IS json_extract(NEW.result_json,'$.eligibility.count'));
 SELECT RAISE(ABORT,'Missing atomic collection publication') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_stages s JOIN app_collection_authorities a ON a.inventory_id=s.inventory_id
 JOIN collect_inventories h ON h.id=s.inventory_id
 WHERE s.command_operation_id=NEW.operation_id AND json_array(s.inventory_id,s.stage_id)=NEW.result_ref
 AND json_extract(NEW.result_json,'$.source')='local-fixture' AND json_extract(NEW.result_json,'$.executable')=0
 AND (h.kind<>'genesis' OR s.opens_ms-s.published_ms>=172800000)
 AND (h.kind<>'season' OR s.opens_ms>=h.season_start)
 AND (s.stage_type NOT IN ('public','founder') OR json_extract(NEW.input_json,'$.founderApproved')=1)
 AND (s.stage_type NOT IN ('free','founder') OR json_extract(NEW.input_json,'$.priceLamports')='0')
 AND (s.stage_type<>'free' OR h.kind='season')
 AND (s.stage_type<>'founder' OR json_type(NEW.input_json,'$.approvedSpendLamports')='text')
 AND (s.eligibility_kind<>'list' OR EXISTS(SELECT 1 FROM app_collection_list_seals l WHERE l.id=s.list_id AND l.member_count=s.eligible_count AND NOT EXISTS(SELECT 1 FROM json_each(l.page_ids_json) p LEFT JOIN app_collection_eligibility_pages e ON e.record_id=p.value WHERE e.record_id IS NULL))));
 SELECT RAISE(ABORT,'Missing atomic collection publication') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_stages s JOIN app_collection_authorities a ON a.inventory_id=s.inventory_id
 JOIN collect_inventories h ON h.id=s.inventory_id
 WHERE s.command_operation_id=NEW.operation_id AND json_array(s.inventory_id,s.stage_id)=NEW.result_ref
 AND EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=substr(NEW.principal_key,10) AND scope='collection-publication' AND enabled=1)
 AND ((s.stage_type NOT IN ('public','founder') AND json_extract(NEW.input_json,'$.inventoryOverrideReason') IS NULL) OR EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=substr(NEW.principal_key,10) AND scope='collection-founder' AND enabled=1)));
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
 SELECT RAISE(ABORT,'Missing sealed input reference') WHERE NEW.operation_kind='earn.seal-input.v1' AND NOT EXISTS(
  SELECT 1 FROM app_complete_inputs i JOIN app_epoch_inputs p ON p.manifest_digest=i.manifest_digest
  WHERE i.manifest_digest=NEW.result_ref AND i.manifest_digest=json_extract(NEW.input_json,'$.manifestDigest')
   AND i.epoch=json_extract(NEW.input_json,'$.epoch') AND p.epoch=i.epoch
   AND i.input_digest=json_extract(NEW.input_json,'$.inputDigest') AND i.object_key=json_extract(NEW.input_json,'$.objectKey')
   AND i.byte_digest=json_extract(NEW.input_json,'$.byteDigest') AND i.as_of_ms=json_extract(NEW.input_json,'$.asOfMs')
   AND i.source_ref=json_extract(NEW.input_json,'$.sourceRef') AND i.dependency_versions=NEW.expected_revisions
   AND i.operation_id=NEW.operation_id
 );
 SELECT RAISE(ABORT,'Missing mandatory board') WHERE NEW.operation_kind='earn.commit-board.v1' AND NOT EXISTS(
  SELECT 1 FROM earn_boards b WHERE b.epoch=json_extract(NEW.input_json,'$.epoch')
   AND b.snapshot_hash=NEW.result_ref AND b.winners=json_extract(NEW.input_json,'$.winners')
   AND b.finalized_ms=NEW.created_ms AND b.source_ref=json_extract(NEW.input_json,'$.sourceRef')
 );
 SELECT RAISE(ABORT,'Incomplete board decisions') WHERE NEW.operation_kind='earn.commit-board.v1' AND (
  (SELECT COUNT(*) FROM earn_decisions WHERE epoch=json_extract(NEW.input_json,'$.epoch'))<>json_array_length(NEW.input_json,'$.decisions')
  OR EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$.decisions') e LEFT JOIN earn_decisions d ON d.submission_id=json_extract(e.value,'$.submissionId')
    WHERE d.submission_id IS NULL OR d.epoch<>json_extract(NEW.input_json,'$.epoch') OR d.qualified<>json_extract(e.value,'$.qualified')
     OR d.snapshot_read_id IS NOT json_extract(e.value,'$.cutoffEvidence'))
 );
 SELECT RAISE(ABORT,'Incomplete board facts') WHERE NEW.operation_kind='earn.commit-board.v1' AND (
  (SELECT COUNT(*) FROM earn_member_facts WHERE epoch=json_extract(NEW.input_json,'$.epoch'))<>json_array_length(NEW.input_json,'$.facts')
  OR EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$.facts') e LEFT JOIN earn_member_facts f
    ON f.epoch=json_extract(NEW.input_json,'$.epoch') AND f.wallet=json_extract(e.value,'$[0]')
    WHERE f.wallet IS NULL OR f.source_ref<>json_extract(e.value,'$[1]') OR f.payload<>json_extract(e.value,'$[2]'))
 );
 SELECT RAISE(ABORT,'Incomplete board streaks') WHERE NEW.operation_kind='earn.commit-board.v1' AND (
  (SELECT COUNT(*) FROM earn_streaks WHERE epoch=json_extract(NEW.input_json,'$.epoch'))<>json_array_length(NEW.input_json,'$.streaks')
  OR EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$.streaks') e LEFT JOIN earn_streaks s
    ON s.epoch=json_extract(NEW.input_json,'$.epoch') AND s.wallet=json_extract(e.value,'$.wallet')
    WHERE s.wallet IS NULL OR s.days<>json_extract(e.value,'$.days') OR s.last_approval_ms<>json_extract(e.value,'$.lastApprovalMs'))
 );
 SELECT RAISE(ABORT,'Missing allocation or awards') WHERE NEW.operation_kind='earn.commit-allocation.v1' AND (
  NOT EXISTS(SELECT 1 FROM earn_allocations a WHERE a.token_id=json_extract(NEW.input_json,'$.tokenId') AND a.day=json_extract(NEW.input_json,'$.day')
   AND a.epoch=json_extract(NEW.input_json,'$.boardEpoch') AND a.starts_ms=json_extract(NEW.input_json,'$.startsAtMs')
   AND a.vests_from_ms=json_extract(NEW.input_json,'$.vestsFromMs') AND a.vests_through_ms=json_extract(NEW.input_json,'$.vestsThroughMs')
   AND a.budget=json_extract(NEW.input_json,'$.budgetUnits') AND a.burn=json_extract(NEW.input_json,'$.burnUnits'))
  OR (SELECT COUNT(*) FROM earn_awards WHERE token_id=json_extract(NEW.input_json,'$.tokenId') AND day=json_extract(NEW.input_json,'$.day'))<>json_array_length(NEW.input_json,'$.awards')
  OR EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$.awards') e LEFT JOIN earn_awards a ON a.token_id=json_extract(NEW.input_json,'$.tokenId')
    AND a.day=json_extract(NEW.input_json,'$.day') AND a.wallet=json_extract(e.value,'$.wallet')
    WHERE a.wallet IS NULL OR a.amount<>json_extract(e.value,'$.amountUnits'))
 );
 SELECT RAISE(ABORT,'Missing evidence source') WHERE NEW.operation_kind='evidence.register-source.v1' AND NOT EXISTS(
  SELECT 1 FROM app_evidence_sources s WHERE s.source_id=json_extract(NEW.input_json,'$.sourceId')
   AND s.source_revision=json_extract(NEW.input_json,'$.sourceRevision') AND s.config_digest=NEW.result_ref
   AND s.config_digest=json_extract(NEW.input_json,'$.configDigest') AND s.config_json=json_extract(NEW.input_json,'$.configJson')
   AND s.recorded_ms=NEW.created_ms AND s.operation_id=NEW.operation_id);
 SELECT RAISE(ABORT,'Missing evidence receipt or head') WHERE NEW.operation_kind='evidence.record-receipt.v1' AND NOT EXISTS(
  SELECT 1 FROM app_evidence_receipts r JOIN app_evidence_heads h ON h.stream_key=r.stream_key AND h.receipt_digest=r.receipt_digest
  WHERE r.receipt_digest=NEW.result_ref AND r.receipt_digest=json_extract(NEW.input_json,'$.receiptDigest')
   AND r.evidence_id=json_extract(NEW.input_json,'$.evidenceId') AND r.stream_key=json_extract(NEW.input_json,'$.streamKey')
   AND r.source_id=json_extract(NEW.input_json,'$.sourceId') AND r.source_revision=json_extract(NEW.input_json,'$.sourceRevision')
   AND r.object_key=json_extract(NEW.input_json,'$.objectKey') AND r.envelope_json=json_extract(NEW.input_json,'$.envelopeJson')
   AND r.decision_json=json_extract(NEW.input_json,'$.decisionJson') AND r.status=json_extract(NEW.input_json,'$.status')
   AND r.supersedes IS json_extract(NEW.input_json,'$.supersedes') AND r.recorded_ms=NEW.created_ms AND r.operation_id=NEW.operation_id);
 SELECT RAISE(ABORT,'Missing epoch admission freeze') WHERE NEW.operation_kind='earn.freeze-epoch.v1' AND NOT EXISTS(
  SELECT 1 FROM app_epoch_freezes f WHERE f.epoch=json_extract(NEW.input_json,'$.epoch') AND f.admission_digest=NEW.result_ref
   AND f.admission_digest=json_extract(NEW.input_json,'$.admissionDigest') AND f.admission_count=json_extract(NEW.input_json,'$.admissionCount')
   AND f.inventory_json=json_extract(NEW.input_json,'$.inventoryJson') AND f.closed_ms=NEW.created_ms AND f.operation_id=NEW.operation_id
   AND f.admission_count=(SELECT COUNT(*) FROM earn_submissions s WHERE s.epoch=f.epoch));
 SELECT RAISE(ABORT,'Missing snapshot attempt') WHERE NEW.operation_kind='earn.snapshot-attempt.v1' AND NOT EXISTS(
  SELECT 1 FROM app_snapshot_attempts a WHERE a.manifest_digest=NEW.result_ref AND a.manifest_digest=json_extract(NEW.input_json,'$.manifestDigest')
   AND a.epoch=json_extract(NEW.input_json,'$.epoch') AND a.status=json_extract(NEW.input_json,'$.status')
   AND a.object_key=json_extract(NEW.input_json,'$.objectKey') AND a.byte_digest=json_extract(NEW.input_json,'$.byteDigest')
   AND a.requirements_digest=json_extract(NEW.input_json,'$.requirementsDigest') AND a.evidence_digest=json_extract(NEW.input_json,'$.evidenceDigest')
   AND a.input_digest IS json_extract(NEW.input_json,'$.inputDigest') AND a.dependency_versions=NEW.expected_revisions
   AND a.created_ms=NEW.created_ms AND a.operation_id=NEW.operation_id);
 SELECT RAISE(ABORT,'Missing signed action effects') WHERE NEW.operation_kind='earn.accept-action.v1' AND NOT EXISTS(
  SELECT 1 FROM earn_signed_completions s JOIN earn_action_completions c ON c.wallet=s.wallet AND c.action_id=s.action_id
  WHERE s.issuer_id=json_extract(NEW.input_json,'$.issuerId') AND s.nonce=json_extract(NEW.input_json,'$.nonce')
   AND s.wallet=json_extract(NEW.input_json,'$.wallet') AND s.action_id=json_extract(NEW.input_json,'$.actionId')
   AND s.proof_digest=NEW.result_ref AND s.proof_digest=json_extract(NEW.input_json,'$.proofDigest')
   AND s.source_hash=json_extract(NEW.input_json,'$.sourceHash') AND s.accepted_ms=NEW.created_ms
   AND c.verified_ms=NEW.created_ms AND c.verifier=json_extract(NEW.input_json,'$.verifier')
   AND c.source_ref=json_extract(NEW.input_json,'$.sourceRef'));
 SELECT RAISE(ABORT,'Missing planned publication or staging references') WHERE NEW.operation_kind='artifacts.plan-publication.v1' AND NOT EXISTS(
  SELECT 1 FROM app_artifact_publications p WHERE p.id=NEW.result_ref AND p.id=json_extract(NEW.input_json,'$.id')
   AND p.job_key=json_extract(NEW.input_json,'$.jobKey') AND p.epoch=json_extract(NEW.input_json,'$.epoch')
   AND p.semantic_digest=json_extract(NEW.input_json,'$.identity.semanticDigest') AND p.byte_digest=json_extract(NEW.input_json,'$.identity.byteDigest')
   AND p.object_key=json_extract(NEW.input_json,'$.identity.key') AND p.size_bytes=json_extract(NEW.input_json,'$.identity.size')
   AND p.source_digest=json_extract(NEW.input_json,'$.sourceDigest') AND p.selections_json=json_extract(NEW.input_json,'$.selectionsJson')
   AND p.staging_json=json_extract(NEW.input_json,'$.stagingJson') AND p.source_revisions=NEW.expected_revisions
   AND p.plan_request_digest=NEW.request_digest AND p.created_ms=NEW.created_ms AND p.plan_operation_id=NEW.operation_id AND p.state='planned'
   AND json_array_length(p.staging_json)>0 AND NOT EXISTS(SELECT 1 FROM json_each(p.staging_json) e LEFT JOIN app_private_artifacts a
    ON a.object_key=json_extract(e.value,'$.key') WHERE a.object_key IS NULL OR a.byte_digest<>json_extract(e.value,'$.byteDigest')
     OR a.size<>json_extract(e.value,'$.size') OR a.content_type<>json_extract(e.value,'$.contentType'))
 );
 SELECT RAISE(ABORT,'Missing verified public catalog reference') WHERE NEW.operation_kind='artifacts.publish-publication.v1' AND NOT EXISTS(
  SELECT 1 FROM app_artifact_publications p JOIN manifest_catalog c ON c.byte_digest=p.byte_digest WHERE p.id=NEW.result_ref
   AND p.id=json_extract(NEW.input_json,'$.id') AND p.state='published' AND p.published_operation_id=NEW.operation_id
   AND p.verified_ms=NEW.created_ms AND p.published_ms=NEW.created_ms AND c.object_key=p.object_key AND c.size_bytes=p.size_bytes AND c.kind='earn-archive-v1'
 );
 SELECT RAISE(ABORT,'Missing held publication') WHERE NEW.operation_kind='artifacts.hold-publication.v1' AND NOT EXISTS(
  SELECT 1 FROM app_artifact_publications p WHERE p.id=NEW.result_ref AND p.id=json_extract(NEW.input_json,'$.id') AND p.state='held'
   AND p.held_reason=json_extract(NEW.input_json,'$.reason') AND p.hold_operation_id=NEW.operation_id
 );
 SELECT RAISE(ABORT,'Missing quote binding') WHERE NEW.operation_kind='quotes.bind-source.v1' AND NOT EXISTS(
 SELECT 1 FROM app_quote_bindings b JOIN app_quote_heads h ON h.binding_digest=b.binding_digest AND h.market_id=b.market_id
 WHERE b.binding_digest=NEW.result_ref AND b.binding_digest=json_extract(NEW.input_json,'$.bindingDigest')
 AND b.market_id=json_extract(NEW.input_json,'$.marketId') AND b.source_id=json_extract(NEW.input_json,'$.sourceId')
 AND b.source_revision=json_extract(NEW.input_json,'$.sourceRevision') AND b.source_config_digest=json_extract(NEW.input_json,'$.sourceConfigDigest')
 AND b.stream_key=json_extract(NEW.input_json,'$.streamKey') AND b.metadata_json=json_extract(NEW.input_json,'$.metadataJson')
 AND b.created_ms=NEW.created_ms AND b.operation_id=NEW.operation_id);
 SELECT RAISE(ABORT,'Missing quote input') WHERE NEW.operation_kind='quotes.record-input.v1' AND NOT EXISTS(
 SELECT 1 FROM app_quote_inputs i WHERE i.input_digest=NEW.result_ref AND i.input_digest=json_extract(NEW.input_json,'$.inputDigest')
 AND i.binding_digest=json_extract(NEW.input_json,'$.bindingDigest') AND i.market_id=json_extract(NEW.input_json,'$.marketId')
 AND i.receipt_digest=json_extract(NEW.input_json,'$.receiptDigest') AND i.context_slot IS json_extract(NEW.input_json,'$.contextSlot')
 AND i.body_json=json_extract(NEW.input_json,'$.bodyJson') AND i.accounts_json=json_extract(NEW.input_json,'$.accountsJson')
 AND i.status=json_extract(NEW.result_json,'$.status') AND i.reason=json_extract(NEW.result_json,'$.reason')
 AND i.created_ms=NEW.created_ms AND i.operation_id=NEW.operation_id
 AND NOT EXISTS(SELECT 1 FROM json_each(i.accounts_json) e LEFT JOIN app_quote_account_slots a
 ON a.market_id=i.market_id AND a.account_kind=e.key AND a.context_slot=i.context_slot
 WHERE a.byte_digest IS NULL OR (a.byte_digest<>e.value AND a.conflict_input_digest IS NULL)));
 SELECT RAISE(ABORT,'Unknown guarded operation') WHERE NEW.operation_kind NOT IN (
  'earn.admit-submission.v1','earn.final-review.v1','ops.change-scope.v1','ops.configure-workload.v1',
  'ops.reserve-cost.v1','ops.settle-cost.v1','ops.meter-attempt.v1','evidence.private-reference.v1',
  'earn.seal-input.v1','earn.commit-board.v1','earn.commit-allocation.v1','evidence.register-source.v1','evidence.record-receipt.v1','earn.freeze-epoch.v1','earn.snapshot-attempt.v1','earn.accept-action.v1','artifacts.plan-publication.v1','artifacts.publish-publication.v1','artifacts.hold-publication.v1','quotes.bind-source.v1','quotes.record-input.v1','collection.stage-record.v1','collection.seal-list.v1','collection.seal-source.v1','governance.cast-vote.v1','collection.issue-quote.v1','collection.materialize-eligibility-page.v1','governance.publish-ballot.v1','governance.record-decision.v1','collection.reserve-operation.v1','collection.observe-asset.v1','collection.fulfill-operation.v1','collection.publish-stage.v1');
END;
