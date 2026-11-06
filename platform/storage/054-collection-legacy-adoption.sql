-- Retained legacy adoption evidence and guarded current import receipts.
-- Private activation requires separately verified preparation; no public or financial capability.
CREATE TABLE app_collection_legacy_adoptions (
 id TEXT PRIMARY KEY,
 inventory_id TEXT NOT NULL UNIQUE REFERENCES collect_inventories(id),
 activation_command_id TEXT NOT NULL UNIQUE REFERENCES app_command_receipts(operation_id),
 root_id TEXT NOT NULL REFERENCES app_collection_source_seals(id),
 source_revision INTEGER NOT NULL CHECK(source_revision>=0),
 raw_digest TEXT NOT NULL CHECK(length(raw_digest)=64 AND raw_digest NOT GLOB '*[^0-9a-f]*'),
 canonical_digest TEXT NOT NULL CHECK(length(canonical_digest)=64 AND canonical_digest NOT GLOB '*[^0-9a-f]*'),
 origin_digest TEXT NOT NULL CHECK(length(origin_digest)=64 AND origin_digest NOT GLOB '*[^0-9a-f]*'),
 source_generation TEXT NOT NULL CHECK(length(CAST(source_generation AS BLOB)) BETWEEN 1 AND 256),
 source_watermark INTEGER NOT NULL CHECK(source_watermark>=0),
 schema_fingerprint TEXT NOT NULL CHECK(length(schema_fingerprint)=64 AND schema_fingerprint NOT GLOB '*[^0-9a-f]*'),
 economic_audit_id TEXT NOT NULL,
 economic_selection_digest TEXT NOT NULL CHECK(length(economic_selection_digest)=64 AND economic_selection_digest NOT GLOB '*[^0-9a-f]*'),
 economic_chain_digest TEXT NOT NULL CHECK(length(economic_chain_digest)=64 AND economic_chain_digest NOT GLOB '*[^0-9a-f]*'),
 economic_result_json TEXT NOT NULL CHECK(json_valid(economic_result_json) AND length(CAST(economic_result_json AS BLOB))<=16384),
 economic_result_digest TEXT NOT NULL CHECK(length(economic_result_digest)=64 AND economic_result_digest NOT GLOB '*[^0-9a-f]*'),
 parent_digest TEXT NOT NULL CHECK(length(parent_digest)=64 AND parent_digest NOT GLOB '*[^0-9a-f]*'),
 parent_preimage_json TEXT NOT NULL CHECK(json_valid(parent_preimage_json) AND length(CAST(parent_preimage_json AS BLOB))<=8192),
 quiescence_json TEXT NOT NULL CHECK(json_valid(quiescence_json) AND length(CAST(quiescence_json AS BLOB))<=8192),
 preparation_digest TEXT NOT NULL CHECK(length(preparation_digest)=64 AND preparation_digest NOT GLOB '*[^0-9a-f]*'),
 preparation_result_json TEXT NOT NULL CHECK(json_valid(preparation_result_json) AND length(CAST(preparation_result_json AS BLOB))<=16384),
 preparation_result_digest TEXT NOT NULL CHECK(length(preparation_result_digest)=64 AND preparation_result_digest NOT GLOB '*[^0-9a-f]*'),
 stage_count INTEGER NOT NULL CHECK(stage_count BETWEEN 0 AND 32),
 admitted INTEGER NOT NULL CHECK(admitted BETWEEN 0 AND 1000),
 fulfilled INTEGER NOT NULL CHECK(fulfilled=admitted),
 remaining_json TEXT NOT NULL CHECK(json_valid(remaining_json) AND length(CAST(remaining_json AS BLOB))<=512),
 operator TEXT NOT NULL,
 created_ms INTEGER NOT NULL CHECK(created_ms BETWEEN 0 AND 8640000000000000),
 UNIQUE(id,inventory_id)
) STRICT;
CREATE TRIGGER app_collection_legacy_adoptions_no_update BEFORE UPDATE ON app_collection_legacy_adoptions BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER app_collection_legacy_adoptions_no_delete BEFORE DELETE ON app_collection_legacy_adoptions BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER recovery_guard_app_collection_legacy_adoptions_insert BEFORE INSERT ON app_collection_legacy_adoptions WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_adoptions_insert AFTER INSERT ON app_collection_legacy_adoptions BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_adoptions_insert AFTER INSERT ON app_collection_legacy_adoptions BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_adoptions_update BEFORE UPDATE ON app_collection_legacy_adoptions WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_adoptions_update AFTER UPDATE ON app_collection_legacy_adoptions BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_adoptions_update AFTER UPDATE ON app_collection_legacy_adoptions BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_adoptions_delete BEFORE DELETE ON app_collection_legacy_adoptions WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_adoptions_delete AFTER DELETE ON app_collection_legacy_adoptions BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_adoptions_delete AFTER DELETE ON app_collection_legacy_adoptions BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TABLE app_collection_legacy_stage_imports (
 adoption_id TEXT NOT NULL,
 inventory_id TEXT NOT NULL,
 stage_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 31),
 command_operation_id TEXT NOT NULL UNIQUE REFERENCES app_command_receipts(operation_id),
 body_json TEXT NOT NULL CHECK(json_valid(body_json) AND length(CAST(body_json AS BLOB))<=16384),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 source_proof_digest TEXT NOT NULL CHECK(length(source_proof_digest)=64 AND source_proof_digest NOT GLOB '*[^0-9a-f]*'),
 prior_chain_digest TEXT NOT NULL CHECK(length(prior_chain_digest)=64 AND prior_chain_digest NOT GLOB '*[^0-9a-f]*'),
 chain_digest TEXT NOT NULL CHECK(length(chain_digest)=64 AND chain_digest NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(inventory_id,stage_id),
 UNIQUE(inventory_id,ordinal),
 FOREIGN KEY(adoption_id,inventory_id) REFERENCES app_collection_legacy_adoptions(id,inventory_id),
 FOREIGN KEY(inventory_id,stage_id) REFERENCES app_collection_stages(inventory_id,stage_id)
) STRICT;
CREATE TRIGGER app_collection_legacy_stage_imports_no_update BEFORE UPDATE ON app_collection_legacy_stage_imports BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER app_collection_legacy_stage_imports_no_delete BEFORE DELETE ON app_collection_legacy_stage_imports BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER recovery_guard_app_collection_legacy_stage_imports_insert BEFORE INSERT ON app_collection_legacy_stage_imports WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_stage_imports_insert AFTER INSERT ON app_collection_legacy_stage_imports BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_stage_imports_insert AFTER INSERT ON app_collection_legacy_stage_imports BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_stage_imports_update BEFORE UPDATE ON app_collection_legacy_stage_imports WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_stage_imports_update AFTER UPDATE ON app_collection_legacy_stage_imports BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_stage_imports_update AFTER UPDATE ON app_collection_legacy_stage_imports BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_stage_imports_delete BEFORE DELETE ON app_collection_legacy_stage_imports WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_stage_imports_delete AFTER DELETE ON app_collection_legacy_stage_imports BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_stage_imports_delete AFTER DELETE ON app_collection_legacy_stage_imports BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TABLE app_collection_legacy_mint_anchors (
 adoption_id TEXT NOT NULL,
 inventory_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 999),
 operation_id TEXT PRIMARY KEY REFERENCES collect_operations(id),
 stage_id TEXT NOT NULL,
 wallet TEXT NOT NULL CHECK(length(wallet) BETWEEN 32 AND 44),
 request_key TEXT NOT NULL,
 commitment TEXT NOT NULL UNIQUE,
 admitted_ms INTEGER NOT NULL CHECK(admitted_ms>=0),
 settled_ms INTEGER NOT NULL CHECK(settled_ms>=admitted_ms),
 terms_digest TEXT NOT NULL CHECK(length(terms_digest)=64 AND terms_digest NOT GLOB '*[^0-9a-f]*'),
 price_lamports TEXT NOT NULL CHECK((price_lamports='0' OR (length(price_lamports) BETWEEN 1 AND 20 AND substr(price_lamports,1,1) BETWEEN '1' AND '9' AND price_lamports NOT GLOB '*[^0-9]*')) AND (length(price_lamports)<20 OR price_lamports<='18446744073709551615')),
 cost_lamports TEXT NOT NULL CHECK((cost_lamports='0' OR (length(cost_lamports) BETWEEN 1 AND 20 AND substr(cost_lamports,1,1) BETWEEN '1' AND '9' AND cost_lamports NOT GLOB '*[^0-9]*')) AND (length(cost_lamports)<20 OR cost_lamports<='18446744073709551615')),
 asset_id TEXT NOT NULL UNIQUE REFERENCES collect_assets(id),
 body_json TEXT NOT NULL CHECK(json_valid(body_json) AND length(CAST(body_json AS BLOB))<=8192),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 source_proof_digest TEXT NOT NULL CHECK(length(source_proof_digest)=64 AND source_proof_digest NOT GLOB '*[^0-9a-f]*'),
 current_source_digest TEXT NOT NULL CHECK(length(current_source_digest)=64 AND current_source_digest NOT GLOB '*[^0-9a-f]*'),
 prior_chain_digest TEXT NOT NULL CHECK(length(prior_chain_digest)=64 AND prior_chain_digest NOT GLOB '*[^0-9a-f]*'),
 chain_digest TEXT NOT NULL CHECK(length(chain_digest)=64 AND chain_digest NOT GLOB '*[^0-9a-f]*'),
 UNIQUE(inventory_id,ordinal),
 UNIQUE(wallet,request_key),
 FOREIGN KEY(adoption_id,inventory_id) REFERENCES app_collection_legacy_adoptions(id,inventory_id),
 FOREIGN KEY(inventory_id,stage_id) REFERENCES app_collection_stages(inventory_id,stage_id)
) STRICT;
CREATE TRIGGER app_collection_legacy_mint_anchors_no_update BEFORE UPDATE ON app_collection_legacy_mint_anchors BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER app_collection_legacy_mint_anchors_no_delete BEFORE DELETE ON app_collection_legacy_mint_anchors BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER recovery_guard_app_collection_legacy_mint_anchors_insert BEFORE INSERT ON app_collection_legacy_mint_anchors WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_mint_anchors_insert AFTER INSERT ON app_collection_legacy_mint_anchors BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_mint_anchors_insert AFTER INSERT ON app_collection_legacy_mint_anchors BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_mint_anchors_update BEFORE UPDATE ON app_collection_legacy_mint_anchors WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_mint_anchors_update AFTER UPDATE ON app_collection_legacy_mint_anchors BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_mint_anchors_update AFTER UPDATE ON app_collection_legacy_mint_anchors BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_mint_anchors_delete BEFORE DELETE ON app_collection_legacy_mint_anchors WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_mint_anchors_delete AFTER DELETE ON app_collection_legacy_mint_anchors BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_mint_anchors_delete AFTER DELETE ON app_collection_legacy_mint_anchors BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TABLE app_collection_legacy_adoption_objects (
 adoption_id TEXT NOT NULL REFERENCES app_collection_legacy_adoptions(id),
 object_key TEXT NOT NULL,
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json) AND length(CAST(identity_json AS BLOB))<=1024),
 discovery_json TEXT NOT NULL CHECK(json_valid(discovery_json) AND length(CAST(discovery_json AS BLOB))<=2048),
 body_json TEXT NOT NULL CHECK(json_valid(body_json) AND length(CAST(body_json AS BLOB))<=8192),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 prior_chain_digest TEXT NOT NULL CHECK(length(prior_chain_digest)=64 AND prior_chain_digest NOT GLOB '*[^0-9a-f]*'),
 chain_digest TEXT NOT NULL CHECK(length(chain_digest)=64 AND chain_digest NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(adoption_id,object_key)
) STRICT;
CREATE TRIGGER app_collection_legacy_adoption_objects_no_update BEFORE UPDATE ON app_collection_legacy_adoption_objects BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER app_collection_legacy_adoption_objects_no_delete BEFORE DELETE ON app_collection_legacy_adoption_objects BEGIN SELECT RAISE(ABORT,'Retain immutable legacy adoption evidence'); END;
CREATE TRIGGER recovery_guard_app_collection_legacy_adoption_objects_insert BEFORE INSERT ON app_collection_legacy_adoption_objects WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_adoption_objects_insert AFTER INSERT ON app_collection_legacy_adoption_objects BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_adoption_objects_insert AFTER INSERT ON app_collection_legacy_adoption_objects BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_adoption_objects_update BEFORE UPDATE ON app_collection_legacy_adoption_objects WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_adoption_objects_update AFTER UPDATE ON app_collection_legacy_adoption_objects BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_adoption_objects_update AFTER UPDATE ON app_collection_legacy_adoption_objects BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_legacy_adoption_objects_delete BEFORE DELETE ON app_collection_legacy_adoption_objects WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER adoption_source_app_collection_legacy_adoption_objects_delete AFTER DELETE ON app_collection_legacy_adoption_objects BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_legacy_adoption_objects_delete AFTER DELETE ON app_collection_legacy_adoption_objects BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE INDEX legacy_mint_stage_wallet ON app_collection_legacy_mint_anchors(inventory_id,stage_id,wallet);
-- TODO: exact source/preparation insert guards, stage/parent receipt mandatory effects, cross-family identities, historical original immutability, and recovery reconciliation.


-- Draft activation insert guards; parent mandatory effects and compatibility still outstanding.
CREATE TRIGGER legacy_adoption_prepared_insert BEFORE INSERT ON app_collection_legacy_adoptions WHEN NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'Activation must copy exact prepared evidence') WHERE NOT EXISTS(SELECT 1 FROM app_collection_legacy_preparations a JOIN app_collection_legacy_economics e ON e.id=a.economic_audit_id JOIN app_collection_legacy_relations r ON r.id=e.relation_audit_id JOIN app_collection_legacy_audits f ON f.id=r.parent_audit_id CROSS JOIN app_command_receipts c WHERE ((((((a.id=NEW.id AND a.economic_audit_id=e.id) AND (a.operator=NEW.operator AND a.state='prepared')) AND ((a.phase='finish' AND a.parent_digest=NEW.parent_digest) AND (a.quiescence_json IS NEW.quiescence_json AND a.created_ms IS json_extract(NEW.parent_preimage_json,'$.createdMs')))) AND (((a.chain_digest=NEW.preparation_digest AND a.result_json=NEW.preparation_result_json) AND (a.result_digest=NEW.preparation_result_digest AND e.state='ready')) AND ((e.id=NEW.economic_audit_id AND e.operator=NEW.operator) AND (e.selection_digest=NEW.economic_selection_digest AND (e.chain_digest=NEW.economic_chain_digest AND e.result_json=NEW.economic_result_json))))) AND ((((r.state='ready' AND f.state='fingerprints-ready') AND (f.inventory_id=NEW.inventory_id AND f.root_id=NEW.root_id)) AND ((f.source_revision=NEW.source_revision AND f.raw_digest=NEW.raw_digest) AND (f.canonical_digest=NEW.canonical_digest AND NEW.origin_digest IS (SELECT origin_digest FROM collect_inventories WHERE id=f.inventory_id)))) AND (((json_extract(f.descriptor_json,'$.sourceGeneration') IS NEW.source_generation AND json_extract(f.descriptor_json,'$.sourceWatermark') IS NEW.source_watermark) AND (json_extract(f.descriptor_json,'$.schema.fingerprint') IS NEW.schema_fingerprint AND a.stage_index=NEW.stage_count)) AND ((a.admission_index=NEW.admitted AND json_extract(e.result_json,'$.fulfilled') IS NEW.fulfilled) AND (json_extract(e.result_json,'$.remaining') IS NEW.remaining_json AND (c.operation_id=NEW.activation_command_id AND c.state='staging')))))) AND (((((c.operation_kind='collection.adopt-legacy-source.v1' AND c.principal_key='operator:'||NEW.operator) AND (c.created_ms=NEW.created_ms AND c.business_key=NEW.inventory_id)) AND ((c.result_ref=NEW.inventory_id AND json_extract(c.input_json,'$.adoptionId') IS NEW.id) AND (json_extract(c.input_json,'$.parentDigest') IS NEW.parent_digest AND json_extract(c.input_json,'$.preparationDigest') IS NEW.preparation_digest))) AND (((json_extract(c.input_json,'$.preparationResultDigest') IS NEW.preparation_result_digest AND json_extract(c.input_json,'$.economicResultDigest') IS NEW.economic_result_digest) AND (NEW.created_ms>=a.created_ms AND a.created_ms>=e.as_of_ms)) AND ((json_extract(NEW.parent_preimage_json,'$.format') IS 'legacy-adoption-parent-v1' AND (SELECT COUNT(*) FROM json_each(NEW.parent_preimage_json))=22) AND (json_extract(NEW.parent_preimage_json,'$.id') IS e.id AND (json_extract(NEW.parent_preimage_json,'$.operator') IS e.operator AND json_extract(NEW.parent_preimage_json,'$.economic_as_of') IS e.as_of_ms))))) AND ((((json_extract(NEW.parent_preimage_json,'$.selection_digest') IS e.selection_digest AND json_extract(NEW.parent_preimage_json,'$.economic_chain') IS e.chain_digest) AND (json_extract(NEW.parent_preimage_json,'$.relation_audit_id') IS r.id AND json_extract(NEW.parent_preimage_json,'$.fingerprint_id') IS f.id)) AND ((json_extract(NEW.parent_preimage_json,'$.inventory_id') IS f.inventory_id AND json_extract(NEW.parent_preimage_json,'$.root_id') IS f.root_id) AND (json_extract(NEW.parent_preimage_json,'$.source_revision') IS f.source_revision AND (json_extract(NEW.parent_preimage_json,'$.raw_digest') IS f.raw_digest AND json_extract(NEW.parent_preimage_json,'$.canonical_digest') IS f.canonical_digest)))) AND (((json_extract(NEW.parent_preimage_json,'$.source_generation') IS NEW.source_generation AND json_extract(NEW.parent_preimage_json,'$.source_watermark') IS NEW.source_watermark) AND (json_extract(NEW.parent_preimage_json,'$.schema_fingerprint') IS NEW.schema_fingerprint AND json_extract(NEW.parent_preimage_json,'$.relation_digest') IS json_extract(r.result_json,'$.relationDigest'))) AND ((json_extract(NEW.parent_preimage_json,'$.stage_count') IS NEW.stage_count AND json_extract(NEW.parent_preimage_json,'$.admission_count') IS NEW.admitted) AND (json_extract(NEW.parent_preimage_json,'$.source_current') IS 1 AND (json_extract(NEW.parent_preimage_json,'$.economicResultDigest') IS NEW.economic_result_digest AND json_extract(NEW.parent_preimage_json,'$.createdMs') IS a.created_ms))))))));
END;
CREATE TRIGGER app_collection_legacy_stage_imports_prepared_insert BEFORE INSERT ON app_collection_legacy_stage_imports WHEN NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'Activation must copy exact prepared evidence') WHERE NOT EXISTS(SELECT 1 FROM app_collection_legacy_adoptions a JOIN app_command_receipts c ON c.operation_id=a.activation_command_id JOIN app_collection_legacy_prepared_stages p ON p.preparation_id=a.id WHERE (((a.id=NEW.adoption_id AND (a.activation_command_id=c.operation_id AND c.state='staging')) AND ((c.operation_kind='collection.adopt-legacy-source.v1' AND p.preparation_id=a.id) AND (a.inventory_id=NEW.inventory_id AND p.body_json IS NEW.body_json))) AND ((p.body_digest IS NEW.body_digest AND (p.prior_chain_digest IS NEW.prior_chain_digest AND p.chain_digest IS NEW.chain_digest)) AND ((p.stage_index IS NEW.ordinal AND p.stage_id IS NEW.stage_id) AND (p.operation_id IS NEW.command_operation_id AND p.source_proof_digest IS NEW.source_proof_digest)))));
END;
CREATE TRIGGER app_collection_legacy_mint_anchors_prepared_insert BEFORE INSERT ON app_collection_legacy_mint_anchors WHEN NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'Activation must copy exact prepared evidence') WHERE NOT EXISTS(SELECT 1 FROM app_collection_legacy_adoptions a JOIN app_command_receipts c ON c.operation_id=a.activation_command_id JOIN app_collection_legacy_prepared_admissions p ON p.preparation_id=a.id WHERE (((a.id=NEW.adoption_id AND (a.activation_command_id=c.operation_id AND c.state='staging')) AND ((c.operation_kind='collection.adopt-legacy-source.v1' AND p.preparation_id=a.id) AND (a.inventory_id=NEW.inventory_id AND p.body_json IS NEW.body_json))) AND (((p.body_digest IS NEW.body_digest AND p.prior_chain_digest IS NEW.prior_chain_digest) AND (p.chain_digest IS NEW.chain_digest AND p.ordinal IS NEW.ordinal)) AND ((p.operation_id IS NEW.operation_id AND p.asset_id IS NEW.asset_id) AND (p.source_proof_digest IS NEW.source_proof_digest AND p.current_source_digest IS NEW.current_source_digest)))));
END;
CREATE TRIGGER app_collection_legacy_adoption_objects_prepared_insert BEFORE INSERT ON app_collection_legacy_adoption_objects WHEN NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'Activation must copy exact prepared evidence') WHERE NOT EXISTS(SELECT 1 FROM app_collection_legacy_adoptions a JOIN app_command_receipts c ON c.operation_id=a.activation_command_id JOIN app_collection_legacy_prepared_objects p ON p.preparation_id=a.id JOIN app_collection_legacy_object_candidates o ON o.preparation_id=p.preparation_id AND o.object_key=p.object_key WHERE (((a.id=NEW.adoption_id AND (a.activation_command_id=c.operation_id AND c.state='staging')) AND (c.operation_kind='collection.adopt-legacy-source.v1' AND (p.preparation_id=a.id AND p.body_json IS NEW.body_json))) AND ((p.body_digest IS NEW.body_digest AND (p.prior_chain_digest IS NEW.prior_chain_digest AND p.chain_digest IS NEW.chain_digest)) AND (p.object_key IS NEW.object_key AND (o.identity_json IS NEW.identity_json AND o.discovery_json IS NEW.discovery_json)))));
END;
CREATE TRIGGER app_collection_legacy_stage_imports_body_projection BEFORE INSERT ON app_collection_legacy_stage_imports BEGIN
 SELECT RAISE(ABORT,'Retained adoption projection differs from committed body') WHERE NOT EXISTS(SELECT 1 WHERE ((json_extract(NEW.body_json,'$.format') IS 'legacy-adoption-stage-prepared-v1' AND (json_extract(NEW.body_json,'$.adoptionId') IS NEW.adoption_id AND json_extract(NEW.body_json,'$.inventoryId') IS NEW.inventory_id)) AND ((json_extract(NEW.body_json,'$.stage.stageId') IS NEW.stage_id AND json_extract(NEW.body_json,'$.stageIndex') IS NEW.ordinal) AND (json_extract(NEW.body_json,'$.command.operationId') IS NEW.command_operation_id AND json_extract(NEW.body_json,'$.stageProofDigest') IS NEW.source_proof_digest))));
END;
CREATE TRIGGER app_collection_legacy_mint_anchors_body_projection BEFORE INSERT ON app_collection_legacy_mint_anchors BEGIN
 SELECT RAISE(ABORT,'Retained adoption projection differs from committed body') WHERE NOT EXISTS(SELECT 1 WHERE ((((json_extract(NEW.body_json,'$.format') IS 'legacy-adoption-mint-anchor-v1' AND json_extract(NEW.body_json,'$.adoptionId') IS NEW.adoption_id) AND (json_extract(NEW.body_json,'$.inventoryId') IS NEW.inventory_id AND json_extract(NEW.body_json,'$.ordinal') IS NEW.ordinal)) AND ((json_extract(NEW.body_json,'$.operation.id') IS NEW.operation_id AND json_extract(NEW.body_json,'$.operation.stageId') IS NEW.stage_id) AND (json_extract(NEW.body_json,'$.operation.wallet') IS NEW.wallet AND json_extract(NEW.body_json,'$.operation.requestKey') IS NEW.request_key))) AND (((json_extract(NEW.body_json,'$.operation.commitment') IS NEW.commitment AND json_extract(NEW.body_json,'$.operation.admittedAtMs') IS NEW.admitted_ms) AND (json_extract(NEW.body_json,'$.operation.settledAtMs') IS NEW.settled_ms AND json_extract(NEW.body_json,'$.economics.termsDigest') IS NEW.terms_digest)) AND ((json_extract(NEW.body_json,'$.economics.priceLamports') IS NEW.price_lamports AND json_extract(NEW.body_json,'$.economics.costLamports') IS NEW.cost_lamports) AND (json_extract(NEW.body_json,'$.originalOutcome.assetId') IS NEW.asset_id AND (json_extract(NEW.body_json,'$.phaseProofs.advance.proofDigest') IS NEW.source_proof_digest AND json_extract(NEW.body_json,'$.current.sourceDigest') IS NEW.current_source_digest))))));
END;
CREATE TRIGGER app_collection_legacy_adoption_objects_body_projection BEFORE INSERT ON app_collection_legacy_adoption_objects BEGIN
 SELECT RAISE(ABORT,'Retained adoption projection differs from committed body') WHERE NOT EXISTS(SELECT 1 WHERE ((((json_extract(NEW.body_json,'$.format') IS 'legacy-adoption-object-proof-v1' AND json_extract(NEW.body_json,'$.adoptionId') IS NEW.adoption_id) AND (json_extract(NEW.body_json,'$.identity.key') IS NEW.object_key AND json_extract(NEW.body_json,'$.identity') IS NEW.identity_json)) AND ((json_type(NEW.identity_json,'$.size') IS 'integer' AND json_extract(NEW.identity_json,'$.size') BETWEEN 1 AND 147456) AND (json_extract(NEW.identity_json,'$.key') IS 'private/'||json_extract(NEW.identity_json,'$.byteDigest')||'.json' AND json_extract(NEW.identity_json,'$.visibility') IS 'private'))) AND (((json_extract(NEW.identity_json,'$.contentType') IS 'application/json' AND json_type(NEW.body_json,'$.descriptorChildren') IS 'array') AND (json_array_length(NEW.body_json,'$.descriptorChildren')<=13 AND json_type(NEW.identity_json,'$.byteDigest') IS 'text')) AND ((length(json_extract(NEW.identity_json,'$.byteDigest'))=64 AND json_extract(NEW.identity_json,'$.byteDigest') NOT GLOB '*[^0-9a-f]*') AND ((json_type(NEW.identity_json,'$.semanticDigest') IS 'null' OR (json_type(NEW.identity_json,'$.semanticDigest') IS 'text' AND length(json_extract(NEW.identity_json,'$.semanticDigest'))=64 AND json_extract(NEW.identity_json,'$.semanticDigest') NOT GLOB '*[^0-9a-f]*')) AND (SELECT COUNT(*) FROM json_each(NEW.identity_json))=6)))));
END;
CREATE TRIGGER legacy_adoption_result_projection BEFORE INSERT ON app_collection_legacy_adoptions BEGIN
 SELECT RAISE(ABORT,'Retained adoption projection differs from committed body') WHERE NOT EXISTS(SELECT 1 WHERE (((((json_extract(NEW.economic_result_json,'$.inventoryId') IS NEW.inventory_id AND json_extract(NEW.economic_result_json,'$.rootId') IS NEW.root_id) AND (json_extract(NEW.economic_result_json,'$.admitted') IS NEW.admitted AND json_extract(NEW.economic_result_json,'$.fulfilled') IS NEW.fulfilled)) AND ((json_extract(NEW.economic_result_json,'$.remaining') IS NEW.remaining_json AND json_extract(NEW.economic_result_json,'$.kind') IS 'verified') AND (json_extract(NEW.economic_result_json,'$.verification') IS 'historical-admission-economics' AND json_extract(NEW.economic_result_json,'$.historicalEconomics') IS 1))) AND (((json_extract(NEW.economic_result_json,'$.originalOperatorAuthentication') IS 0 AND json_extract(NEW.economic_result_json,'$.paymentVerified') IS 0) AND (json_extract(NEW.economic_result_json,'$.adoptionAuthorized') IS 0 AND json_extract(NEW.economic_result_json,'$.executable') IS 0)) AND ((json_extract(NEW.economic_result_json,'$.counts.pending') IS 0 AND json_extract(NEW.preparation_result_json,'$.adoptionId') IS NEW.id) AND (json_extract(NEW.preparation_result_json,'$.economicAuditId') IS NEW.economic_audit_id AND json_extract(NEW.preparation_result_json,'$.inventoryId') IS NEW.inventory_id)))) AND ((((json_extract(NEW.preparation_result_json,'$.rootId') IS NEW.root_id AND json_extract(NEW.preparation_result_json,'$.parentDigest') IS NEW.parent_digest) AND (json_extract(NEW.preparation_result_json,'$.preparationDigest') IS NEW.preparation_digest AND json_extract(NEW.preparation_result_json,'$.stageCount') IS NEW.stage_count)) AND ((json_extract(NEW.preparation_result_json,'$.admissionCount') IS NEW.admitted AND json_extract(NEW.preparation_result_json,'$.format') IS 'legacy-adoption-prepared-v1') AND (json_extract(NEW.preparation_result_json,'$.preparedOnly') IS 1 AND json_extract(NEW.preparation_result_json,'$.adoptionAuthorized') IS 0))) AND (((json_extract(NEW.preparation_result_json,'$.executable') IS 0 AND json_type(NEW.remaining_json) IS 'array') AND (json_array_length(NEW.remaining_json)=10 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.remaining_json) r WHERE r.type<>'integer' OR r.value<0 OR r.value>json_extract('[489,256,128,64,32,16,8,4,2,1]','$['||r.key||']')))) AND (((SELECT SUM(value) FROM json_each(NEW.remaining_json))+NEW.fulfilled=1000 AND json_type(NEW.preparation_result_json,'$.objectCount') IS 'integer') AND (json_extract(NEW.preparation_result_json,'$.objectCount') BETWEEN 0 AND 2048 AND (json_type(NEW.preparation_result_json,'$.objectBytes') IS 'integer' AND json_extract(NEW.preparation_result_json,'$.objectBytes') BETWEEN 0 AND 16777216)))))));
END;
CREATE TRIGGER legacy_anchor_disjoint_insert BEFORE INSERT ON app_collection_legacy_mint_anchors BEGIN
 SELECT RAISE(ABORT,'Historical and normalized mint identities overlap') WHERE EXISTS(SELECT 1 FROM app_collection_mint_admissions m JOIN collect_operations o ON o.id=m.operation_id WHERE m.operation_id=NEW.operation_id OR m.commitment=NEW.commitment OR (m.inventory_id=NEW.inventory_id AND m.ordinal=NEW.ordinal) OR (o.owner=NEW.wallet AND o.request_key=NEW.request_key));
END;
CREATE TRIGGER normalized_mint_legacy_disjoint_insert BEFORE INSERT ON app_collection_mint_admissions BEGIN
 SELECT RAISE(ABORT,'Historical and normalized mint identities overlap') WHERE EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors h WHERE h.operation_id=NEW.operation_id OR h.commitment=NEW.commitment OR (h.inventory_id=NEW.inventory_id AND h.ordinal=NEW.ordinal) OR (h.wallet=NEW.wallet AND h.request_key=(SELECT request_key FROM collect_operations WHERE id=NEW.operation_id)));
END;
CREATE TRIGGER adopted_mint_request_update BEFORE UPDATE ON fair_requests WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.operation_id OR operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint request is immutable'); END;
CREATE TRIGGER adopted_mint_request_delete BEFORE DELETE ON fair_requests WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.operation_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint request is immutable'); END;
CREATE TRIGGER adopted_mint_policy_insert BEFORE INSERT ON fair_inventories WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER adopted_mint_policy_update BEFORE UPDATE ON fair_inventories WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE inventory_id=OLD.inventory_id OR inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER adopted_mint_policy_delete BEFORE DELETE ON fair_inventories WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE inventory_id=OLD.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER adopted_mint_assets_insert BEFORE INSERT ON fair_reserved_assets WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER adopted_mint_assets_update BEFORE UPDATE ON fair_reserved_assets WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE inventory_id=OLD.inventory_id OR inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER adopted_mint_assets_delete BEFORE DELETE ON fair_reserved_assets WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE inventory_id=OLD.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER adopted_minted_fair_results_no_update BEFORE UPDATE ON fair_results WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.operation_id OR operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_fair_results_no_delete BEFORE DELETE ON fair_results WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.operation_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_collect_level_history_no_update BEFORE UPDATE ON collect_level_history WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.source_ref OR operation_id=NEW.source_ref) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_collect_level_history_no_delete BEFORE DELETE ON collect_level_history WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.source_ref) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_vault_observations_no_update BEFORE UPDATE ON vault_observations WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE 'collect:'||operation_id=OLD.event_id OR 'collect:'||operation_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_vault_observations_no_delete BEFORE DELETE ON vault_observations WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE 'collect:'||operation_id=OLD.event_id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_collect_assets_no_update BEFORE UPDATE ON collect_assets WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE asset_id=OLD.id OR asset_id=NEW.id) AND (NEW.id IS NOT OLD.id OR NEW.inventory_id IS NOT OLD.inventory_id OR NEW.bind_ms IS NOT OLD.bind_ms OR NEW.slot IS NOT OLD.slot) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_collect_assets_no_delete BEFORE DELETE ON collect_assets WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE asset_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_vault_assets_no_update BEFORE UPDATE ON vault_assets WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE asset_id=OLD.id OR asset_id=NEW.id) AND (NEW.id IS NOT OLD.id OR NEW.slot_key IS NOT OLD.slot_key OR NEW.coords IS NOT OLD.coords) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_vault_assets_no_delete BEFORE DELETE ON vault_assets WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE asset_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_minted_collect_level_history_no_insert BEFORE INSERT ON collect_level_history WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=NEW.source_ref) AND NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE status='restoring' AND write_nonce IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Retain immutable mint binding'); END;
CREATE TRIGGER adopted_original_operation_no_update BEFORE UPDATE ON collect_operations WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.id OR operation_id=NEW.id) BEGIN SELECT RAISE(ABORT,'Retain original adopted mint operation'); END;
CREATE TRIGGER adopted_original_operation_no_delete BEFORE DELETE ON collect_operations WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Retain original adopted mint operation'); END;
CREATE TRIGGER adopted_historical_snapshot_no_update BEFORE UPDATE ON collect_snapshots WHEN EXISTS(SELECT 1 FROM app_collection_legacy_stage_imports WHERE (inventory_id=OLD.inventory_id AND stage_id=OLD.stage_id) OR (inventory_id=NEW.inventory_id AND stage_id=NEW.stage_id)) BEGIN SELECT RAISE(ABORT,'Retain adopted historical eligibility snapshot'); END;
CREATE TRIGGER adopted_historical_snapshot_no_delete BEFORE DELETE ON collect_snapshots WHEN EXISTS(SELECT 1 FROM app_collection_legacy_stage_imports WHERE inventory_id=OLD.inventory_id AND stage_id=OLD.stage_id) BEGIN SELECT RAISE(ABORT,'Retain adopted historical eligibility snapshot'); END;
CREATE TRIGGER adopted_fair_requests_no_insert BEFORE INSERT ON fair_requests WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=NEW.operation_id) AND NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Retain original adopted mint fairness profile'); END;
CREATE TRIGGER adopted_fair_results_no_insert BEFORE INSERT ON fair_results WHEN EXISTS(SELECT 1 FROM app_collection_legacy_mint_anchors WHERE operation_id=NEW.operation_id) AND NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Retain original adopted mint fairness profile'); END;
CREATE TRIGGER adopted_historical_snapshot_no_insert BEFORE INSERT ON collect_snapshots WHEN EXISTS(SELECT 1 FROM app_collection_legacy_stage_imports WHERE inventory_id=NEW.inventory_id AND stage_id=NEW.stage_id) AND NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='private' AND status='restoring' AND write_nonce IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Retain original adopted historical eligibility profile'); END;
CREATE TRIGGER legacy_stage_import_mandatory BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' AND NEW.operation_kind='collection.adopt-legacy-stage.v1' BEGIN
 SELECT RAISE(ABORT,'Missing exact legacy adoption command effect') WHERE NOT EXISTS(SELECT 1 FROM app_collection_legacy_stage_imports i JOIN app_collection_legacy_adoptions a ON a.id=i.adoption_id JOIN app_command_receipts p ON p.operation_id=a.activation_command_id JOIN app_collection_stages s ON s.inventory_id=i.inventory_id AND s.stage_id=i.stage_id WHERE (((((i.command_operation_id=NEW.operation_id AND p.state='staging') AND (p.operation_kind='collection.adopt-legacy-source.v1' AND p.principal_key=NEW.principal_key)) AND ((p.created_ms=NEW.created_ms AND p.expected_revisions=NEW.expected_revisions) AND (s.command_operation_id=NEW.operation_id AND s.inventory_id=i.inventory_id))) AND (((s.stage_id=i.stage_id AND s.published_ms<=NEW.created_ms) AND (NEW.operation_id IS json_extract(i.body_json,'$.command.operationId') AND NEW.claim_nonce IS json_extract(i.body_json,'$.command.claimNonce'))) AND ((NEW.request_key IS json_extract(i.body_json,'$.command.requestKey') AND NEW.request_digest IS json_extract(i.body_json,'$.command.requestDigest')) AND (NEW.business_key IS json_extract(i.body_json,'$.command.businessIdentity') AND NEW.input_json IS json_extract(i.body_json,'$.command.input'))))) AND ((((NEW.result_json IS json_extract(i.body_json,'$.command.result') AND NEW.output_digest IS json_extract(i.body_json,'$.command.outputDigest')) AND (NEW.result_ref IS json_extract(i.body_json,'$.command.resultRef') AND s.inventory_id IS json_extract(i.body_json,'$.stage.inventoryId'))) AND ((s.stage_id IS json_extract(i.body_json,'$.stage.stageId') AND s.ordinal IS json_extract(i.body_json,'$.stage.ordinal')) AND (s.stage_type IS json_extract(i.body_json,'$.stage.stageType') AND s.published_ms IS json_extract(i.body_json,'$.stage.publishedMs')))) AND (((s.opens_ms IS json_extract(i.body_json,'$.stage.opensMs') AND s.closes_ms IS json_extract(i.body_json,'$.stage.closesMs')) AND (s.terms_digest IS json_extract(i.body_json,'$.stage.termsDigest') AND s.terms_json IS json_extract(i.body_json,'$.stage.termsJson'))) AND ((s.eligibility_kind IS json_extract(i.body_json,'$.stage.eligibilityKind') AND s.list_id IS json_extract(i.body_json,'$.stage.listId')) AND (s.eligible_count IS json_extract(i.body_json,'$.stage.eligibleCount') AND s.command_operation_id IS json_extract(i.body_json,'$.stage.commandOperationId')))))));
END;
CREATE TRIGGER legacy_adoption_mandatory BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' AND NEW.operation_kind='collection.adopt-legacy-source.v1' BEGIN
 SELECT RAISE(ABORT,'Missing exact legacy adoption command effect') WHERE NOT EXISTS(SELECT 1 FROM app_collection_legacy_adoptions a JOIN app_collection_authorities h ON h.inventory_id=a.inventory_id WHERE (((((a.activation_command_id=NEW.operation_id AND (NEW.principal_key='operator:'||a.operator AND NEW.created_ms=a.created_ms)) AND (NEW.business_key=a.inventory_id AND (NEW.result_ref=a.inventory_id AND h.inventory_id=a.inventory_id))) AND ((h.origin_kind='verified-source-import' AND (h.activation_command_id=NEW.operation_id AND h.initial_state_digest=a.raw_digest)) AND ((h.initial_revision=a.source_revision AND h.revision=0) AND (h.admitted=a.admitted AND h.fulfilled=a.fulfilled)))) AND (((h.remaining_json=a.remaining_json AND (json_extract(NEW.input_json,'$.adoptionId') IS a.id AND json_extract(NEW.input_json,'$.economicAuditId') IS a.economic_audit_id)) AND ((json_extract(NEW.input_json,'$.inventoryId') IS a.inventory_id AND json_extract(NEW.input_json,'$.rootId') IS a.root_id) AND (json_extract(NEW.input_json,'$.parentDigest') IS a.parent_digest AND json_extract(NEW.input_json,'$.preparationDigest') IS a.preparation_digest))) AND ((json_extract(NEW.input_json,'$.preparationResultDigest') IS a.preparation_result_digest AND (json_extract(NEW.input_json,'$.economicResultDigest') IS a.economic_result_digest AND json_extract(NEW.input_json,'$.source.generation') IS a.source_generation)) AND ((json_extract(NEW.input_json,'$.source.watermark') IS a.source_watermark AND json_extract(NEW.input_json,'$.source.schemaFingerprint') IS a.schema_fingerprint) AND (json_extract(NEW.input_json,'$.source.rawDigest') IS a.raw_digest AND json_extract(NEW.input_json,'$.source.canonicalDigest') IS a.canonical_digest))))) AND ((((json_extract(NEW.input_json,'$.source.revision') IS CAST(a.source_revision AS TEXT) AND ((SELECT COUNT(*) FROM json_each(NEW.input_json))=9 AND (SELECT COUNT(*) FROM json_each(NEW.input_json,'$.source'))=6)) AND ((json_extract(NEW.result_json,'$.adoptionId') IS a.id AND json_extract(NEW.result_json,'$.inventoryId') IS a.inventory_id) AND (json_extract(NEW.result_json,'$.rootId') IS a.root_id AND json_extract(NEW.result_json,'$.stageCount') IS a.stage_count))) AND ((json_extract(NEW.result_json,'$.admitted') IS a.admitted AND (json_extract(NEW.result_json,'$.fulfilled') IS a.fulfilled AND json_extract(NEW.result_json,'$.remaining') IS a.remaining_json)) AND ((json_extract(NEW.result_json,'$.authorityRevision') IS 0 AND json_extract(NEW.result_json,'$.imported') IS 1) AND (json_extract(NEW.result_json,'$.historicalEconomics') IS 1 AND json_extract(NEW.result_json,'$.originalOperatorAuthentication') IS 0)))) AND (((json_extract(NEW.result_json,'$.paymentVerified') IS 0 AND (json_extract(NEW.result_json,'$.source') IS 'local-fixture' AND json_extract(NEW.result_json,'$.executable') IS 0)) AND ((json_type(NEW.result_json,'$.certificateDigest') IS 'text' AND length(json_extract(NEW.result_json,'$.certificateDigest'))=64) AND (json_extract(NEW.result_json,'$.certificateDigest') NOT GLOB '*[^0-9a-f]*' AND (SELECT COUNT(*) FROM json_each(NEW.result_json))=15))) AND (((SELECT COUNT(*) FROM app_collection_stages WHERE inventory_id=a.inventory_id)=a.stage_count AND ((SELECT COUNT(*) FROM app_collection_legacy_stage_imports WHERE adoption_id=a.id)=a.stage_count AND NOT EXISTS(SELECT 1 FROM app_collection_legacy_stage_imports i LEFT JOIN app_command_receipts c ON c.operation_id=i.command_operation_id WHERE i.adoption_id=a.id AND (c.operation_id IS NULL OR c.state<>'committed' OR c.operation_kind<>'collection.adopt-legacy-stage.v1')))) AND (((SELECT COUNT(*) FROM app_collection_legacy_mint_anchors WHERE adoption_id=a.id)=a.admitted AND NOT EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE inventory_id=a.inventory_id)) AND ((SELECT COUNT(*) FROM app_collection_legacy_adoption_objects WHERE adoption_id=a.id)=json_extract(a.preparation_result_json,'$.objectCount') AND (SELECT COALESCE(SUM(json_extract(identity_json,'$.size')),0) FROM app_collection_legacy_adoption_objects WHERE adoption_id=a.id)=json_extract(a.preparation_result_json,'$.objectBytes'))))))));
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
  'earn.seal-input.v1','earn.commit-board.v1','earn.commit-allocation.v1','evidence.register-source.v1','evidence.record-receipt.v1','earn.freeze-epoch.v1','earn.snapshot-attempt.v1','earn.accept-action.v1','artifacts.plan-publication.v1','artifacts.publish-publication.v1','artifacts.hold-publication.v1','quotes.bind-source.v1','quotes.record-input.v1','collection.stage-record.v1','collection.seal-list.v1','collection.seal-source.v1','governance.cast-vote.v1','collection.issue-quote.v1','collection.materialize-eligibility-page.v1','governance.publish-ballot.v1','governance.record-decision.v1','collection.reserve-operation.v1','collection.observe-asset.v1','collection.fulfill-operation.v1','collection.publish-stage.v1','collection.stage-cut-record.v1','collection.begin-free-cut.v1','collection.validate-cut-page.v1','collection.seal-free-cut.v1','collection.adopt-legacy-source.v1','collection.adopt-legacy-stage.v1');
END;
-- TODO exact parent-claim freshness integration, active/mixed counters and full actualD1/restore acceptance.
