import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recoveryPrecutObservationSource} from './v2-legacy-precut-observations.fixtures.mjs';
import {createRecoveryLegacyPrecutObservations} from './v2-legacy-precut-observations.mjs';
import {createRetainedCollectionObservationVerifier} from './v2-legacy-current-observation.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
import {hashJson} from './inventory.mjs';
import {canonicalJson} from '../security/canonical.mjs';
test('genuine pre-adoption041 passes preparation and replays from original mint plus legacy prefix into exact cut, then later041',async t=>{
 const f=await recoveryPrecutObservationSource(t),target=v2RestoreTarget(t,{...f.ports,store:f.store,captured:f.captured,now:f.now});assert.equal((await target.drive({stopPhase:'reconcile-audit'})).phase,'reconcile-audit');
 const repository=createRecoveryV2RestoreDatabase({driver:target.driver,clock:{nowMs:()=>f.now},ids:{next:randomUUID}}),loaded=await repository.load(f.captured.digest),c=JSON.parse(loaded.run.checkpoint_json),row=target.db.prepare('SELECT * FROM app_collection_legacy_mint_anchors').get(),anchor=JSON.parse(row.body_json),pin={generation:loaded.state.generation,watermark:c.targetWatermark};
 // Isolated synthetic original-mint prerequisite. Genuine source audits and
 // activation exist, but this test does not establish complete target readiness.
 const check={phase:'legacy-adoption-mint',scope:anchor.adoptionId,ordinal:0,itemCount:1,targetWatermark:c.targetWatermark,resultDigest:await hashJson(f.crypto,['v2-legacy-original-mint',anchor.adoptionId,0,row.body_digest,anchor.originalOutcome])};assert.equal((await repository.advance(loaded,{delta:{},targetWatermark:c.targetWatermark,check})).kind,'progress');
 const q={restoreId:f.captured.digest,adoptionId:anchor.adoptionId,ordinal:0,pin,retainedBytes:3*Buffer.byteLength(loaded.run.checkpoint_json)},metrics=[],fault={kind:null},driver={...target.driver,async batch(statements){const results=await target.driver.batch(statements);for(let n=0;n<statements.length;n++){
  if(fault.kind==='missing-proof'&&statements[n].sql.includes("phase='legacy-adoption-mint'"))results[n]={...results[n],rows:[]};
  if(fault.kind==='wrong-before'&&statements[n].sql.includes('before_json')&&results[n].rows[0]){const b=JSON.parse(results[n].rows[0].before_json);b.version++;results[n].rows[0].before_json=JSON.stringify(b);}
  if(fault.kind==='wrong-time'&&statements[n].sql.startsWith('SELECT b.source_id,b.event_kind'))for(const r of results[n].rows)r.created_ms=f.now+9999;
 }return results;}},helper=createRecoveryLegacyPrecutObservations({driver,crypto:f.crypto,artifacts:target.store}),call=async(method,input=q)=>{const r=await helper[method](input);metrics.push(r.metrics);return r;};
 for(const kind of ['missing-proof','wrong-before']){fault.kind=kind;const r=await call('start');assert.equal(r.kind,'held',JSON.stringify(r));}fault.kind=null;
 let r=await call('start');assert.equal(r.kind,'progress',JSON.stringify(r));assert.equal(r.context.preCount,2);assert.equal(r.context.postCount,1);const first=r.context;
 fault.kind='wrong-time';assert.equal((await call('step',{...q,context:first})).kind,'held');fault.kind=null;
 const missing=createRecoveryLegacyPrecutObservations({driver,crypto:f.crypto,artifacts:{async getVerified(identity){return {status:'missing',identity};}}});assert.equal((await missing.step({...q,context:first})).kind,'held');
 while(r.kind==='progress')r=await call('step',{...q,context:r.context});assert.equal(r.kind,'verified',JSON.stringify(r));assert.equal(r.currentAssetDigest,anchor.current.currentAssetDigest);assert.deepEqual(r.current,anchor.current.current);assert.equal(r.counts.transfers,2);
 const post=target.db.prepare("SELECT b.source_id,r.expected_revisions FROM app_collection_observation_bindings b JOIN app_command_receipts r ON r.operation_id=b.command_operation_id WHERE CAST(json_extract(r.expected_revisions,'$.source') AS INTEGER)>? ORDER BY CAST(json_extract(r.expected_revisions,'$.source') AS INTEGER)").all(Number(r.afterSourceRevision));assert.equal(post.length,1);
 const later=await createRetainedCollectionObservationVerifier({driver,crypto:f.crypto,artifacts:target.store}).replay({sourceId:post[0].source_id,assetId:r.assetId,afterSourceRevision:r.afterSourceRevision,inventory:r.inventory,baseline:r.baseline,asOfMs:f.now,pin,retainedBytes:q.retainedBytes});assert.equal(later.kind,'verified',JSON.stringify(later));assert.equal(canonicalJson(later.asset),canonicalJson(target.db.prepare('SELECT * FROM collect_assets WHERE id=?').get(r.assetId)));assert.equal(canonicalJson(later.vault),canonicalJson(target.db.prepare('SELECT * FROM vault_assets WHERE id=?').get(r.assetId)));
 let changed=false;const moving=createRecoveryLegacyPrecutObservations({driver,artifacts:target.store,crypto:{...f.crypto,async sha256(bytes){const result=await f.crypto.sha256(bytes);if(!changed){changed=true;target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1').run();}return result;}}});assert.equal((await moving.start(q)).kind,'held');
 assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');assert.ok(metrics.every(m=>m.sql+m.objectReads+12<=64&&m.workingBytes<=1048576));t.diagnostic(JSON.stringify({genuinePrecutPreparation:true,syntheticMintPrerequisite:true,fullReadiness:false,maxOperations:Math.max(...metrics.map(m=>m.sql+m.objectReads+12)),maxWorkingBytes:Math.max(...metrics.map(m=>m.workingBytes)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes))}));
});

test('genuine legacy transfer interleaved between accepted pre-adoption041 events stays explicitly unsupported',async t=>{
 const f=await recoveryPrecutObservationSource(t,{interleave:true,later:false}),target=v2RestoreTarget(t,{...f.ports,store:f.store,captured:f.captured,now:f.now});assert.equal((await target.drive({stopPhase:'reconcile-audit'})).phase,'reconcile-audit');const c=target.checkpoint(),row=target.db.prepare('SELECT * FROM app_collection_legacy_mint_anchors').get(),a=JSON.parse(row.body_json);
 target.db.prepare('INSERT INTO app_recovery_reconcile_checks VALUES(?,?,?,?,?,?,?)').run(f.captured.digest,'legacy-adoption-mint',a.adoptionId,0,c.targetWatermark,await hashJson(f.crypto,['v2-legacy-original-mint',a.adoptionId,0,row.body_digest,a.originalOutcome]),1);
 const helper=createRecoveryLegacyPrecutObservations({driver:target.driver,crypto:f.crypto,artifacts:target.store}),result=await helper.start({restoreId:f.captured.digest,adoptionId:a.adoptionId,ordinal:0,pin:{generation:target.db.prepare('SELECT generation FROM app_recovery_state').get().generation,watermark:c.targetWatermark},retainedBytes:3*Buffer.byteLength(canonicalJson(c))});assert.equal(result.kind,'held');assert.equal(result.reason,'precut-interleaved-legacy-history-unsupported');assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');
});
