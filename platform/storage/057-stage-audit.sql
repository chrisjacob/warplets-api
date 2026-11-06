-- Published stage, immutable terms/list and operator audit share one receipt.
-- Existing committed receipts remain replayable without invented audit history.
CREATE TRIGGER app_collection_stage_audit_mandatory BEFORE UPDATE OF state ON app_command_receipts
WHEN OLD.state='staging' AND NEW.state='committed' AND NEW.operation_kind='collection.publish-stage.v1'
BEGIN
 SELECT RAISE(ABORT,'Missing exact stage publication audit') WHERE NOT EXISTS(
  SELECT 1 FROM app_collection_stages s JOIN ops_config_audit a ON a.seq=json_extract(NEW.input_json,'$.audit.seq')
  WHERE s.command_operation_id=NEW.operation_id
   AND a.previous_hash IS json_extract(NEW.input_json,'$.audit.previousHash')
   AND a.event_hash=json_extract(NEW.input_json,'$.audit.eventHash') AND a.payload=json_extract(NEW.input_json,'$.audit.payload')
   AND a.category='collection-stage' AND a.entity=s.inventory_id AND a.change_key=NEW.business_key
   AND NEW.principal_key='operator:'||a.actor AND a.recorded_ms=NEW.created_ms
   AND a.recorded_ms=json_extract(NEW.input_json,'$.audit.recordedMs')
   AND a.evidence_ref=COALESCE(s.list_id,json_extract(NEW.input_json,'$.sourceKind'))
   AND json_extract(a.payload,'$.inventoryId')=s.inventory_id AND json_extract(a.payload,'$.stageId')=s.stage_id
   AND json_extract(a.payload,'$.termsDigest')=s.terms_digest AND json_extract(a.payload,'$.requestDigest')=NEW.request_digest
   AND json_extract(a.payload,'$.eligibility.kind')=s.eligibility_kind
   AND json_extract(a.payload,'$.eligibility.listId') IS s.list_id AND json_extract(a.payload,'$.eligibility.count') IS s.eligible_count
   AND json_extract(a.payload,'$.priceLamports')=json_extract(NEW.input_json,'$.priceLamports')
   AND json_extract(a.payload,'$.costLamports')=json_extract(NEW.input_json,'$.costLamports')
   AND json_extract(a.payload,'$.sourceKind')=json_extract(NEW.input_json,'$.sourceKind')
   AND (SELECT COUNT(*) FROM json_each(a.payload))=8 AND (SELECT COUNT(*) FROM json_each(a.payload,'$.eligibility'))=3
   AND a.seq=(SELECT MAX(seq) FROM ops_config_audit)
   AND ((a.seq=1 AND a.previous_hash IS NULL) OR EXISTS(SELECT 1 FROM ops_config_audit prior WHERE prior.seq=a.seq-1 AND prior.event_hash=a.previous_hash))
 );
END;
