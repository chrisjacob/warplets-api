import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recoveryLegacyAdoptionSource} from './v2-legacy-adoption-fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
import {createRecoveryV2LegacyAdoptionReconciler} from './v2-reconcile-legacy-adoptions.mjs';
import {createRecoveryV2LegacyMintReconciler} from './v2-reconcile-legacy-mints.mjs';
import {createNodeRecoveryDigest} from './v2-node-digest.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {hashJson} from './inventory.mjs';
import {observeCollectionAsset} from '../collect/store.mjs';
import {legacyAdmissionWallet} from '../collect/legacy-admission-audit.fixtures.mjs';

test('genuine adopted original mint is reverified independently on a fresh target with exact durable proof and bounded private prefix',async t=>{
 const f=await recoveryLegacyAdoptionSource(t,{beforeParents(source){const asset=source.db.prepare('SELECT id,owner,bind_ms FROM collect_assets').get(),at=asset.bind_ms+1000;observeCollectionAsset(source.db,{sourceId:'synthetic-original-mint-later-transfer',assetId:asset.id,kind:'transfer',from:asset.owner,to:legacyAdmissionWallet(98),at,finalized:true},source.economicInput.asOfMs);}}),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});assert.equal((await target.drive({stopPhase:'reconcile-audit'})).phase,'reconcile-audit');
 const fault={kind:null},metrics=[],actual=[];let measurement=null;
 const driver={...target.driver,async batch(statements){if(measurement)measurement.sql+=statements.length;const chosen=fault.kind==='omit-proof'?statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-mint')):statements,result=await target.driver.batch(chosen);
  for(let n=0;n<chosen.length;n++){const text=chosen[n].sql,rows=result[n].rows;
   if(fault.kind==='missing-certificate-proof'&&text.includes("phase='legacy-adoption'")&&text.includes('scope=?'))result[n]={...result[n],rows:[]};
   if(text.includes('FROM app_collection_legacy_mint_anchors')&&rows[0]){if(fault.kind==='wrong-chain')rows[0].prior_chain_digest='0'.repeat(64);if(fault.kind==='wrong-anchor-index')rows[0].asset_id='synthetic-unrelated';}
   if(text.includes('FROM collect_operations WHERE')&&rows[0]&&fault.kind==='wrong-original-owner'){const op=JSON.parse(rows[0].body);op.owner='wrong';rows[0].body=JSON.stringify(op);}
   if(text.includes('FROM vault_assets WHERE')&&rows[0]&&fault.kind==='wrong-slot'){const v=JSON.parse(rows[0].body);v.coords='{}';rows[0].body=JSON.stringify(v);}
   if(text.includes('FROM app_collection_legacy_adoption_objects')&&rows[0]&&fault.kind==='wrong-object-identity')rows[0].identity_json='{}';
  }if(fault.kind==='lost-ack'&&chosen.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-mint'))throw Error('Synthetic lost committed mint proof response.');return result;
 }},artifacts={async getVerified(identity){if(measurement)measurement.objects++;if(fault.kind==='missing-original')return {status:'missing'};const result=await target.store.getVerified(identity);if(fault.kind==='corrupt-original'&&result.status==='verified'){const bytes=result.bytes.slice();bytes[0]^=1;return {...result,bytes};}if(fault.kind==='mutation')target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();return result;}},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>f.now},ids:{next:randomUUID}}),ports={driver,artifacts,crypto:f.crypto,repository,createDigest:createNodeRecoveryDigest},stages=createRecoveryV2LegacyAdoptionReconciler(ports),mints=createRecoveryV2LegacyMintReconciler({...ports,onMeasure:m=>metrics.push(m)});
 let loaded=await repository.load(f.captured.digest),c=JSON.parse(loaded.run.checkpoint_json);assert.equal((await repository.advance(loaded,{delta:{phase:'reconcile-legacy-adoptions'},targetWatermark:c.targetWatermark})).kind,'progress');
 for(let n=0;n<10;n++){loaded=await repository.load(f.captured.digest);c=JSON.parse(loaded.run.checkpoint_json);if(c.legacyAdoption?.stageIndex===1)break;assert.equal((await stages.step(loaded)).kind,'progress');}
 loaded=await repository.load(f.captured.digest);c=JSON.parse(loaded.run.checkpoint_json);assert.equal((await repository.advance(loaded,{delta:{phase:'reconcile-legacy-adoption-mints'},targetWatermark:c.targetWatermark})).kind,'progress');
 const call=async()=>{measurement={sql:0,objects:0};try{return await mints.step(await repository.load(f.captured.digest));}finally{actual.push(measurement);measurement=null;}};
 let result=await call();assert.equal(result.kind,'progress',JSON.stringify(result));const initial=target.checkpoint(),reset=()=>{target.db.prepare("UPDATE app_recovery_runs SET state='restoring',checkpoint_json=?,report_json=NULL WHERE id=?").run(canonicalJson(initial),f.captured.digest);target.db.prepare("UPDATE app_recovery_state SET status='restoring',write_nonce=NULL WHERE active_restore_id=?").run(f.captured.digest);};
 for(const kind of ['missing-certificate-proof','wrong-chain','wrong-anchor-index','wrong-original-owner','wrong-slot','wrong-object-identity','missing-original','corrupt-original']){fault.kind=kind;reset();result=await call();assert.equal(result.kind,'held',kind+': '+JSON.stringify(result));assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-mint'").get().n,0);}
 fault.kind='omit-proof';reset();result=await call();assert.equal(result.kind,'conflict',JSON.stringify(result));assert.deepEqual(target.checkpoint(),initial);assert.equal(target.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
 fault.kind='lost-ack';result=await call();assert.equal(result.kind,'replayed',JSON.stringify(result));fault.kind=null;assert.equal(result.mintAudit.kind,'audited');assert.equal(target.checkpoint().legacyAdoption.mintPrefix.ordinal,1);const row=target.db.prepare('SELECT body_json,body_digest FROM app_collection_legacy_mint_anchors').get(),anchor=JSON.parse(row.body_json);assert.deepEqual(result.mintAudit.summary,anchor.originalOutcome);assert.notEqual(anchor.originalOutcome.originalWallet,anchor.current.current.owner);
 const proof=target.db.prepare("SELECT * FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-mint'").get();assert.equal(proof.result_digest,await hashJson(f.crypto,['v2-legacy-original-mint',anchor.adoptionId,0,row.body_digest,anchor.originalOutcome]));assert.equal(proof.target_watermark,initial.targetWatermark);
 assert.equal((await call()).reason,'recovery-legacy-adoption-semantics-incomplete');assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'held');
 reset();fault.kind='mutation';assert.equal((await call()).kind,'held');assert.equal(target.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,initial.targetWatermark+1);
 assert.ok(metrics.every(m=>m.maxWorkingBytes<=1048576&&m.operationAllowance<=64&&m.maxBatchBytes<=262144));assert.ok(actual.every(m=>m.sql+m.objects<=64));t.diagnostic(JSON.stringify({genuineSourceAndTarget:true,originalMintProof:true,remainingSemanticsHeld:true,maxWorkingBytes:Math.max(...metrics.map(m=>m.maxWorkingBytes)),maxOperations:Math.max(...actual.map(m=>m.sql+m.objects)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes))}));
});
