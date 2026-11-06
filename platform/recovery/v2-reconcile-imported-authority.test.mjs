import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recoveryImportedLifecycleSource} from './v2-imported-authority-fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
import {createRecoveryV2CollectionReconciler} from './v2-reconcile-collections.mjs';
import {verifyRecoveryImportedAuthority} from './v2-reconcile-imported-authority.mjs';
import {hashLegacyAdoptionCertificate} from '../collect/legacy-adoption-authority.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {hashJson} from './inventory.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
test('fresh private target reconciles genuine imported history plus new mint, B04 fulfillment, stage and pending tail only after isolated adoption completion proof',async t=>{
 const f=await recoveryImportedLifecycleSource(t,{pending:true}),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});assert.equal((await target.drive({stopPhase:'reconcile-audit'})).phase,'reconcile-audit');
 const fault={kind:null},actual=[],measured=[];let active=null;
 const driver={...target.driver,async batch(statements){if(active){active.sql+=statements.length;active.maxBatchBytes=Math.max(active.maxBatchBytes,measureBatch(statements).batchBytes);}const selected=fault.kind==='omit-authority-proof'?statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='collection'&&String(s.values[2]).startsWith('authority:'))):statements,result=await target.driver.batch(selected);
  for(let n=0;n<selected.length;n++){const text=selected[n].sql,rows=result[n].rows;
   if(text.includes("phase='legacy-adoption-complete'")){if(fault.kind==='missing-completion')result[n]={...result[n],rows:[]};if(fault.kind==='wrong-completion'&&rows[0])rows[0].result_digest='0'.repeat(64);}
   if(text.includes('FROM app_collection_authorities a JOIN')&&rows[0]&&fault.kind==='wrong-revision')rows[0].revision++;
   if(text.includes('WITH historical AS')&&rows[0]){if(fault.kind==='bad-prefix')rows[0].invalid_prefix++;if(fault.kind==='bad-lineage')rows[0].invalid_binding++;}
   if(text.includes('COUNT(DISTINCT slot_key)')&&rows[0]&&fault.kind==='duplicate-slot')rows[0].unique_slots--;
   if(text.includes('COUNT(DISTINCT ordinal) ordinals')&&rows[0]&&fault.kind==='wrong-time')rows[0].invalid_times++;
  }return result;
 }},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>f.now},ids:{next:randomUUID}}),helper=createRecoveryV2CollectionReconciler({driver,artifacts:target.store,crypto:f.crypto,repository});
 let loaded=await repository.load(f.captured.digest),c=JSON.parse(loaded.run.checkpoint_json),cert=await hashLegacyAdoptionCertificate(target.db.prepare('SELECT * FROM app_collection_legacy_adoptions').get(),f.crypto);
 // Explicit synthetic65 prerequisite isolates compatibility. It is not evidence
 // of completed upstream adoption reconciliation or a recovery-ready target.
 assert.equal((await repository.advance(loaded,{delta:{phase:'reconcile-collection-authorities',collectionAuthorityCursor:-9007199254740991,checkedCollectionAuthorities:0},targetWatermark:c.targetWatermark,check:{phase:'legacy-adoption-complete',scope:cert.body.adoptionId,ordinal:0,targetWatermark:c.targetWatermark,itemCount:cert.body.admitted,resultDigest:await hashJson(f.crypto,['v2-legacy-adoption-complete',cert.body.adoptionId,cert.certificateDigest])}})).kind,'progress');
 const initial=target.checkpoint(),reset=()=>{target.db.prepare("UPDATE app_recovery_runs SET state='restoring',checkpoint_json=?,report_json=NULL WHERE id=?").run(canonicalJson(initial),f.captured.digest);target.db.prepare("UPDATE app_recovery_state SET status='restoring',write_nonce=NULL WHERE active_restore_id=?").run(f.captured.digest);};
 const call=async()=>{active={sql:0,maxBatchBytes:0};try{const loaded=await repository.load(f.captured.digest);return await helper.step(loaded,JSON.parse(loaded.run.checkpoint_json));}finally{actual.push(active);active=null;}};
 assert.equal(target.db.prepare('SELECT admitted_ms FROM app_collection_mint_admissions ORDER BY ordinal LIMIT 1').get().admitted_ms,cert.body.createdMs);
 for(const kind of ['missing-completion','wrong-completion','wrong-revision','bad-prefix','bad-lineage','duplicate-slot','wrong-time']){fault.kind=kind;reset();await assert.rejects(call,/Recovery imported authority/);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='collection'").get().n,0);}
 fault.kind='omit-authority-proof';reset();assert.equal((await call()).kind,'conflict');assert.deepEqual(target.checkpoint(),initial);fault.kind=null;
 loaded=await repository.load(f.captured.digest);c=JSON.parse(loaded.run.checkpoint_json);const authority=target.db.prepare('SELECT a.*,h.revision header_revision,h.kind,h.tranche,h.season_start,h.origin_digest FROM app_collection_authorities a JOIN collect_inventories h ON h.id=a.inventory_id').get(),verified=await verifyRecoveryImportedAuthority({loaded,c,authority},{driver,crypto:f.crypto,onMeasure:m=>measured.push(m)});assert.deepEqual(verified.counts,{historicalAdmissions:1,newAdmissions:2,newFulfillments:1,totalStages:2,importedStages:1,newStages:1,admitted:3,fulfilled:2});
 let result;for(let n=0;n<20;n++){result=await call();assert.equal(result.kind,'progress',JSON.stringify(result));if(target.checkpoint().phase==='reconcile-publications')break;}assert.equal(target.checkpoint().phase,'reconcile-publications');assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');
 assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='collection' AND scope LIKE 'admission:%'").get().n,2);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='collection' AND scope LIKE 'fulfillment:%'").get().n,1);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM app_collection_legacy_mint_anchors').get().n,1);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').get().n,2);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
 reset();let changed=false;const crypto={...f.crypto,async sha256(bytes){const digest=await f.crypto.sha256(bytes);if(!changed){changed=true;target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return digest;}};await assert.rejects(verifyRecoveryImportedAuthority({loaded,c,authority},{driver,crypto}),/target changed/);
 assert.ok(actual.every(m=>m.sql<=64&&m.maxBatchBytes<=262144));assert.ok(measured.every(m=>m.maxWorkingBytes<=1048576&&m.operationAllowance<=64));t.diagnostic(JSON.stringify({genuineActivatedThenNewMint:true,syntheticCompletionPrerequisite:true,fullReadiness:false,counts:verified.counts,maxWorkingBytes:Math.max(...measured.map(m=>m.maxWorkingBytes)),maxOperations:Math.max(...actual.map(m=>m.sql)),maxBatchBytes:Math.max(...actual.map(m=>m.maxBatchBytes))}));
});
