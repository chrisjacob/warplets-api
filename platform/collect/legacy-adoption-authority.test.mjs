import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptionAuthorityFixture,syntheticAdoptionLabel,addSyntheticPendingAdmission} from './legacy-adoption-authority.fixtures.mjs';
import {createLegacyAdoptionAuthorityReader,hashLegacyAdoptionCertificate,legacyAdoptionCertificateBody} from './legacy-adoption-authority.mjs';
import {START} from './legacy-stage-source.fixtures.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
function changedDriver(base,match,change){return {async batch(statements){const results=await base.batch(statements);for(let i=0;i<statements.length;i++)if(match(statements[i].sql))results[i]={...results[i],rows:change(copy(results[i].rows))};return results;}};}
function readWith(f,driver,crypto=f.crypto){return createLegacyAdoptionAuthorityReader({driver,crypto}).read(f.request());}
test('synthetic accepted-import reader verifies genuine legacy source, receipt lineage and separate current fence',async t=>{
 const f=await adoptionAuthorityFixture(t),out=await f.service.read(f.request());assert.equal(f.label,syntheticAdoptionLabel);assert.equal(out.kind,'ready',JSON.stringify(out));assert.deepEqual(out.counts,{historicalAdmissions:2,newAdmissions:0,newFulfillments:0,totalStages:2,importedStages:2,newStages:0});assert.equal(out.stage.walletAdmitted,2);assert.equal(out.authority.revision,0);assert.notEqual(out.fence.generation,out.certificate.sourceGeneration);assert.notEqual(out.fence.watermark,out.certificate.sourceWatermark);assert.equal(out.metrics.sql,13);assert.ok(Object.isFrozen(out.certificate));
 // Current operator permission is intentionally not re-required for an accepted immutable import.
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();assert.equal((await f.service.read(f.request())).kind,'ready');
 for(const column of ['economic_result_json','parent_preimage_json','quiescence_json'])assert.throws(()=>f.db.prepare(`UPDATE app_collection_legacy_adoptions SET ${column}=?`).run('{}'),/immutable/i);
 assert.equal((await f.service.read({...f.request(),stageId:'missing'})).reason,'legacy-adoption-stage-unavailable');
 t.diagnostic(JSON.stringify(out.metrics));
});
test('retained parent/quiescence/result bytes are independently hashed and caller inputs captured before awaiting',async t=>{
 const f=await adoptionAuthorityFixture(t),expected=await hashLegacyAdoptionCertificate(f.certificate,f.crypto);
 for(const column of ['parent_preimage_json','quiescence_json','economic_result_json','preparation_result_json']){const altered=copy(f.certificate),v=JSON.parse(altered[column]);if(column==='parent_preimage_json')v.relation_digest='f'.repeat(64);else if(column==='quiescence_json')v.current.sourceDigest='f'.repeat(64);else if(column==='economic_result_json')v.stages[0].spentLamports='6000';else v.quiescenceDigest='f'.repeat(64);altered[column]=canonicalJson(v);await assert.rejects(hashLegacyAdoptionCertificate(altered,f.crypto),/result-digest/);}
 const supplied=copy(f.certificate);let modified=false;const crypto={...f.crypto,async sha256(bytes){if(!modified){modified=true;supplied.operator='mutated';supplied.parent_preimage_json='{}';supplied.remaining_json='[]';}return f.crypto.sha256(bytes);}};assert.deepEqual(await hashLegacyAdoptionCertificate(supplied,crypto),expected);
 assert.deepEqual(legacyAdoptionCertificateBody({...f.certificate,activation_command_id:'different-allocated-id'}),expected.body);
 for(const change of [p=>p.source_revision++,p=>p.createdMs=0,p=>p.source_current=0]){const altered=copy(f.certificate),p=JSON.parse(altered.parent_preimage_json);change(p);altered.parent_preimage_json=canonicalJson(p);await assert.rejects(hashLegacyAdoptionCertificate(altered,f.crypto),/parent-binding/);}
});
test('receipt, imported child and named-source failures hold rather than return ordinary counters',async t=>{
 const f=await adoptionAuthorityFixture(t);
 const cases=[
 [s=>s.startsWith('SELECT id,size,CASE'),r=>r.map(x=>({...x,body_base64:'!!!!'})),'root-invalid'],
 [s=>s.startsWith('SELECT id,size,CASE'),()=>[],'root-missing'],
 [s=>s.startsWith('SELECT operation_id,principal_key'),r=>r.map(x=>({...x,state:'staging'})),'activation-receipt'],
 [s=>s.startsWith('SELECT operation_id,principal_key'),r=>r.map(x=>({...x,request_digest:'f'.repeat(64)})),'activation-digest'],
 [s=>s.includes('CASE WHEN i.adoption_id=?'),()=>[],'stage-receipt-missing'],
 [s=>s.includes('CASE WHEN i.adoption_id=?'),r=>r.map(x=>({...x,output_digest:'f'.repeat(64)})),'stage-receipt-digest'],
 [s=>s.includes('CASE WHEN i.adoption_id=?'),r=>r.map(x=>({...x,binding_valid:0})),'stage-receipt'],
 [s=>s.includes('CASE WHEN i.adoption_id=?'),r=>r.map(x=>({...x,terms_json:canonicalJson({...JSON.parse(x.terms_json),walletLimit:2})})),'stage-source-terms'],
 [s=>s.includes('source_seal FROM app_collection_legacy_adoption_objects'),r=>r.map(x=>({...x,source_seal:0})),'original-closure'],
 [s=>s.includes('FROM combined')&&s.includes('invalid_binding'),r=>r.map(x=>({...x,owner_key_count:1})),'count-conflict'],
 [s=>s.includes('FROM combined')&&s.includes('invalid_binding'),r=>r.map(x=>({...x,invalid_prefix:1})),'count-conflict'],
 [s=>s.includes('FROM combined')&&s.includes('invalid_binding'),r=>r.map(x=>({...x,invalid_binding:1})),'count-conflict'],
 ];for(const [match,change,reason]of cases){const out=await readWith(f,changedDriver(f.driver,match,change));assert.equal(out.kind,'pending');assert.equal(out.reason,'legacy-adoption-'+reason);}
});
test('after-hash source mutation invalidates the whole read without requiring original watermark equality',async t=>{
 const f=await adoptionAuthorityFixture(t);let changed=false;const crypto={...f.crypto,async sha256(bytes){const out=await f.crypto.sha256(bytes);if(!changed){changed=true;f.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return out;}};
 assert.equal((await readWith(f,f.driver,crypto)).reason,'legacy-adoption-source-changed');assert.equal((await f.service.read(f.request())).kind,'ready');
});
test('founder cost aggregation remains exact above SQLite signed64 and JS safe integers',async t=>{
 const f=await adoptionAuthorityFixture(t,{type:'founder',cost:'4611686018427387904',count:3,stageCount:1}),out=await f.service.read(f.request());assert.equal(out.kind,'ready',JSON.stringify(out));assert.equal(out.stage.founderSpentLamports,'13835058055282163712');assert.equal(out.stage.walletAdmitted,1);
});
test('zero admission and zero stage certificate remains an explicit complete empty baseline',async t=>{
 const f=await adoptionAuthorityFixture(t,{count:0,stageCount:0}),out=await f.service.read(f.request());assert.equal(out.kind,'ready',JSON.stringify(out));assert.equal(out.authority.admitted,0);assert.equal(out.stage,null);assert.equal(out.metrics.sql,12);
});
test('legal32 stage and1000 fulfilled legacy baseline remains bounded without hydrating operations or anchor bodies',async t=>{
 const f=await adoptionAuthorityFixture(t,{count:1000,stageCount:32,reasonBytes:500}),out=await f.service.read(f.request());assert.equal(out.kind,'ready',JSON.stringify(out));assert.equal(out.authority.fulfilled,1000);assert.equal(out.stage.walletAdmitted,1000);assert.equal(out.metrics.sql,28);assert.ok(out.metrics.workingBytes<=1048576&&out.metrics.maxBatchBytes<=262144);t.diagnostic(JSON.stringify(out.metrics));
});

test('combined imported plus modern pending counters avoid double counting and reject mismatched cost or ordinal',async t=>{
 for(const options of [{},{ordinal:4},{costOverride:'6000'}]){const f=await adoptionAuthorityFixture(t,{count:2,stageCount:1});await addSyntheticPendingAdmission(f,options);const out=await f.service.read(f.request());if(Object.keys(options).length){assert.equal(out.reason,'legacy-adoption-count-conflict');}else{assert.equal(out.kind,'ready',JSON.stringify(out));assert.equal(out.authority.admitted,3);assert.equal(out.authority.fulfilled,2);assert.equal(out.counts.newAdmissions,1);assert.equal(out.stage.admitted,3);assert.equal(out.stage.walletAdmitted,3);assert.equal(out.authority.revision,1);}}
});
test('restored header contradictions cannot borrow the accepted certificate origin or canonical root',async t=>{
 const f=await adoptionAuthorityFixture(t);for(const patch of [{kind:'genesis',tranche:1,season_start:null,season_month:null},{season_start:START,origin_digest:'f'.repeat(64)},{season_month:'2026-02'}]){const out=await readWith(f,changedDriver(f.driver,s=>s.startsWith('SELECT h.id'),rows=>rows.map(row=>({...row,...patch}))));assert.equal(out.kind,'pending');assert.match(out.reason,/root-binding|origin-digest/);}
});

test('combined counters retain original slots after a genuine B04-bound guarded046 fulfillment',async t=>{
 const f=await adoptionAuthorityFixture(t,{count:2,stageCount:1}),{admission}=await addSyntheticPendingAdmission(f),{dispatchMintFulfillment,mintFulfillmentInput,MINT_FULFILLMENT_TEST_OPERATOR}=await import('./mint-fulfillment-test-harness.mjs');
 for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(MINT_FULFILLMENT_TEST_OPERATOR.id,scope);
 const nowMs=admission.admitted_ms+2000,call=request=>dispatchMintFulfillment({driver:f.driver,crypto:f.crypto,store:f.artifacts,request:{nowMs,idPrefix:'synthetic-import-read-'+(request.method??'fulfill'),...request}}),e=await call({method:'evidence',event:{inventoryId:f.inventoryId,operationId:admission.operation_id,kind:'mint',commitment:admission.commitment,provenance:'manual-fixture',atMs:nowMs-1000,proof:{proofId:'synthetic-imported-new-proof',assetId:'synthetic-imported-new-asset',ticket:0,traits:{model:'Local',backdrop:'Sky',symbol:'Star'}}}});assert.equal(e.result?.kind,'committed',JSON.stringify(e));const fulfilled=await call({input:mintFulfillmentInput(e.result.value,'synthetic-imported-new-fulfill')});assert.equal(fulfilled.result?.kind,'committed',JSON.stringify(fulfilled));
 const out=await f.service.read(f.request());assert.equal(out.kind,'ready',JSON.stringify(out));assert.equal(out.authority.admitted,3);assert.equal(out.authority.fulfilled,3);assert.equal(out.authority.revision,2);assert.equal(out.counts.newFulfillments,1);assert.equal(out.authority.remaining[0],486);
 // Current presentation levels may change; quota accounting uses the immutable046 draw.
 const row=f.db.prepare('SELECT asset FROM collect_assets WHERE id=?').get('synthetic-imported-new-asset'),nft=JSON.parse(row.asset);nft.level=2;f.db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run(JSON.stringify(nft),'synthetic-imported-new-asset');assert.deepEqual((await f.service.read(f.request())).authority,out.authority);
});

test('same operation or ordinal cannot exist in both accepted mint families',async t=>{
 const f=await adoptionAuthorityFixture(t,{count:1,stageCount:1}),h=f.anchors[0];
 assert.throws(()=>f.db.prepare(`INSERT INTO app_collection_mint_admissions(operation_id,command_operation_id,inventory_id,stage_id,ordinal,wallet,commitment,admitted_ms,terms_digest,price_lamports,cost_lamports,membership_source_id,fair_policy_hash,fair_registered_ms,target_round,context_digest,effect_json,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,'{}','{}')`).run(h.operation_id,f.receipt.operation_id,h.inventory_id,h.stage_id,h.ordinal,h.wallet,h.commitment,h.admitted_ms,h.terms_digest,h.price_lamports,h.cost_lamports),/overlap/);
 assert.throws(()=>f.db.prepare('UPDATE collect_operations SET proof_id=? WHERE id=?').run('changed-proof',h.operation_id),/Retain original/);
 assert.equal((await f.service.read(f.request())).kind,'ready');
});
