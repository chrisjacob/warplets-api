-- Admit private Season free mints only against the immutable fixed-opening cut.
-- Preserve every installed045 non-free admission predicate.
DROP TRIGGER app_collection_mint_admission_mandatory_effect;
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
 AND (s.stage_type IN ('whitelist','public','founder','free'))
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
 AND (((s.eligibility_kind='unrestricted' AND s.stage_type='public' AND r.membership_source_id IS NULL) OR (s.eligibility_kind='list' AND s.list_id=r.membership_source_id AND EXISTS(SELECT 1 FROM app_collection_list_seals l JOIN json_each(l.page_ids_json) p JOIN app_collection_eligibility_pages e ON e.record_id=p.value JOIN json_each(e.entries_json) w WHERE l.id=r.membership_source_id AND w.value=r.wallet)) OR (s.stage_type='free' AND h.kind='season' AND s.eligibility_kind='pending' AND s.list_id IS NULL AND EXISTS(SELECT 1 FROM app_collection_free_cuts c JOIN app_collection_cut_records cr ON cr.id=c.root_id AND cr.format='collection-cut-root-v1' JOIN app_collection_list_seals l ON l.id=c.list_id JOIN json_each(l.page_ids_json) p JOIN app_collection_eligibility_pages e ON e.record_id=p.value JOIN json_each(e.entries_json) w WHERE c.inventory_id=r.inventory_id AND c.stage_id=r.stage_id AND c.cut_ms=s.opens_ms AND c.list_id=r.membership_source_id AND c.eligible_count=l.member_count AND json_extract(cr.body_json,'$.inventoryId')=r.inventory_id AND json_extract(cr.body_json,'$.stageId')=r.stage_id AND json_extract(cr.body_json,'$.termsDigest')=s.terms_digest AND json_extract(cr.body_json,'$.atMs')=s.opens_ms AND json_extract(cr.body_json,'$.eligibilityListId')=c.list_id AND w.value=r.wallet))))
 AND (((r.fair_policy_hash IS NULL AND NOT EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=r.inventory_id) AND NOT EXISTS(SELECT 1 FROM fair_requests WHERE operation_id=r.operation_id) AND json_extract(NEW.result_json,'$.fairness')='manual-fixture') OR (r.fair_policy_hash IS NOT NULL AND EXISTS(SELECT 1 FROM fair_inventories f JOIN fair_requests q ON q.operation_id=r.operation_id WHERE f.inventory_id=r.inventory_id AND f.policy_hash=r.fair_policy_hash AND f.registered_ms=r.fair_registered_ms AND q.target_round=r.target_round AND q.context_digest=r.context_digest) AND json_extract(NEW.result_json,'$.fairness')='configured-offline-beacon' AND (SELECT COUNT(*) FROM fair_reserved_assets WHERE inventory_id=r.inventory_id)=1000)))
 AND (r.fair_policy_hash IS NULL OR (1692803367000+(r.target_round-1)*3000>r.admitted_ms AND r.fair_registered_ms<=r.admitted_ms))
 AND (json_array_length(a.remaining_json)=10 AND (SELECT SUM(value) FROM json_each(a.remaining_json))=1000-a.fulfilled AND NOT EXISTS(SELECT 1 FROM json_each(a.remaining_json) q WHERE q.type<>'integer' OR q.value<0 OR q.value>json_extract('[489,256,128,64,32,16,8,4,2,1]','$['||q.key||']'))));
END;
