import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recoveryLegacyAdoptionSource} from './v2-legacy-adoption-fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
import {createRecoveryV2LegacyAggregateReconciler} from './v2-reconcile-legacy-aggregate.mjs';
import {canonicalJson} from '../security/canonical.mjs';

for(const profile of ['whitelist','empty'])test(`actual ${profile} adoption proof aggregation rejects omitted or altered evidence before atomic completion`,async t=>{
 const f=await recoveryLegacyAdoptionSource(t,{...(profile==='empty'?{profile}:{}),settleAll:true}),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});
 const reached=await target.drive({stopPhase:'reconcile-legacy-adoption-aggregate'});assert.equal(reached.phase,'reconcile-legacy-adoption-aggregate',JSON.stringify(reached));
 const fault={kind:null,hit:false},metrics=[];
 const driver={...target.driver,async batch(statements){
  const selected=fault.kind==='omit-complete'?statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-complete')):statements;
  const results=await target.driver.batch(selected);
  for(let n=0;n<selected.length;n++){
   const s=selected[n].sql,r=results[n];
   if(s.includes('ORDER BY')&&/LIMIT (8|32)$/.test(s)&&r.rows.length){
    if(fault.kind==='missing-row')results[n]={...r,rows:r.rows.slice(1)};
    if(fault.kind==='wrong-proof')results[n]={...r,rows:r.rows.map((p,i)=>i? p:{...p,result_digest:'0'.repeat(64)})};
    if(fault.kind==='wrong-control'&&s.includes('control_digest'))results[n]={...r,rows:r.rows.map((p,i)=>i?p:{...p,control_digest:'0'.repeat(64)})};
    if(fault.kind==='changed-target')target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();
   }
   if(fault.kind==='missing-completion'&&s.includes("phase IN ('legacy-adoption-economics-complete'"))results[n]={...r,rows:r.rows.slice(1)};
  }
  if(fault.kind==='lost-ack'&&selected.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-complete')){fault.hit=true;throw Error('Synthetic lost adoption completion acknowledgement');}
  return results;
 }},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>f.now},ids:{next:randomUUID}}),helper=createRecoveryV2LegacyAggregateReconciler({driver,crypto:f.crypto,repository,onMeasure:m=>metrics.push(m)});
 const step=async()=>helper.step(await repository.load(f.captured.digest)),reset=c=>{target.db.prepare("UPDATE app_recovery_runs SET state='restoring',checkpoint_json=?,report_json=NULL WHERE id=?").run(canonicalJson(c),f.captured.digest);target.db.prepare("UPDATE app_recovery_state SET status='restoring',write_nonce=NULL WHERE active_restore_id=?").run(f.captured.digest);};
 const initial=target.checkpoint();
 for(let family=0;family<5;family++){
  const before=target.checkpoint();assert.equal(before.legacyAdoption.aggregate?.family??0,family);
  if(profile!=='empty')for(const kind of ['missing-row','wrong-proof',...(family===1?['wrong-control']:[])]){fault.kind=kind;const held=await step();assert.equal(held.kind,'held',JSON.stringify({family,kind,held}));reset(before);}
  fault.kind=null;const progress=await step();assert.equal(progress.kind,'progress',JSON.stringify(progress));
 }
 const finish=target.checkpoint();assert.equal(finish.legacyAdoption.aggregate.family,5);
 fault.kind='missing-completion';assert.equal((await step()).kind,'held');reset(finish);
 fault.kind='omit-complete';assert.equal((await step()).kind,'conflict');assert.deepEqual(target.checkpoint(),finish);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-complete'").get().n,0);
 fault.kind='lost-ack';assert.equal((await step()).kind,'replayed');assert.equal(fault.hit,true);assert.equal(target.checkpoint().phase,'reconcile-legacy-adoptions');assert.equal(target.checkpoint().legacyAdoption,null);assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');
 if(profile!=='empty'){reset(initial);fault.kind='changed-target';const held=await step();assert.equal(held.kind,'held');assert.match(held.reason,/target-changed/);}
 assert.ok(metrics.every(m=>m.operationAllowance<=64&&m.workingBytes<=1048576&&m.maxBatchBytes<=262144));t.diagnostic(JSON.stringify({profile,genuineUpstreamProofs:true,normalPipeline:true,readiness:false,maxOperations:Math.max(...metrics.map(m=>m.operationAllowance)),maxWorkingBytes:Math.max(...metrics.map(m=>m.workingBytes)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes))}));
});

test('nine genuine original admissions cross the bounded mint-proof page and resume from its durable prefix',async t=>{
 const f=await recoveryLegacyAdoptionSource(t,{count:9,settleAll:true}),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});
 const reached=await target.drive({stopPhase:'reconcile-legacy-adoption-aggregate'});assert.equal(reached.phase,'reconcile-legacy-adoption-aggregate',JSON.stringify(reached));
 const repository=createRecoveryV2RestoreDatabase({driver:target.driver,clock:{nowMs:()=>f.now},ids:{next:randomUUID}}),metrics=[];
 // Recreate the helper for every step; only the durable checkpoint carries state.
 const step=async()=>createRecoveryV2LegacyAggregateReconciler({driver:target.driver,crypto:f.crypto,repository,onMeasure:m=>metrics.push(m)}).step(await repository.load(f.captured.digest));
 assert.equal((await step()).kind,'progress');assert.equal(target.checkpoint().legacyAdoption.aggregate.family,1);
 assert.equal((await step()).kind,'progress');let c=target.checkpoint();assert.equal(c.legacyAdoption.aggregate.family,1);assert.equal(c.legacyAdoption.aggregate.index,8);
 assert.equal((await step()).kind,'progress');assert.equal(target.checkpoint().legacyAdoption.aggregate.family,2);
 for(let n=0;n<4;n++)assert.equal((await step()).kind,'progress');
 assert.equal(target.checkpoint().phase,'reconcile-legacy-adoptions');assert.equal(target.db.prepare("SELECT item_count FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-complete'").get().item_count,9);
 assert.ok(metrics.every(m=>m.operationAllowance<=64&&m.workingBytes<=1048576&&m.maxBatchBytes<=262144));t.diagnostic(JSON.stringify({genuineOriginalMints:9,mintPageSize:8,maxWorkingBytes:Math.max(...metrics.map(m=>m.workingBytes)),maxOperations:Math.max(...metrics.map(m=>m.operationAllowance))}));
});

test('all32 genuine imported stage proofs fit the distinct stage page before adoption completion',async t=>{
 const f=await recoveryLegacyAdoptionSource(t,{count:0,stageCount:32}),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});
 const reached=await target.drive({stopPhase:'reconcile-legacy-adoption-aggregate'});assert.equal(reached.phase,'reconcile-legacy-adoption-aggregate',JSON.stringify(reached));assert.equal(target.checkpoint().legacyAdoption.stageIndex,32);
 const repository=createRecoveryV2RestoreDatabase({driver:target.driver,clock:{nowMs:()=>f.now},ids:{next:randomUUID}}),metrics=[],helper=createRecoveryV2LegacyAggregateReconciler({driver:target.driver,crypto:f.crypto,repository,onMeasure:m=>metrics.push(m)});
 const step=async()=>helper.step(await repository.load(f.captured.digest));let result=await step();assert.equal(result.kind,'progress',JSON.stringify(result));assert.equal(target.checkpoint().legacyAdoption.aggregate.family,1);
 for(let n=0;n<5;n++){result=await step();assert.equal(result.kind,'progress',JSON.stringify(result));}
 assert.equal(target.checkpoint().phase,'reconcile-legacy-adoptions');assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption' AND scope LIKE 'stage:%'").get().n,32);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-complete'").get().n,1);
 assert.ok(metrics.every(m=>m.operationAllowance<=64&&m.workingBytes<=1048576));t.diagnostic(JSON.stringify({genuineStages:32,stagePageSize:32,maxOperations:Math.max(...metrics.map(m=>m.operationAllowance)),maxWorkingBytes:Math.max(...metrics.map(m=>m.workingBytes))}));
});
