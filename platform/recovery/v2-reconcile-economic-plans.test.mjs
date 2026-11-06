import test from 'node:test';
import assert from 'node:assert/strict';
import {economicPlanFixture,economicPlanRequest} from '../storage/economic-plans.fixtures.mjs';
import {verifyRecoveredEconomicPreparation} from './v2-reconcile-economic-plans.mjs';
const kind='transactions.prepare-economic-plan.v1';
async function setup(t){const f=await economicPlanFixture(t),accepted=await f.repo.prepare(economicPlanRequest());assert.equal(accepted.kind,'committed',JSON.stringify(accepted));return {...f,accepted,read:async s=>(await f.driver.batch(s)).map(v=>v.rows),receipt:()=>f.db.prepare('SELECT * FROM app_command_receipts WHERE operation_kind=? ORDER BY rowid LIMIT 1').get(kind)};}
test('accepted original economic preparation rederives historical quote after expiry, market edits and head removal',async t=>{
 const f=await setup(t),meter=[],ports={read:f.read,artifacts:f.store,crypto:f.crypto,onWorking:n=>meter.push(n)};let proof=await verifyRecoveredEconomicPreparation(f.receipt(),ports);assert.equal(proof.preparationId,f.accepted.value.preparationId);
 f.setNow(f.nowMs+86400000);f.db.prepare("UPDATE market_fixtures SET body=json_set(body,'$.symbol','NEW DISPLAY','$.poolAddress','new-current-pool')").run();f.db.prepare('DELETE FROM app_evidence_heads').run();assert.deepEqual(await verifyRecoveredEconomicPreparation(f.receipt(),ports),proof);assert.equal((await f.repo.prepare(economicPlanRequest())).kind,'replayed');
 assert.ok(Math.max(...meter)<=1048576);t.diagnostic(JSON.stringify({historicalTime:true,currentHeadIndependent:true,estimatedSemanticWorkingBytes:Math.max(...meter)}));
});
test('economic preparation receipt, original private object and stored quote tampering fail closed',async t=>{
 const f=await setup(t),ports={read:f.read,artifacts:f.store,crypto:f.crypto};
 for(const field of ['request_digest','business_key','principal_key','output_digest','result_ref','expected_revisions'])await assert.rejects(verifyRecoveredEconomicPreparation({...f.receipt(),[field]:'invalid'},ports));
 const objects=new Map(f.store.objects);f.store.objects.clear();await assert.rejects(verifyRecoveredEconomicPreparation(f.receipt(),ports),/historical source/);for(const [k,v]of objects)f.store.objects.set(k,v);
 for(const mutate of [rows=>{rows[0][0].plan_json=rows[0][0].plan_json.replace('"broadcast":false','"broadcast":true');},rows=>{rows[0][0].wallet='different';}]){let once=false;await assert.rejects(verifyRecoveredEconomicPreparation(f.receipt(),{...ports,read:async statements=>{const rows=await f.read(statements);if(!once){once=true;mutate(rows);}return rows;}}));}
 await assert.rejects(verifyRecoveredEconomicPreparation(f.receipt(),{...ports,read:async statements=>{const rows=await f.read(statements);if(statements[0].sql.includes('FROM app_quote_bindings'))rows[0][0].body_json='{}';return rows;}}));
});

import {randomUUID} from 'node:crypto';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
async function capturedFixture(t){const f=await setup(t),r=economicPlanRequest();assert.equal((await f.repo.prepare({...r,requestKey:'same-plan-new-key'})).kind,'committed');const other=structuredClone(r);other.requestKey='new-fee-review';other.request.maximumFeeUnits='9999';assert.equal((await f.repo.prepare(other)).kind,'committed');
 f.setNow(f.nowMs+86400000);f.db.prepare("UPDATE market_fixtures SET body=json_set(body,'$.symbol','Changed after review','$.poolAddress','current-different-pool')").run();f.db.prepare('DELETE FROM app_evidence_heads').run();f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();
 const ports={...f,ids:{next:randomUUID},now:f.nowMs+86400000,schema:await readInstalledRecoverySchema(f.crypto),v2Codec:createRecoveryV2Codec(f),codec:createManifestCodec(f)},capture=createRecoveryV2Capture({...ports,artifacts:f.store});let captured=await capture.start({captureId:'synthetic-economic-source',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<3000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));return {...ports,captured};}
test('normal fresh private V2 restore verifies accepted original plans at quoted time and retains exact deduplicated receipts',async t=>{
 const f=await capturedFixture(t),target=v2RestoreTarget(t,f,{faults:['lost-final-ack']});let result=await target.drive({stopPhase:'reconcile-economic-preparations'});assert.equal(result.phase,'reconcile-economic-preparations');
 const originalBatch=target.driver.batch;let omit=true,lose=true;target.driver.batch=async statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='economic-preparation')){if(omit){omit=false;return originalBatch(statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')));}const out=await originalBatch(statements);if(lose){lose=false;throw Error('Synthetic lost economic proof acknowledgement');}return out;}return originalBatch(statements);};
 result=await target.call('step');assert.equal(result.kind,'conflict');assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='economic-preparation'").get().n,0);result=await target.call('step');assert.equal(result.kind,'replayed');assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='economic-preparation'").get().n,1);
 result=await target.drive();assert.equal(result.kind,'restored',JSON.stringify(result));
 assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='economic-preparation'").get().n,3);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM app_economic_preparations').get().n,2);
 for(const table of ['app_economic_intents','app_economic_preparations'])assert.deepEqual(target.db.prepare('SELECT * FROM '+table+' ORDER BY id').all(),f.db.prepare('SELECT * FROM '+table+' ORDER BY id').all());
 assert.ok(target.metrics.every(m=>m.sql<=64&&m.maxBatchBytes<=262144));assert.equal(target.checkpoint().economicPreparationsComplete,true);assert.equal((await target.service.finish(target.input)).kind,'restored');
 t.diagnostic(JSON.stringify({tables:result.report.tables,steps:target.metrics.length,maxSql:Math.max(...target.metrics.map(m=>m.sql)),maxBatchBytes:Math.max(...target.metrics.map(m=>m.maxBatchBytes)),receiptChecks:3,preparations:2,financialExecution:false}));
});
test('semantic continuation cannot accept missing private bytes or stale target watermark',async t=>{
 const f=await capturedFixture(t);
 for(const fault of ['private-loss','watermark']){const target=v2RestoreTarget(t,f);let result=await target.drive({stopPhase:'reconcile-economic-preparations'});assert.equal(result.phase,'reconcile-economic-preparations');
  if(fault==='private-loss'){const key=target.db.prepare('SELECT object_key FROM app_evidence_receipts LIMIT 1').get().object_key;target.store.objects.delete(key);}else{const original=target.driver.batch;let changed=false;target.driver.batch=async statements=>{if(!changed&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='economic-preparation')){changed=true;target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return original(statements);};}
  result=await target.call('step');assert.notEqual(result.kind,'restored');assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='economic-preparation'").get().n,0);assert.notEqual(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');
 }
});
