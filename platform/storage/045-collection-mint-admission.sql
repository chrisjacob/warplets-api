-- Private normalized mint admission; fulfillment is a later guarded migration.
CREATE TABLE app_collection_mint_admissions (
 operation_id TEXT PRIMARY KEY REFERENCES collect_operations(id),command_operation_id TEXT NOT NULL UNIQUE REFERENCES app_command_receipts(operation_id),
 inventory_id TEXT NOT NULL REFERENCES app_collection_authorities(inventory_id),stage_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 999),wallet TEXT NOT NULL CHECK(length(wallet) BETWEEN 32 AND 44),
 commitment TEXT NOT NULL UNIQUE,admitted_ms INTEGER NOT NULL CHECK(admitted_ms>=0),
 terms_digest TEXT NOT NULL CHECK(length(terms_digest)=64 AND terms_digest NOT GLOB '*[^a-f0-9]*'),
 price_lamports TEXT NOT NULL CHECK((price_lamports='0' OR (length(price_lamports) BETWEEN 1 AND 20 AND substr(price_lamports,1,1) BETWEEN '1' AND '9' AND price_lamports NOT GLOB '*[^0-9]*')) AND (length(price_lamports)<20 OR price_lamports<='18446744073709551615')),
 cost_lamports TEXT NOT NULL CHECK((cost_lamports='0' OR (length(cost_lamports) BETWEEN 1 AND 20 AND substr(cost_lamports,1,1) BETWEEN '1' AND '9' AND cost_lamports NOT GLOB '*[^0-9]*')) AND (length(cost_lamports)<20 OR cost_lamports<='18446744073709551615')),
 membership_source_id TEXT REFERENCES app_collection_list_seals(id),
 fair_policy_hash TEXT,fair_registered_ms INTEGER,target_round INTEGER,context_digest TEXT,
 effect_json TEXT NOT NULL CHECK(json_valid(effect_json) AND length(CAST(effect_json AS BLOB))<=16384),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(CAST(result_json AS BLOB))<=16384),
 UNIQUE(inventory_id,ordinal),FOREIGN KEY(inventory_id,stage_id) REFERENCES app_collection_stages(inventory_id,stage_id),
 CHECK((fair_policy_hash IS NULL AND fair_registered_ms IS NULL AND target_round IS NULL AND context_digest IS NULL)
  OR (fair_policy_hash IS NOT NULL AND length(fair_policy_hash)=64 AND fair_policy_hash NOT GLOB '*[^a-f0-9]*' AND fair_registered_ms IS NOT NULL AND fair_registered_ms<=admitted_ms AND target_round IS NOT NULL AND target_round>0 AND context_digest IS NOT NULL AND length(context_digest)=64 AND context_digest NOT GLOB '*[^a-f0-9]*'))
) STRICT;
CREATE INDEX collection_mint_stage_wallet ON app_collection_mint_admissions(inventory_id,stage_id,wallet);
CREATE INDEX collection_mint_stage_ordinal ON app_collection_mint_admissions(inventory_id,stage_id,ordinal);
CREATE TRIGGER app_collection_mint_admissions_no_update BEFORE UPDATE ON app_collection_mint_admissions BEGIN SELECT RAISE(ABORT,'Accepted normalized mint admission is immutable'); END;
CREATE TRIGGER app_collection_mint_admissions_no_delete BEFORE DELETE ON app_collection_mint_admissions BEGIN SELECT RAISE(ABORT,'Retain normalized mint admission'); END;
CREATE TRIGGER recovery_guard_app_collection_mint_admissions_insert BEFORE INSERT ON app_collection_mint_admissions WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER mint_source_app_collection_mint_admissions_insert AFTER INSERT ON app_collection_mint_admissions BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_mint_admissions_insert AFTER INSERT ON app_collection_mint_admissions BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_mint_admissions_update BEFORE UPDATE ON app_collection_mint_admissions WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER mint_source_app_collection_mint_admissions_update AFTER UPDATE ON app_collection_mint_admissions BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_mint_admissions_update AFTER UPDATE ON app_collection_mint_admissions BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER recovery_guard_app_collection_mint_admissions_delete BEFORE DELETE ON app_collection_mint_admissions WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL) BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER mint_source_app_collection_mint_admissions_delete AFTER DELETE ON app_collection_mint_admissions BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER recovery_watermark_app_collection_mint_admissions_delete AFTER DELETE ON app_collection_mint_admissions BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER guarded_mint_operation_identity BEFORE UPDATE OF id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms,operation ON collect_operations
 WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE operation_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'Accepted normalized mint identity is immutable'); END;
CREATE TRIGGER guarded_mint_settlement_pending BEFORE UPDATE OF settled_ms,proof_id,evidence_digest,receipt ON collect_operations
 WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE operation_id=OLD.id)
 AND (NEW.settled_ms IS NOT OLD.settled_ms OR NEW.proof_id IS NOT OLD.proof_id OR NEW.evidence_digest IS NOT OLD.evidence_digest OR NEW.receipt IS NOT OLD.receipt)
 BEGIN SELECT RAISE(ABORT,'Guarded normalized mint fulfillment required'); END;
CREATE TRIGGER guarded_mint_request_update BEFORE UPDATE ON fair_requests WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE operation_id=OLD.operation_id OR operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint request is immutable'); END;
CREATE TRIGGER guarded_mint_request_delete BEFORE DELETE ON fair_requests WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE operation_id=OLD.operation_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint request is immutable'); END;
CREATE TRIGGER guarded_mint_policy_insert BEFORE INSERT ON fair_inventories WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER guarded_mint_policy_update BEFORE UPDATE ON fair_inventories WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE inventory_id=OLD.inventory_id OR inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER guarded_mint_policy_delete BEFORE DELETE ON fair_inventories WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE inventory_id=OLD.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER guarded_mint_assets_insert BEFORE INSERT ON fair_reserved_assets WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER guarded_mint_assets_update BEFORE UPDATE ON fair_reserved_assets WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE inventory_id=OLD.inventory_id OR inventory_id=NEW.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;
CREATE TRIGGER guarded_mint_assets_delete BEFORE DELETE ON fair_reserved_assets WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE inventory_id=OLD.inventory_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint fairness is immutable'); END;

DROP TRIGGER app_collection_reservation_mandatory_effect;
CREATE TRIGGER app_collection_reservation_mandatory_effect BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' AND NEW.operation_kind='collection.reserve-operation.v1' AND COALESCE(json_extract(NEW.input_json,'$.kind'),'')<>'mint' BEGIN
 SELECT RAISE(ABORT,'Missing atomic quote-bound progression reservation') WHERE NOT EXISTS(
  SELECT 1 FROM app_collection_reservations r JOIN collect_operations op ON op.id=r.operation_id
  JOIN app_collection_quotes q ON q.id=r.quote_id JOIN collect_assets target ON target.id=r.target_id
  WHERE (
    r.command_operation_id=NEW.operation_id
    AND r.operation_id=NEW.result_ref
    AND r.result_json=NEW.result_json
    AND r.operation_id=json_extract(NEW.result_json,'$.operationId')
    AND op.owner=json_extract(NEW.result_json,'$.wallet')
    AND NEW.principal_key='wallet:'||op.owner
   )
   AND (
    op.owner=q.wallet
    AND op.request_key=NEW.request_key
    AND op.request_digest=NEW.request_digest
    AND op.created_ms=NEW.created_ms
    AND op.created_ms=json_extract(NEW.result_json,'$.createdMs')
    AND op.kind=q.kind
   )
   AND (
    op.kind=json_extract(NEW.input_json,'$.kind')
    AND op.kind=json_extract(NEW.result_json,'$.kind')
    AND op.inventory_id=q.inventory_id
    AND op.inventory_id=json_extract(NEW.input_json,'$.inventoryId')
    AND op.inventory_id=json_extract(NEW.result_json,'$.inventoryId')
    AND op.settled_ms IS NULL
   )
   AND (
    op.proof_id IS NULL
    AND op.evidence_digest IS NULL
    AND op.receipt IS NULL
    AND r.quote_id=json_extract(NEW.input_json,'$.quoteId')
    AND r.quote_id=json_extract(NEW.result_json,'$.quoteId')
    AND r.quote_binding_digest=q.binding_digest
   )
   AND (
    r.quote_binding_digest=json_extract(NEW.input_json,'$.bindingDigest')
    AND r.quote_binding_digest=json_extract(NEW.result_json,'$.bindingDigest')
    AND q.policy_version=json_extract(NEW.input_json,'$.policyVersion')
    AND q.expires_ms=json_extract(NEW.input_json,'$.quoteExpiresMs')
    AND q.as_of_ms<=NEW.created_ms
    AND NEW.created_ms<q.expires_ms
   )
   AND (
    q.fee_lamports=json_extract(NEW.input_json,'$.reviewedFeeLamports')
    AND q.fee_lamports=json_extract(NEW.result_json,'$.feeLamports')
    AND q.max_total_lamports=json_extract(NEW.input_json,'$.reviewedMaxTotalLamports')
    AND q.max_total_lamports=json_extract(NEW.result_json,'$.maxTotalLamports')
    AND q.target_id=r.target_id
    AND r.target_id=json_extract(NEW.input_json,'$.targetId')
   )
   AND (
    r.target_id=json_extract(NEW.result_json,'$.targetId')
    AND q.material_id IS r.material_id
    AND r.material_id IS json_extract(NEW.input_json,'$.materialId')
    AND r.material_id IS json_extract(NEW.result_json,'$.materialId')
    AND q.target_version=json_extract(NEW.input_json,'$.expectedTargetVersion')
    AND q.material_version IS json_extract(NEW.input_json,'$.expectedMaterialVersion')
   )
   AND (
    op.operation=r.operation_json
    AND json_extract(op.operation,'$.operationId')=op.id
    AND json_extract(op.operation,'$.commitment')=op.commitment
    AND json_extract(op.operation,'$.kind')=op.kind
    AND json_extract(op.operation,'$.signer')=op.owner
    AND json_extract(op.operation,'$.preparedAt')=op.created_ms
   )
   AND (
    json_extract(op.operation,'$.targetId')=r.target_id
    AND json_extract(op.operation,'$.materialId') IS r.material_id
    AND json_extract(op.operation,'$.expectedTargetVersion')=q.target_version
    AND json_extract(op.operation,'$.expectedMaterialVersion') IS q.material_version
    AND json_extract(op.operation,'$.feeLamports."$lamports"')=q.fee_lamports
    AND json_type(op.operation,'$.result')='null'
   )
   AND (
    target.inventory_id=op.inventory_id
    AND target.owner=op.owner
    AND target.observed_ms=op.created_ms
    AND target.asset=r.target_after_json
    AND json_extract(target.asset,'$.id')=target.id
    AND json_extract(target.asset,'$.owner')=op.owner
   )
   AND (
    json_extract(target.asset,'$.pending')=op.id
    AND json_extract(target.asset,'$.version')=q.target_version+1
    AND ((op.kind='visual' AND r.material_id IS NULL AND r.material_after_json IS NULL)
    OR (op.kind='upgrade' AND r.material_id IS NOT NULL AND EXISTS(
     SELECT 1 FROM collect_assets material WHERE material.id=r.material_id AND material.inventory_id=op.inventory_id AND material.owner=op.owner
      AND material.observed_ms=op.created_ms AND material.asset=r.material_after_json AND json_extract(material.asset,'$.id')=material.id
      AND json_extract(material.asset,'$.owner')=op.owner AND json_extract(material.asset,'$.pending')=op.id AND json_extract(material.asset,'$.version')=q.material_version+1
    )))
    AND json_extract(NEW.result_json,'$.status')='awaiting-evidence'
    AND json_extract(NEW.result_json,'$.source')='local-fixture'
    AND json_extract(NEW.result_json,'$.executable')=0
   )
   AND (
    ((r.fair_policy_hash IS NULL AND json_extract(NEW.result_json,'$.fairness')='manual-fixture'
     AND NOT EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=op.inventory_id) AND NOT EXISTS(SELECT 1 FROM fair_requests WHERE operation_id=op.id))
    OR (r.fair_policy_hash IS NOT NULL AND json_extract(NEW.result_json,'$.fairness')='configured-offline-beacon'
     AND EXISTS(SELECT 1 FROM fair_inventories p JOIN fair_requests f ON f.operation_id=op.id WHERE p.inventory_id=op.inventory_id
      AND p.policy_hash=r.fair_policy_hash AND p.registered_ms=r.fair_registered_ms AND p.registered_ms<=op.created_ms
      AND f.target_round=r.target_round AND f.context_digest=r.context_digest)))
   )
 );
END;

CREATE TRIGGER app_collection_mint_admission_mandatory_effect BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' AND NEW.operation_kind='collection.reserve-operation.v1' AND json_extract(NEW.input_json,'$.kind')='mint' BEGIN
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (r.command_operation_id=NEW.operation_id)
 AND (r.operation_id=NEW.result_ref)
 AND (r.result_json=NEW.result_json)
 AND (r.operation_id=json_extract(NEW.result_json,'$.operationId'))
 AND (r.inventory_id=json_extract(NEW.input_json,'$.inventoryId'))
 AND (r.inventory_id=json_extract(NEW.result_json,'$.inventoryId'))
 AND (r.stage_id=json_extract(NEW.input_json,'$.stageId')));
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (r.stage_id=json_extract(NEW.result_json,'$.stageId'))
 AND (r.terms_digest=json_extract(NEW.input_json,'$.expectedTermsDigest'))
 AND (r.terms_digest=json_extract(NEW.result_json,'$.termsDigest'))
 AND (r.terms_digest=s.terms_digest)
 AND (json_extract(NEW.result_json,'$.kind')='mint')
 AND (json_extract(NEW.result_json,'$.status')='awaiting-evidence')
 AND (json_extract(NEW.result_json,'$.source')='local-fixture'));
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (json_extract(NEW.result_json,'$.executable')=0)
 AND (r.wallet=json_extract(NEW.result_json,'$.wallet'))
 AND (r.admitted_ms=NEW.created_ms)
 AND (r.admitted_ms=json_extract(NEW.result_json,'$.createdMs'))
 AND (r.price_lamports=json_extract(NEW.result_json,'$.priceLamports'))
 AND (r.cost_lamports=json_extract(NEW.result_json,'$.costLamports'))
 AND (op.kind='mint'));
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (op.inventory_id=r.inventory_id)
 AND (op.owner=r.wallet)
 AND (op.request_key=NEW.request_key)
 AND (op.request_digest=NEW.request_digest)
 AND (op.commitment=r.commitment)
 AND (op.created_ms=r.admitted_ms)
 AND (op.settled_ms IS NULL AND op.proof_id IS NULL AND op.evidence_digest IS NULL AND op.receipt IS NULL));
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (op.operation=json_extract(r.effect_json,'$.operationJson'))
 AND (json_extract(op.operation,'$.stageId')=r.stage_id)
 AND (json_extract(op.operation,'$.priceLamports."$lamports"')=r.price_lamports)
 AND (json_extract(op.operation,'$.costLamports."$lamports"')=r.cost_lamports)
 AND (r.price_lamports=json_extract(s.terms_json,'$.priceLamports."$lamports"'))
 AND (r.cost_lamports=json_extract(s.terms_json,'$.costLamports."$lamports"'))
 AND (s.opens_ms<=r.admitted_ms AND r.admitted_ms<s.closes_ms));
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (s.stage_type IN ('whitelist','public','founder'))
 AND (h.kind<>'season' OR h.season_start<=r.admitted_ms)
 AND (r.ordinal=json_extract(r.effect_json,'$.authorityBefore.admitted'))
 AND (a.admitted=r.ordinal+1)
 AND (a.admitted=json_extract(r.effect_json,'$.authorityAfter.admitted'))
 AND (a.revision=json_extract(r.effect_json,'$.authorityAfter.revision'))
 AND (a.revision=json_extract(r.effect_json,'$.authorityBefore.revision')+1));
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (a.fulfilled=json_extract(r.effect_json,'$.authorityBefore.fulfilled'))
 AND (a.fulfilled=json_extract(r.effect_json,'$.authorityAfter.fulfilled'))
 AND (a.remaining_json=json_extract(r.effect_json,'$.authorityBefore.remainingJson'))
 AND (a.remaining_json=json_extract(r.effect_json,'$.authorityAfter.remainingJson'))
 AND (a.admitted=(SELECT COUNT(*) FROM app_collection_mint_admissions c WHERE c.inventory_id=r.inventory_id))
 AND ((SELECT COUNT(*) FROM app_collection_mint_admissions c WHERE c.inventory_id=r.inventory_id AND c.stage_id=r.stage_id)<=json_extract(s.terms_json,'$.allocation'))
 AND ((SELECT COUNT(*) FROM app_collection_mint_admissions c WHERE c.inventory_id=r.inventory_id AND c.stage_id=r.stage_id AND c.wallet=r.wallet)<=json_extract(s.terms_json,'$.walletLimit')));
 SELECT RAISE(ABORT,'Missing atomic normalized mint admission') WHERE NOT EXISTS(
 SELECT 1 FROM app_collection_mint_admissions r JOIN app_collection_authorities a ON a.inventory_id=r.inventory_id
 JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id
 JOIN collect_operations op ON op.id=r.operation_id JOIN collect_inventories h ON h.id=r.inventory_id
 WHERE r.command_operation_id=NEW.operation_id
 AND (((NEW.principal_key='wallet:'||r.wallet AND s.stage_type<>'founder' AND json_type(NEW.input_json,'$.wallet') IS NULL) OR (substr(NEW.principal_key,1,9)='operator:' AND s.stage_type='founder' AND r.wallet=json_extract(NEW.input_json,'$.wallet') AND EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=substr(NEW.principal_key,10) AND scope='collection-founder' AND enabled=1))))
 AND (((s.eligibility_kind='unrestricted' AND s.stage_type='public' AND r.membership_source_id IS NULL) OR (s.eligibility_kind='list' AND s.list_id=r.membership_source_id AND EXISTS(SELECT 1 FROM app_collection_list_seals l JOIN json_each(l.page_ids_json) p JOIN app_collection_eligibility_pages e ON e.record_id=p.value JOIN json_each(e.entries_json) w WHERE l.id=r.membership_source_id AND w.value=r.wallet))))
 AND (((r.fair_policy_hash IS NULL AND NOT EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=r.inventory_id) AND NOT EXISTS(SELECT 1 FROM fair_requests WHERE operation_id=r.operation_id) AND json_extract(NEW.result_json,'$.fairness')='manual-fixture') OR (r.fair_policy_hash IS NOT NULL AND EXISTS(SELECT 1 FROM fair_inventories f JOIN fair_requests q ON q.operation_id=r.operation_id WHERE f.inventory_id=r.inventory_id AND f.policy_hash=r.fair_policy_hash AND f.registered_ms=r.fair_registered_ms AND q.target_round=r.target_round AND q.context_digest=r.context_digest) AND json_extract(NEW.result_json,'$.fairness')='configured-offline-beacon' AND (SELECT COUNT(*) FROM fair_reserved_assets WHERE inventory_id=r.inventory_id)=1000)))
 AND (r.fair_policy_hash IS NULL OR (1692803367000+(r.target_round-1)*3000>r.admitted_ms AND r.fair_registered_ms<=r.admitted_ms))
 AND (json_array_length(a.remaining_json)=10 AND (SELECT SUM(value) FROM json_each(a.remaining_json))=1000-a.fulfilled AND NOT EXISTS(SELECT 1 FROM json_each(a.remaining_json) q WHERE q.type<>'integer' OR q.value<0 OR q.value>json_extract('[489,256,128,64,32,16,8,4,2,1]','$['||q.key||']'))));
END;

CREATE TRIGGER guarded_mint_request_insert BEFORE INSERT ON fair_requests WHEN EXISTS(SELECT 1 FROM app_collection_mint_admissions WHERE operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'Accepted normalized mint request is immutable'); END;
