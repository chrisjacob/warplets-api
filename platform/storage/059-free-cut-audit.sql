-- Every new fixed-cut operator command has a matching atomic audit child.
CREATE TRIGGER app_collection_cut_audit_mandatory BEFORE UPDATE OF state ON app_command_receipts
WHEN OLD.state='staging' AND NEW.state='committed' AND NEW.operation_kind IN
 ('collection.stage-cut-record.v1','collection.begin-free-cut.v1','collection.validate-cut-page.v1','collection.seal-free-cut.v1')
BEGIN
 SELECT RAISE(ABORT,'Missing exact collection cut audit') WHERE NOT EXISTS(
  SELECT 1 FROM ops_config_audit a WHERE a.seq=json_extract(NEW.input_json,'$.audit.seq')
   AND a.previous_hash IS json_extract(NEW.input_json,'$.audit.previousHash')
   AND a.event_hash=json_extract(NEW.input_json,'$.audit.eventHash') AND a.payload=json_extract(NEW.input_json,'$.audit.payload')
   AND a.category='collection-free-cut' AND a.entity=NEW.business_key AND a.change_key=NEW.request_key
   AND NEW.principal_key='operator:'||a.actor AND a.recorded_ms=NEW.created_ms
   AND a.recorded_ms=json_extract(NEW.input_json,'$.audit.recordedMs')
   AND a.evidence_ref=CASE NEW.operation_kind WHEN 'collection.stage-cut-record.v1' THEN json_extract(NEW.input_json,'$.id')
    WHEN 'collection.begin-free-cut.v1' THEN json_extract(NEW.input_json,'$.rootId') ELSE json_extract(NEW.input_json,'$.attemptId') END
   AND json_extract(a.payload,'$.operationKind')=NEW.operation_kind AND json_extract(a.payload,'$.requestDigest')=NEW.request_digest
   AND json_extract(a.payload,'$.resultRef')=NEW.result_ref AND json_extract(a.payload,'$.resultDigest')=NEW.output_digest
   AND (SELECT COUNT(*) FROM json_each(a.payload))=4 AND a.seq=(SELECT MAX(seq) FROM ops_config_audit)
   AND ((a.seq=1 AND a.previous_hash IS NULL) OR EXISTS(SELECT 1 FROM ops_config_audit prior WHERE prior.seq=a.seq-1 AND prior.event_hash=a.previous_hash))
 );
END;
