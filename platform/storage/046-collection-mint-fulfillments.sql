-- Private normalized mint fulfillment. Synthetic evidence only; no chain execution.
CREATE TABLE app_collection_mint_fulfillments (
 operation_id TEXT PRIMARY KEY REFERENCES app_collection_mint_admissions(operation_id),
 evidence_receipt_digest TEXT NOT NULL UNIQUE REFERENCES app_evidence_receipts(receipt_digest),
 byte_digest TEXT NOT NULL,stream_key TEXT NOT NULL,source_revision TEXT NOT NULL,
 asset_id TEXT NOT NULL UNIQUE REFERENCES collect_assets(id),proof_id TEXT NOT NULL UNIQUE,
 effective_ms INTEGER NOT NULL CHECK(effective_ms>=0 AND effective_ms%1000=0),
 provenance TEXT NOT NULL CHECK(provenance IN ('manual-fixture','configured-offline-beacon')),
 command_operation_id TEXT NOT NULL UNIQUE REFERENCES app_command_receipts(operation_id),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(CAST(result_json AS BLOB))<=16384),
 effect_json TEXT NOT NULL CHECK(json_valid(effect_json) AND length(CAST(effect_json AS BLOB))<=32768)
) STRICT;
CREATE TRIGGER recovery_guard_app_collection_mint_fulfillments_insert BEFORE INSERT ON app_collection_mint_fulfillments WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER mint_source_app_collection_mint_fulfillments_insert AFTER INSERT ON app_collection_mint_fulfillments BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_mint_fulfillments_insert AFTER INSERT ON app_collection_mint_fulfillments BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_mint_fulfillments_update BEFORE UPDATE ON app_collection_mint_fulfillments WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER mint_source_app_collection_mint_fulfillments_update AFTER UPDATE ON app_collection_mint_fulfillments BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_mint_fulfillments_update AFTER UPDATE ON app_collection_mint_fulfillments BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_mint_fulfillments_delete BEFORE DELETE ON app_collection_mint_fulfillments WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER mint_source_app_collection_mint_fulfillments_delete AFTER DELETE ON app_collection_mint_fulfillments BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_mint_fulfillments_delete AFTER DELETE ON app_collection_mint_fulfillments BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER app_collection_mint_fulfillments_no_update BEFORE UPDATE ON app_collection_mint_fulfillments BEGIN SELECT RAISE(ABORT,'Retain immutable mint fulfillment'); END;
CREATE TRIGGER app_collection_mint_fulfillments_no_delete BEFORE DELETE ON app_collection_mint_fulfillments BEGIN SELECT RAISE(ABORT,'Retain immutable mint fulfillment'); END;
DROP TRIGGER guarded_mint_settlement_pending;
CREATE TRIGGER guarded_mint_settlement BEFORE UPDATE OF settled_ms,proof_id,evidence_digest,receipt ON collect_operations
 WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE operation_id=OLD.id)
 AND (NEW.settled_ms IS NOT OLD.settled_ms OR NEW.proof_id IS NOT OLD.proof_id OR NEW.evidence_digest IS NOT OLD.evidence_digest OR NEW.receipt IS NOT OLD.receipt)
 BEGIN
 SELECT RAISE(ABORT,'Guarded normalized mint requires retained fulfillment evidence') WHERE OLD.settled_ms IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM app_collection_mint_fulfillments f JOIN app_command_receipts r ON r.operation_id=f.command_operation_id
  WHERE f.operation_id=OLD.id AND r.state='staging' AND r.operation_kind='collection.fulfill-operation.v1'
  AND r.result_ref=OLD.id AND f.result_json=r.result_json AND f.effective_ms=NEW.settled_ms AND f.proof_id=NEW.proof_id
  AND json_extract(f.effect_json,'$.legacyEvidenceDigest')=NEW.evidence_digest AND json_extract(f.effect_json,'$.operationReceiptJson')=NEW.receipt);
 END;
DROP TRIGGER app_collection_fulfillment_mandatory_effect;
CREATE TRIGGER app_collection_fulfillment_mandatory_effect BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' AND NEW.operation_kind='collection.fulfill-operation.v1' AND NOT EXISTS(SELECT 1 FROM collect_operations WHERE id=json_extract(NEW.input_json,'$.operationId') AND kind='mint') BEGIN
 SELECT RAISE(ABORT,'Missing atomic progression fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND NEW.business_key=f.operation_id
 AND substr(NEW.principal_key,1,9)='operator:'
 AND f.result_json=NEW.result_json
 AND f.operation_id=json_extract(NEW.input_json,'$.operationId')
 AND f.operation_id=json_extract(NEW.result_json,'$.operationId')
 AND f.evidence_receipt_digest=json_extract(NEW.input_json,'$.evidenceReceiptId')
 AND f.evidence_receipt_digest=json_extract(NEW.result_json,'$.evidenceReceiptId'));
 SELECT RAISE(ABORT,'Missing atomic progression fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND f.byte_digest=json_extract(NEW.input_json,'$.evidenceDigest')
 AND f.provenance=json_extract(NEW.result_json,'$.provenance')
 AND f.proof_id=json_extract(NEW.result_json,'$.proofId')
 AND f.effective_ms=json_extract(NEW.result_json,'$.effectiveMs')
 AND f.effective_ms>=op.created_ms AND f.effective_ms<=NEW.created_ms
 AND op.inventory_id=json_extract(NEW.result_json,'$.inventoryId')
 AND op.kind IN ('upgrade','visual') AND op.kind=json_extract(NEW.result_json,'$.kind'));
 SELECT RAISE(ABORT,'Missing atomic progression fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(NEW.result_json,'$.status')='fulfilled'
 AND json_extract(NEW.result_json,'$.source')='local-fixture'
 AND json_extract(NEW.result_json,'$.executable')=0
 AND op.settled_ms=f.effective_ms
 AND op.proof_id=f.proof_id
 AND op.evidence_digest=json_extract(f.effect_json,'$.legacyEvidenceDigest')
 AND op.receipt=json_extract(f.effect_json,'$.operationReceiptJson'));
 SELECT RAISE(ABORT,'Missing atomic progression fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(op.receipt,'$.operationId')=op.id
 AND json_extract(op.receipt,'$.assetId')=r.target_id
 AND json_extract(op.receipt,'$.materialId') IS r.material_id
 AND json_extract(op.receipt,'$.at')=f.effective_ms
 AND r.target_id=json_extract(NEW.result_json,'$.targetId')
 AND r.material_id IS json_extract(NEW.result_json,'$.materialId')
 AND NOT EXISTS(SELECT 1 FROM app_collection_operation_conflicts WHERE operation_id=op.id AND status='held'));
 SELECT RAISE(ABORT,'Missing atomic progression fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND e.status='verified' AND er.state='committed'
 AND e.stream_key=f.stream_key AND e.source_revision=f.source_revision
 AND json_extract(e.envelope_json,'$.byteDigest')=f.byte_digest
 AND json_extract(e.envelope_json,'$.mode')='synthetic-fixture'
 AND json_extract(e.envelope_json,'$.decoderVersion')='synthetic-collection-progression-v1'
 AND json_extract(e.envelope_json,'$.blockTimeMs')=json_extract(e.decision_json,'$.decoded.atMs')
 AND json_type(e.envelope_json,'$.requestedCutoffMs')='null');
 SELECT RAISE(ABORT,'Missing atomic progression fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(e.decision_json,'$.reason')='synthetic-progression-event-validated'
 AND json_extract(e.decision_json,'$.scope')='synthetic-transcript' AND json_extract(e.decision_json,'$.coverage.complete')=0
 AND json_extract(e.decision_json,'$.decoded.operationId')=op.id
 AND json_extract(e.decision_json,'$.decoded.inventoryId')=op.inventory_id
 AND json_extract(e.decision_json,'$.decoded.kind')=op.kind
 AND json_extract(e.decision_json,'$.decoded.commitment')=op.commitment
 AND json_extract(e.decision_json,'$.decoded.provenance')=f.provenance);
 SELECT RAISE(ABORT,'Missing atomic progression fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND ((f.provenance='manual-fixture' AND json_extract(e.decision_json,'$.decoded.atMs')=f.effective_ms) OR (f.provenance='configured-offline-beacon' AND json_extract(e.decision_json,'$.decoded.atMs')<=f.effective_ms AND f.effective_ms=NEW.created_ms))
 AND ((op.kind='visual' AND json_type(f.effect_json,'$.material')='null' AND json_array_length(f.effect_json,'$.history')=0 AND NOT EXISTS(SELECT 1 FROM collect_level_history WHERE source_ref=op.id)) OR (op.kind='upgrade' AND json_type(f.effect_json,'$.material')='object' AND json_array_length(f.effect_json,'$.history')=2 AND (SELECT COUNT(*) FROM collect_level_history WHERE source_ref=op.id)=2))
 AND NOT EXISTS(SELECT 1 FROM json_each(f.effect_json,'$.history') j LEFT JOIN collect_level_history l ON l.asset_id=json_extract(j.value,'$.assetId') AND l.source_ref=op.id WHERE l.seq IS NULL OR l.effective_ms<>f.effective_ms OR l.effective_ms<>json_extract(j.value,'$.effectiveMs') OR l.level<>json_extract(j.value,'$.level') OR json_extract(j.value,'$.sourceRef')<>op.id OR l.asset_id NOT IN (r.target_id,r.material_id))
 AND ((f.provenance='manual-fixture' AND r.fair_policy_hash IS NULL AND json_type(f.effect_json,'$.fairResult')='null' AND NOT EXISTS(SELECT 1 FROM fair_requests WHERE operation_id=op.id) AND NOT EXISTS(SELECT 1 FROM fair_results WHERE operation_id=op.id)) OR (f.provenance='configured-offline-beacon' AND r.fair_policy_hash IS NOT NULL AND EXISTS(SELECT 1 FROM fair_requests q JOIN fair_results x ON x.operation_id=q.operation_id WHERE q.operation_id=op.id AND q.target_round=r.target_round AND q.context_digest=r.context_digest AND x.proof_id=f.proof_id AND x.proof_id=json_extract(f.effect_json,'$.fairResult.proofId') AND x.signed_round=json_extract(f.effect_json,'$.fairResult.signedRoundJson') AND x.fixture=json_extract(f.effect_json,'$.fairResult.fixtureJson') AND json_extract(x.fixture,'$.at')=json_extract(e.decision_json,'$.decoded.atMs') AND x.settled_ms=json_extract(f.effect_json,'$.fairResult.settledMs')))));
 SELECT RAISE(ABORT,'Missing atomic progression participant') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN collect_assets a ON a.id=r.target_id JOIN vault_assets v ON v.id=a.id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND a.id=r.target_id
 AND a.inventory_id=op.inventory_id
 AND a.owner=op.owner
 AND v.owner=op.owner
 AND a.id=json_extract(f.effect_json,'$.target.id')
 AND a.asset=json_extract(f.effect_json,'$.target.afterJson')
 AND a.slot=json_extract(f.effect_json,'$.target.slotJson'));
 SELECT RAISE(ABORT,'Missing atomic progression participant') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN collect_assets a ON a.id=r.target_id JOIN vault_assets v ON v.id=a.id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND a.bind_ms=json_extract(f.effect_json,'$.target.bindMs')
 AND a.reveal_ms=json_extract(f.effect_json,'$.target.revealMs')
 AND a.observed_ms=f.effective_ms
 AND v.owner=json_extract(f.effect_json,'$.target.vaultOwner')
 AND v.latest_ms=json_extract(f.effect_json,'$.target.vaultLatestMs')
 AND v.coords=json_extract(f.effect_json,'$.target.vaultCoordsJson')
 AND v.slot_key=json_extract(f.effect_json,'$.target.vaultSlotKey'));
 SELECT RAISE(ABORT,'Missing atomic progression participant') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN collect_assets a ON a.id=r.target_id JOIN vault_assets v ON v.id=a.id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(a.asset,'$.owner')=op.owner
 AND json_extract(a.asset,'$.id')=a.id
 AND json_type(a.asset,'$.pending')='null'
 AND json_extract(a.asset,'$.version')=json_extract(json_extract(f.effect_json,'$.target.beforeJson'),'$.version')+1
 AND json_extract(json_extract(f.effect_json,'$.target.beforeJson'),'$.pending')=op.id
 AND json_extract(f.effect_json,'$.target.beforeJson')=r.target_after_json
 AND (op.kind='visual' OR EXISTS(SELECT 1 FROM collect_level_history WHERE asset_id=a.id AND source_ref=op.id AND effective_ms=f.effective_ms AND level=json_extract(a.asset,'$.level'))));
 SELECT RAISE(ABORT,'Missing atomic progression participant') WHERE json_extract(NEW.result_json,'$.kind')='upgrade' AND NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN collect_assets a ON a.id=r.material_id JOIN vault_assets v ON v.id=a.id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND a.id=r.material_id
 AND a.inventory_id=op.inventory_id
 AND a.owner=op.owner
 AND v.owner=op.owner
 AND a.id=json_extract(f.effect_json,'$.material.id')
 AND a.asset=json_extract(f.effect_json,'$.material.afterJson')
 AND a.slot=json_extract(f.effect_json,'$.material.slotJson'));
 SELECT RAISE(ABORT,'Missing atomic progression participant') WHERE json_extract(NEW.result_json,'$.kind')='upgrade' AND NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN collect_assets a ON a.id=r.material_id JOIN vault_assets v ON v.id=a.id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND a.bind_ms=json_extract(f.effect_json,'$.material.bindMs')
 AND a.reveal_ms=json_extract(f.effect_json,'$.material.revealMs')
 AND a.observed_ms=f.effective_ms
 AND v.owner=json_extract(f.effect_json,'$.material.vaultOwner')
 AND v.latest_ms=json_extract(f.effect_json,'$.material.vaultLatestMs')
 AND v.coords=json_extract(f.effect_json,'$.material.vaultCoordsJson')
 AND v.slot_key=json_extract(f.effect_json,'$.material.vaultSlotKey'));
 SELECT RAISE(ABORT,'Missing atomic progression participant') WHERE json_extract(NEW.result_json,'$.kind')='upgrade' AND NOT EXISTS(
 SELECT 1 FROM app_collection_fulfillments f JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_reservations r ON r.operation_id=op.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads h ON h.stream_key=e.stream_key AND h.receipt_digest=e.receipt_digest
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN collect_assets a ON a.id=r.material_id JOIN vault_assets v ON v.id=a.id
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(a.asset,'$.owner')=op.owner
 AND json_extract(a.asset,'$.id')=a.id
 AND json_type(a.asset,'$.pending')='null'
 AND json_extract(a.asset,'$.version')=json_extract(json_extract(f.effect_json,'$.material.beforeJson'),'$.version')+1
 AND json_extract(json_extract(f.effect_json,'$.material.beforeJson'),'$.pending')=op.id
 AND json_extract(f.effect_json,'$.material.beforeJson')=r.material_after_json
 AND (op.kind='visual' OR EXISTS(SELECT 1 FROM collect_level_history WHERE asset_id=a.id AND source_ref=op.id AND effective_ms=f.effective_ms AND level=json_extract(a.asset,'$.level'))));
END;
CREATE TRIGGER minted_fair_results_no_update BEFORE UPDATE ON fair_results WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE operation_id=OLD.operation_id OR operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_fair_results_no_delete BEFORE DELETE ON fair_results WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE operation_id=OLD.operation_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_collect_level_history_no_update BEFORE UPDATE ON collect_level_history WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE operation_id=OLD.source_ref OR operation_id=NEW.source_ref) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_collect_level_history_no_delete BEFORE DELETE ON collect_level_history WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE operation_id=OLD.source_ref) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_vault_observations_no_update BEFORE UPDATE ON vault_observations WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE 'collect:'||operation_id=OLD.event_id OR 'collect:'||operation_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_vault_observations_no_delete BEFORE DELETE ON vault_observations WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE 'collect:'||operation_id=OLD.event_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_collect_assets_no_update BEFORE UPDATE ON collect_assets WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE asset_id=OLD.id OR asset_id=NEW.id) AND (NEW.id IS NOT OLD.id OR NEW.inventory_id IS NOT OLD.inventory_id OR NEW.bind_ms IS NOT OLD.bind_ms OR NEW.slot IS NOT OLD.slot) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_collect_assets_no_delete BEFORE DELETE ON collect_assets WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE asset_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_vault_assets_no_update BEFORE UPDATE ON vault_assets WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE asset_id=OLD.id OR asset_id=NEW.id) AND (NEW.id IS NOT OLD.id OR NEW.slot_key IS NOT OLD.slot_key OR NEW.coords IS NOT OLD.coords) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER minted_vault_assets_no_delete BEFORE DELETE ON vault_assets WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE asset_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER app_collection_mint_fulfillment_mandatory_effect BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' AND NEW.operation_kind='collection.fulfill-operation.v1' AND EXISTS(SELECT 1 FROM collect_operations WHERE id=json_extract(NEW.input_json,'$.operationId') AND kind='mint') BEGIN
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND NEW.business_key=f.operation_id
 AND substr(NEW.principal_key,1,9)='operator:'
 AND f.result_json=NEW.result_json
 AND f.operation_id=json_extract(NEW.input_json,'$.operationId')
 AND f.evidence_receipt_digest=json_extract(NEW.input_json,'$.evidenceReceiptId')
 AND f.byte_digest=json_extract(NEW.input_json,'$.evidenceDigest')
 AND f.operation_id=json_extract(NEW.result_json,'$.operationId'));
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND f.evidence_receipt_digest=json_extract(NEW.result_json,'$.evidenceReceiptId')
 AND op.inventory_id=json_extract(NEW.result_json,'$.inventoryId')
 AND f.asset_id=json_extract(NEW.result_json,'$.assetId')
 AND f.effective_ms=json_extract(NEW.result_json,'$.at')
 AND f.provenance=json_extract(NEW.result_json,'$.provenance')
 AND json_extract(NEW.result_json,'$.kind')='mint'
 AND json_extract(NEW.result_json,'$.status')='fulfilled');
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(NEW.result_json,'$.source')='local-fixture'
 AND json_extract(NEW.result_json,'$.executable')=0
 AND op.kind='mint'
 AND op.owner=r.wallet
 AND op.inventory_id=r.inventory_id
 AND op.commitment=r.commitment
 AND op.created_ms=r.admitted_ms);
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND ar.state='committed'
 AND ar.operation_kind='collection.reserve-operation.v1'
 AND ar.result_ref=op.id
 AND ar.result_json=r.result_json
 AND op.operation=json_extract(r.effect_json,'$.operationJson')
 AND st.terms_digest=r.terms_digest
 AND f.effective_ms>=op.created_ms AND f.effective_ms<=NEW.created_ms);
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND op.settled_ms=f.effective_ms
 AND op.proof_id=f.proof_id
 AND op.evidence_digest=json_extract(f.effect_json,'$.legacyEvidenceDigest')
 AND op.receipt=json_extract(f.effect_json,'$.operationReceiptJson')
 AND json_extract(op.receipt,'$.operationId')=op.id
 AND json_extract(op.receipt,'$.assetId')=f.asset_id
 AND json_extract(op.receipt,'$.at')=f.effective_ms);
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND e.status='verified' AND er.state='committed'
 AND e.stream_key=f.stream_key AND e.source_revision=f.source_revision
 AND json_extract(e.envelope_json,'$.byteDigest')=f.byte_digest
 AND json_extract(e.envelope_json,'$.mode')='synthetic-fixture'
 AND json_extract(e.envelope_json,'$.decoderVersion')='synthetic-collection-mint-v1'
 AND json_extract(e.envelope_json,'$.blockTimeMs')=f.effective_ms
 AND json_type(e.envelope_json,'$.requestedCutoffMs')='null');
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(e.decision_json,'$.reason')='synthetic-mint-event-validated'
 AND json_extract(e.decision_json,'$.scope')='synthetic-transcript' AND json_extract(e.decision_json,'$.coverage.complete')=0
 AND json_extract(e.decision_json,'$.decoded.operationId')=op.id
 AND json_extract(e.decision_json,'$.decoded.inventoryId')=op.inventory_id
 AND json_extract(e.decision_json,'$.decoded.kind')='mint'
 AND json_extract(e.decision_json,'$.decoded.commitment')=op.commitment
 AND json_extract(e.decision_json,'$.decoded.provenance')=f.provenance);
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(e.decision_json,'$.decoded.atMs')=f.effective_ms
 AND es.source_revision=e.source_revision
 AND json_extract(es.config_json,'$.policy.inventoryId')=op.inventory_id AND json_extract(es.config_json,'$.policy.operationId')=op.id
 AND pa.byte_digest=f.byte_digest AND pa.semantic_digest IS NULL
 AND a.inventory_id=op.inventory_id AND a.id=json_extract(f.effect_json,'$.asset.id')
 AND a.owner=r.wallet AND a.owner=json_extract(f.effect_json,'$.asset.owner')
 AND a.bind_ms=f.effective_ms AND a.bind_ms=json_extract(f.effect_json,'$.asset.bindMs'));
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND a.observed_ms=f.effective_ms AND a.observed_ms=json_extract(f.effect_json,'$.asset.observedMs')
 AND a.reveal_ms IS NULL AND json_type(f.effect_json,'$.asset.revealMs')='null'
 AND a.slot=json_extract(f.effect_json,'$.asset.slotJson') AND a.asset=json_extract(f.effect_json,'$.asset.assetJson')
 AND v.coords=a.slot AND v.slot_key=a.slot AND v.owner=a.owner AND v.latest_ms=f.effective_ms
 AND vo.body=json_extract(f.effect_json,'$.vaultEventJson') AND vo.kind='bind' AND vo.observed_ms=f.effective_ms
 AND json_extract(vo.body,'$.assetId')=a.id AND json_extract(vo.body,'$.owner')=r.wallet
 AND json_extract(a.asset,'$.id')=a.id AND json_extract(a.asset,'$.owner')=r.wallet);
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(a.asset,'$.level') BETWEEN 1 AND 10
 AND json_extract(a.asset,'$.version')=0 AND json_extract(a.asset,'$.rerolls')=0 AND json_type(a.asset,'$.pending')='null'
 AND au.revision=json_extract(f.effect_json,'$.authorityRevision') AND au.revision=json_extract(f.effect_json,'$.authorityBefore.revision')+1
 AND au.admitted=json_extract(f.effect_json,'$.admitted') AND au.admitted=json_extract(f.effect_json,'$.authorityBefore.admitted')
 AND au.fulfilled=json_extract(f.effect_json,'$.fulfilled') AND au.fulfilled=json_extract(f.effect_json,'$.authorityBefore.fulfilled')+1
 AND r.ordinal=json_extract(f.effect_json,'$.admissionOrdinal') AND r.ordinal=json_extract(f.effect_json,'$.authorityBefore.fulfilled')
 AND json_extract(f.effect_json,'$.expectedAuthorityRevision')=json_extract(f.effect_json,'$.authorityBefore.revision'));
 SELECT RAISE(ABORT,'Missing atomic mint fulfillment') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json(au.remaining_json)=json(json_extract(f.effect_json,'$.remaining'))
 AND json_array_length(au.remaining_json)=10 AND (SELECT SUM(value) FROM json_each(au.remaining_json))=1000-au.fulfilled
 AND NOT EXISTS(SELECT 1 FROM json_each(json_extract(f.effect_json,'$.authorityBefore.remainingJson')) old LEFT JOIN json_each(au.remaining_json) cur ON cur.key=old.key WHERE cur.value IS NULL OR cur.value<>old.value-CASE WHEN old.key=json_extract(a.asset,'$.level')-1 THEN 1 ELSE 0 END)
 AND NOT EXISTS(SELECT 1 FROM local_campaign_registry reg JOIN vault_manifests vm ON vm.id=reg.market_id WHERE vm.activated_ms>=f.effective_ms)
 AND ((ci.kind='genesis' AND json_type(a.asset,'$.expiresAt')='null' AND json_array_length(f.effect_json,'$.history')=0 AND NOT EXISTS(SELECT 1 FROM collect_level_history WHERE source_ref=op.id)) OR (ci.kind='season' AND json_array_length(f.effect_json,'$.history')=1 AND (SELECT COUNT(*) FROM collect_level_history WHERE source_ref=op.id)=1 AND EXISTS(SELECT 1 FROM collect_level_history WHERE source_ref=op.id AND asset_id=a.id AND effective_ms=f.effective_ms AND level=json_extract(a.asset,'$.level'))))
 AND NOT EXISTS(SELECT 1 FROM json_each(f.effect_json,'$.history') j LEFT JOIN collect_level_history l ON l.source_ref=op.id AND l.asset_id=json_extract(j.value,'$.assetId') WHERE l.seq IS NULL OR l.effective_ms<>json_extract(j.value,'$.effectiveMs') OR l.level<>json_extract(j.value,'$.level') OR json_extract(j.value,'$.sourceRef')<>op.id)
 AND ((f.provenance='manual-fixture' AND r.fair_policy_hash IS NULL AND json_type(f.effect_json,'$.fairResult')='null' AND NOT EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=op.inventory_id) AND NOT EXISTS(SELECT 1 FROM fair_requests WHERE operation_id=op.id) AND NOT EXISTS(SELECT 1 FROM fair_results WHERE operation_id=op.id) AND NOT EXISTS(SELECT 1 FROM fair_reserved_assets WHERE asset_id=a.id)) OR (f.provenance='configured-offline-beacon' AND r.fair_policy_hash IS NOT NULL AND EXISTS(SELECT 1 FROM fair_inventories fi JOIN fair_requests q ON q.operation_id=op.id JOIN fair_results x ON x.operation_id=q.operation_id JOIN fair_reserved_assets ra ON ra.inventory_id=fi.inventory_id AND ra.asset_id=a.id WHERE fi.inventory_id=op.inventory_id AND fi.policy_hash=r.fair_policy_hash AND fi.registered_ms=r.fair_registered_ms AND q.target_round=r.target_round AND q.context_digest=r.context_digest AND x.proof_id=f.proof_id AND x.proof_id=json_extract(f.effect_json,'$.fairResult.proofId') AND x.signed_round=json_extract(f.effect_json,'$.fairResult.signedRoundJson') AND x.fixture=json_extract(f.effect_json,'$.fairResult.fixtureJson') AND x.settled_ms=json_extract(f.effect_json,'$.fairResult.settledMs') AND x.settled_ms>=f.effective_ms AND x.settled_ms<=NEW.created_ms AND json_extract(x.fixture,'$.at')=f.effective_ms AND json_extract(x.fixture,'$.assetId')=a.id))));
 SELECT RAISE(ABORT,'Missing atomic mint slot binding') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND ((ci.kind='genesis' AND json_extract(a.slot,'$.kind')='genesis' AND json_extract(a.slot,'$.tranche')=ci.tranche AND json_extract(a.slot,'$.level')=json_extract(a.asset,'$.level') AND json_extract(a.slot,'$.ordinal')=(json_extract('[489,256,128,64,32,16,8,4,2,1]','$['||(json_extract(a.asset,'$.level')-1)||']')-json_extract(json_extract(f.effect_json,'$.authorityBefore.remainingJson'),'$['||(json_extract(a.asset,'$.level')-1)||']'))) OR (ci.kind='season' AND json_extract(a.slot,'$.kind')='season' AND json_extract(a.slot,'$.seasonId')=ci.id AND json_extract(a.slot,'$.slotIndex')=((SELECT COALESCE(SUM(value),0) FROM json_each('[489,256,128,64,32,16,8,4,2,1]') WHERE key<json_extract(a.asset,'$.level')-1)+(json_extract('[489,256,128,64,32,16,8,4,2,1]','$['||(json_extract(a.asset,'$.level')-1)||']')-json_extract(json_extract(f.effect_json,'$.authorityBefore.remainingJson'),'$['||(json_extract(a.asset,'$.level')-1)||']'))))));
 SELECT RAISE(ABORT,'Missing atomic mint slot binding') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND (f.provenance='manual-fixture' OR EXISTS(SELECT 1 FROM fair_reserved_assets WHERE inventory_id=op.inventory_id AND asset_id=a.id AND slot_index=((SELECT COALESCE(SUM(value),0) FROM json_each('[489,256,128,64,32,16,8,4,2,1]') WHERE key<json_extract(a.asset,'$.level')-1)+(json_extract('[489,256,128,64,32,16,8,4,2,1]','$['||(json_extract(a.asset,'$.level')-1)||']')-json_extract(json_extract(f.effect_json,'$.authorityBefore.remainingJson'),'$['||(json_extract(a.asset,'$.level')-1)||']'))))));
 SELECT RAISE(ABORT,'Missing atomic mint slot binding') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND (ci.kind='genesis' OR json_extract(a.asset,'$.expiresAt')=(unixepoch(ci.season_start/1000,'unixepoch','start of month','+'||json_extract(a.asset,'$.level')||' months')*1000+(MIN(CAST(strftime('%d',ci.season_start/1000,'unixepoch') AS INTEGER),CAST(strftime('%d',ci.season_start/1000,'unixepoch','start of month','+'||(json_extract(a.asset,'$.level')+1)||' months','-1 day') AS INTEGER))-1)*86400000+ci.season_start%86400000)));
 SELECT RAISE(ABORT,'Missing atomic mint binding fields') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(vo.body,'$.eventId')=vo.event_id AND json_extract(vo.body,'$.kind')='bind' AND json_extract(vo.body,'$.slot')=a.slot AND json_extract(vo.body,'$.at')=strftime('%Y-%m-%dT%H:%M:%fZ',f.effective_ms/1000,'unixepoch'));
 SELECT RAISE(ABORT,'Missing atomic mint binding fields') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_fulfillments f
 JOIN collect_operations op ON op.id=f.operation_id
 JOIN app_collection_mint_admissions r ON r.operation_id=op.id
 JOIN app_command_receipts ar ON ar.operation_id=r.command_operation_id
 JOIN app_collection_stages st ON st.inventory_id=r.inventory_id AND st.stage_id=r.stage_id
 JOIN app_collection_authorities au ON au.inventory_id=op.inventory_id
 JOIN collect_inventories ci ON ci.id=op.inventory_id
 JOIN collect_assets a ON a.id=f.asset_id JOIN vault_assets v ON v.id=a.id
 JOIN vault_observations vo ON vo.event_id='collect:'||op.id AND vo.asset_id=a.id
 JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest
 JOIN app_evidence_heads eh ON eh.stream_key=e.stream_key AND eh.receipt_digest=e.receipt_digest
 JOIN app_evidence_sources es ON es.source_id=e.source_id AND es.source_revision=e.source_revision
 JOIN app_command_receipts er ON er.operation_id=e.operation_id
 JOIN app_private_artifacts pa ON pa.object_key=json_extract(e.envelope_json,'$.objectRef')
 WHERE f.command_operation_id=NEW.operation_id AND f.operation_id=NEW.result_ref
 AND json_extract(a.asset,'$.eligibleAt')=0 AND json_extract(f.effect_json,'$.asset.inventoryId')=op.inventory_id AND NOT EXISTS(SELECT 1 FROM json_each(au.remaining_json) WHERE type<>'integer' OR value<0));
END;
CREATE TRIGGER minted_collect_level_history_no_insert BEFORE INSERT ON collect_level_history WHEN EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE operation_id=NEW.source_ref) AND NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE status='restoring' AND write_nonce IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
