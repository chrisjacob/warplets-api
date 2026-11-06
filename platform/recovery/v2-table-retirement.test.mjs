import {parseRecoveryV2Checkpoint,packRecoveryV2CheckpointDelta} from './v2-checkpoint.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {v2RestoreSource,v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const clone=value=>JSON.parse(canonicalJson(value));
const expanded=target=>parseRecoveryV2Checkpoint(canonicalJson(target.checkpoint()));
const stored=c=>Array.isArray(c.tables)?{...c,...packRecoveryV2CheckpointDelta({tables:c.tables})}:c;
const size=value=>utf8(canonicalJson(value)).length;
function reset(target,c,{legacyTables=false}={}){target.db.prepare("UPDATE app_recovery_runs SET state='restoring',checkpoint_json=?,report_json=NULL WHERE id=?").run(canonicalJson(legacyTables?c:stored(c)),target.input.pinnedDigest);target.db.prepare("UPDATE app_recovery_state SET status='restoring' WHERE active_restore_id=?").run(target.input.pinnedDigest);}
const step=(target,c)=>target.service.step({...target.input,expectedRevision:c.revision});

test('reconciled table descriptors retire only with complete exact durable proofs and old checkpoints resume',async t=>{
 const source=await v2RestoreSource(t,{jobs:false}),target=v2RestoreTarget(t,source);let result=await target.call('start'),missing=null,complete=null,steps=0;const peaks={};
 while(steps++<3000){const c=expanded(target);peaks[c.phase]=Math.max(peaks[c.phase]??0,size(target.checkpoint()));if(c.phase==='reconcile-tables'&&c.tableIndex===c.root.tables.count-1&&!missing){missing=clone(c);const forged={...c,tableIndex:c.root.tables.count,checkedTables:c.root.tables.count};reset(target,forged);assert.equal((await step(target,forged)).kind,'held','fabricated complete count without final durable table proof');reset(target,c);}if(c.phase==='reconcile-tables'&&c.tableIndex===c.root.tables.count){complete=clone(c);break;}result=await target.call('step');assert.ok(['progress','replayed'].includes(result.kind),JSON.stringify(result));}
 assert.ok(missing&&complete);const count=complete.root.tables.count;
 const wrong=[['descriptor-count',()=>({...complete,checkedTableDescriptors:count-1})],['checked-count',()=>({...complete,checkedTables:count-1})],['table-index',()=>({...complete,tableIndex:count+1})],['descriptor-proof',()=>{const c=clone(complete);c.tables[0].tableDigest='0'.repeat(64);return c;}]];
 for(const [name,make] of wrong){const c=make();reset(target,c);const rejected=await step(target,c);assert.equal(rejected.kind,'held',name+': '+JSON.stringify(rejected));assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'held');}
 reset(target,complete);const original=target.driver.batch;let omit=true,omitted=false,hideProof=false;
 target.driver.batch=async statements=>{if(omit&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='table-inventory')){omitted=true;return original(statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='table-inventory')));}const rows=await original(statements);return hideProof?rows.map((r,i)=>statements[i].sql.includes("phase='table-inventory' AND scope='complete'")?{...r,rows:[]}:r):rows;};
 const failed=await step(target,complete);assert.equal(failed.kind,'conflict');assert.equal(omitted,true);assert.deepEqual(expanded(target),complete);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='table-inventory'").get().n,0);assert.equal(target.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
 omit=false;result=await step(target,complete);assert.equal(result.phase,'reconcile-audit');let retired=target.checkpoint();assert.equal(retired.tables,null);assert.ok(size(retired)<size(complete)-35000);
 const accepted=clone(retired),legacy={...retired,tables:complete.tables};reset(target,legacy,{legacyTables:true});result=await step(target,legacy);assert.equal(result.kind,'progress');assert.equal(result.phase,'reconcile-audit');assert.equal(target.checkpoint().tables,null);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='table-inventory'").get().n,1);
 const replay=await step(target,legacy);assert.equal(replay.kind,'replayed');
 while(steps++<4000){const c=expanded(target);peaks[c.phase]=Math.max(peaks[c.phase]??0,size(target.checkpoint()));assert.equal(c.tables,null);if(c.phase==='reconcile-final'){const forged={...c,checkedTables:count-1};reset(target,forged);assert.equal((await step(target,forged)).kind,'held');reset(target,c);hideProof=true;assert.equal((await step(target,c)).kind,'held');hideProof=false;reset(target,c);}result=await step(target,c);if(result.kind==='restored')break;assert.ok(['progress','replayed'].includes(result.kind),JSON.stringify(result));}
 assert.equal(result.kind,'restored');assert.equal(result.report.tables,count);assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');assert.ok(Math.max(...Object.values(peaks))<=131072);assert.ok(target.metrics.every(m=>m.sql+m.objectReads+m.objectWrites<=64&&m.maxBatchBytes<=262144));
 t.diagnostic(JSON.stringify({tables:count,steps,descriptorBytes:size(complete.tables),beforeBytes:size(complete),afterBytes:size(accepted),finalBytes:size(target.checkpoint()),peaks,rejected:['fabricated-complete-count',...wrong.map(([name])=>name)],omittedProofRolledBack:true,finalMissingProofHeld:true,legacyPostTableResume:true,limitsUnchanged:true}));
});
