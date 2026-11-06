-- Advisory governance records and their operator audits are one atomic effect.
CREATE TRIGGER app_governance_publication_audit_mandatory BEFORE UPDATE OF state ON app_command_receipts
WHEN OLD.state='staging' AND NEW.state='committed' AND NEW.operation_kind='governance.publish-ballot.v1'
BEGIN
 SELECT RAISE(ABORT,'Missing exact governance publication audit') WHERE NOT EXISTS(
  SELECT 1 FROM app_governance_publications p JOIN genesis_ballots b ON b.id=p.ballot_id
   JOIN ops_config_audit a ON a.seq=json_extract(NEW.input_json,'$.audit.seq')
  WHERE p.operation_id=NEW.operation_id AND b.id=NEW.result_ref
   AND a.previous_hash IS json_extract(NEW.input_json,'$.audit.previousHash')
   AND a.event_hash=json_extract(NEW.input_json,'$.audit.eventHash') AND a.payload=json_extract(NEW.input_json,'$.audit.payload')
   AND a.category='governance-publication' AND a.entity=b.id AND a.change_key=NEW.request_key
   AND NEW.principal_key='operator:'||a.actor AND a.recorded_ms=NEW.created_ms
   AND a.recorded_ms=json_extract(NEW.input_json,'$.audit.recordedMs') AND a.evidence_ref=p.source_id
   AND json_extract(a.payload,'$.requestDigest')=NEW.request_digest
   AND json_extract(a.payload,'$.snapshotHash')=b.snapshot_hash AND json_extract(a.payload,'$.eligibleCount')=b.eligible_count
   AND json_extract(a.payload,'$.electorateDigest')=p.source_digest AND json_extract(a.payload,'$.sourceKind')=p.source_kind
   AND json_extract(a.payload,'$.holdersListId')=p.holders_list_id AND json_extract(a.payload,'$.nextWhitelistListId')=p.next_whitelist_list_id
   AND json_extract(a.payload,'$.unionListId')=p.union_list_id AND (SELECT COUNT(*) FROM json_each(a.payload))=8
   AND a.seq=(SELECT MAX(seq) FROM ops_config_audit)
   AND ((a.seq=1 AND a.previous_hash IS NULL) OR EXISTS(SELECT 1 FROM ops_config_audit prior WHERE prior.seq=a.seq-1 AND prior.event_hash=a.previous_hash))
 );
END;
CREATE TRIGGER app_governance_decision_audit_mandatory BEFORE UPDATE OF state ON app_command_receipts
WHEN OLD.state='staging' AND NEW.state='committed' AND NEW.operation_kind='governance.record-decision.v1'
BEGIN
 SELECT RAISE(ABORT,'Missing exact governance decision audit') WHERE NOT EXISTS(
  SELECT 1 FROM genesis_decisions d JOIN genesis_ballots b ON b.id=d.ballot_id
   JOIN ops_config_audit a ON a.seq=json_extract(NEW.input_json,'$.audit.seq')
  WHERE d.ballot_id=NEW.result_ref
   AND a.previous_hash IS json_extract(NEW.input_json,'$.audit.previousHash')
   AND a.event_hash=json_extract(NEW.input_json,'$.audit.eventHash') AND a.payload=json_extract(NEW.input_json,'$.audit.payload')
   AND a.category=CASE WHEN json_extract(NEW.input_json,'$.adoptedLegacy')=1 THEN 'governance-decision-adoption' ELSE 'governance-decision' END
   AND a.entity=d.ballot_id AND a.change_key=NEW.request_key AND NEW.principal_key='operator:'||a.actor
   AND a.recorded_ms=NEW.created_ms AND a.recorded_ms=json_extract(NEW.input_json,'$.audit.recordedMs')
   AND a.recorded_ms>=d.decided_ms AND a.evidence_ref=b.snapshot_hash
   AND json_extract(a.payload,'$.ballotId')=d.ballot_id AND json_extract(a.payload,'$.choice')=d.choice
   AND json_extract(a.payload,'$.decidedMs')=d.decided_ms AND json_extract(a.payload,'$.noticeMs')=d.notice_ms
   AND json_extract(a.payload,'$.earliestMs')=d.earliest_ms AND json_extract(a.payload,'$.rationale')=d.rationale
   AND json_extract(a.payload,'$.requestDigest')=NEW.request_digest AND json_extract(a.payload,'$.ballotSnapshotHash')=b.snapshot_hash
   AND json_extract(a.payload,'$.adoptedLegacy')=json_extract(NEW.input_json,'$.adoptedLegacy')
   AND (SELECT COUNT(*) FROM json_each(a.payload))=9 AND a.seq=(SELECT MAX(seq) FROM ops_config_audit)
   AND ((a.seq=1 AND a.previous_hash IS NULL) OR EXISTS(SELECT 1 FROM ops_config_audit prior WHERE prior.seq=a.seq-1 AND prior.event_hash=a.previous_hash))
 );
END;
