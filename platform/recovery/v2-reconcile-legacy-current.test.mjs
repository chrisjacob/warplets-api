import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recoveryLegacyAdoptionSource} from './v2-legacy-adoption-fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
import {createRecoveryV2LegacyCurrentReconciler} from './v2-reconcile-legacy-current.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {hashJson} from './inventory.mjs';

test('private retained current-history adapter requires prior original-mint proof and atomically saves its own proof',async t=>{
 const f=await recoveryLegacyAdoptionSource(t),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});
 assert.equal((await target.drive({stopPhase:'reconcile-audit'})).phase,'reconcile-audit');
 const metrics=[],fault={kind:null},driver={...target.driver,async batch(statements){
  const selected=fault.kind==='omit-proof'?statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-current')):statements;
  const results=await target.driver.batch(selected);
  for(let n=0;n<selected.length;n++){
   if(fault.kind==='missing-mint-proof'&&selected[n].sql.includes("phase='legacy-adoption-mint'"))results[n]={...results[n],rows:[]};
   if(fault.kind==='corrupt-owner'&&selected[n].sql.includes('FROM collect_assets WHERE')&&results[n].rows[0]){const body=JSON.parse(results[n].rows[0].body);body.owner='synthetic-wrong-owner';results[n].rows[0].body=JSON.stringify(body);}
   if(fault.kind==='mutation'&&selected[n].sql.includes('FROM collect_level_history WHERE')&&selected[n].sql.startsWith('SELECT json_object'))target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();
  }
  return results;
 }},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>f.now},ids:{next:randomUUID}}),helper=createRecoveryV2LegacyCurrentReconciler({driver,crypto:f.crypto,repository,onMeasure:m=>metrics.push(m)});
 let loaded=await repository.load(f.captured.digest);const c=JSON.parse(loaded.run.checkpoint_json),anchorRow=target.db.prepare('SELECT * FROM app_collection_legacy_mint_anchors').get(),anchor=JSON.parse(anchorRow.body_json);
 // Explicit synthetic prerequisite proof isolates this adapter. This does not
 // establish original-mint semantic recovery or full-profile readiness.
 const digest=await hashJson(f.crypto,['v2-legacy-original-mint',anchor.adoptionId,anchor.ordinal,anchorRow.body_digest,anchor.originalOutcome]);
 assert.equal((await repository.advance(loaded,{delta:{phase:'reconcile-legacy-adoption-current',legacyAdoption:{id:anchor.adoptionId,currentOrdinal:0}},targetWatermark:c.targetWatermark,check:{phase:'legacy-adoption-mint',scope:anchor.adoptionId,ordinal:anchor.ordinal,targetWatermark:c.targetWatermark,resultDigest:digest,itemCount:1}})).kind,'progress');
 const initial=target.checkpoint(),reset=()=>{target.db.prepare("UPDATE app_recovery_runs SET state='restoring',checkpoint_json=?,report_json=NULL WHERE id=?").run(canonicalJson(initial),f.captured.digest);target.db.prepare("UPDATE app_recovery_state SET status='restoring',write_nonce=NULL WHERE active_restore_id=?").run(f.captured.digest);};
 const call=async()=>helper.step(await repository.load(f.captured.digest));
 for(const kind of ['missing-mint-proof','corrupt-owner']){fault.kind=kind;reset();const result=await call();assert.equal(result.kind,'held',JSON.stringify(result));}
 fault.kind='omit-proof';reset();assert.equal((await call()).kind,'conflict');assert.deepEqual(target.checkpoint(),initial);
 fault.kind=null;const result=await call();assert.equal(result.kind,'progress',JSON.stringify(result));assert.equal(target.checkpoint().legacyAdoption.currentOrdinal,1);
 assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-current'").get().n,1);
 assert.equal((await call()).phase,'reconcile-legacy-adoption-closure');assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');
 reset();fault.kind='mutation';assert.equal((await call()).kind,'held');
 assert.ok(metrics.every(m=>m.workingBytes<=1048576&&m.sql<=64));t.diagnostic(JSON.stringify({syntheticPrerequisiteProof:true,fullReadiness:false,maxWorkingBytes:Math.max(...metrics.map(m=>m.workingBytes)),maxSql:Math.max(...metrics.map(m=>m.sql))}));
});
