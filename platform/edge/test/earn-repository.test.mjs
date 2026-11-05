import test from 'node:test';
import assert from 'node:assert/strict';
import { localRuntime } from './local-runtime.mjs';
import { start,command,reviewCommand,seed } from '../../storage/fixtures/atomic-earn.mjs';
import { admissionRequestBytes } from '../../application/commands.mjs';
import { createNodeCrypto } from '../../security/node-crypto.mjs';
async function harness(t,options) {
  const {mf,db}=await localRuntime(t,new URL('./fixtures/atomic-earn-worker.ts',import.meta.url));
  const driver={batch:statements=>db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.values)))};
  await seed(driver,options);
  const call=async(method,command,fault)=>{
    const response=await mf.dispatchFetch('http://localhost/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,command,fault})});
    return {status:response.status,...await response.json()};
  };
  return {db,call};
}
test('workerd/D1 races final slot and identical keys; durable replay survives scope pause',async t=>{
  const {db,call}=await harness(t),c=await command();
  const result=await Promise.all([call('admitSubmission',c),call('admitSubmission',c)]);
  assert.ok(result.every(r=>r.status===200));
  assert.deepEqual(result.map(r=>r.result.kind).sort(),['committed','replayed']);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_submissions').first('n'),1);
  const accepted=result.find(r=>r.result.kind==='committed');
  const measurement=accepted.measurements[0];assert.ok(measurement.maxParameters<=100);assert.ok(measurement.batchBytes<256*1024);
  const full=await call('admitSubmission',await command('w2'));assert.equal(full.result.code,'board_capacity');
  await db.prepare("INSERT INTO ops_scope_log VALUES('r','earn-admission',1,NULL,0,'synthetic','pause','synthetic','pause')").run();
  const replay=await call('admitSubmission',{...c,nowMs:start+86400000});
  assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.receipt,accepted.result.receipt);
  assert.deepEqual(replay.result.value,accepted.result.value);
  const changed={...c,input:{...c.input,url:'https://example.test/change'}};
  changed.requestDigest=await createNodeCrypto().sha256(admissionRequestBytes(changed));
  assert.equal((await call('admitSubmission',changed)).result.code,'idempotency_conflict');
  const review=await reviewCommand(accepted.result.value.submission.id);
  assert.equal((await call('recordFinalReview',review)).result.kind,'committed');
  await db.prepare("UPDATE app_operator_scopes SET enabled=0,revision=1").run();
  assert.equal((await call('recordFinalReview',{...review,nowMs:start+500})).result.kind,'replayed');
  console.log('D1 admission measured',JSON.stringify(measurement));
});
test('workerd/D1 different wallets cannot consume the same final admission slot',async t=>{
  const {db,call}=await harness(t);
  const outcomes=await Promise.all([call('admitSubmission',await command()),call('admitSubmission',await command('w2'))]);
  assert.equal(outcomes.filter(o=>o.result.kind==='committed').length,1);
  assert.equal(await db.prepare('SELECT admitted FROM earn_admission_counts').first('admitted'),1);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),1);
});
test('workerd/D1 final assertion aborts missing child; stale scope and revoked authority leave no receipt',async t=>{
  const {db,call}=await harness(t),c=await command();
  const failed=await call('admitSubmission',c,'skip-child');assert.equal(failed.status,500);assert.match(failed.error,/Missing mandatory submission/);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_submissions').first('n'),0);
  const accepted=await call('admitSubmission',c);
  const review=await reviewCommand(accepted.result.value.submission.id);
  const revoked=await call('recordFinalReview',review,'revoke');assert.equal(revoked.result.code,'revision_conflict');
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_reviews').first('n'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),1);
});
test('workerd/D1 requires explicit staffing and reconciles lost commit response',async t=>{
  const {db,call}=await harness(t,{staffed:false}),c=await command();
  assert.equal((await call('admitSubmission',c)).result.reason,'staffing-required');
  await db.prepare("INSERT INTO earn_workload_policies VALUES('p',?,?,60,60,1,'synthetic','synthetic')").bind(20001,start).run();
  assert.equal((await call('admitSubmission',c,'pause')).result.code,'revision_conflict');
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),0);
  await db.prepare("INSERT INTO ops_scope_log VALUES('unpause','earn-admission',0,'r',1,'synthetic','resume','synthetic','resume')").run();
  assert.equal((await call('admitSubmission',c,'lost-response')).result.kind,'replayed');
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_submissions').first('n'),1);
});
