import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {command,reviewCommand,seed} from '../../storage/fixtures/atomic-earn.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {orderedJson,utf8} from '../../security/canonical.mjs';

test('local D1 final-review audit is mandatory, atomic and retained once after lost acknowledgement',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/atomic-earn-worker.ts',import.meta.url));
 await seed({batch:statements=>db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.values)))});
 const call=async(method,command,fault)=>{const response=await mf.dispatchFetch('http://localhost/command',{method:'POST',body:JSON.stringify({method,command,fault})});return {status:response.status,...await response.json()};};
 const admitted=await call('admitSubmission',await command()),review=await reviewCommand(admitted.result.value.submission.id);
 for(const fault of ['skip-audit','alter-audit']){
  const result=await call('recordFinalReview',review,fault);assert.equal(result.status,500);assert.match(result.error,/Missing exact final review audit/);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_reviews').first('n'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM ops_config_audit').first('n'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),1);
 }
 const accepted=await call('recordFinalReview',review,'lost-response');assert.equal(accepted.result.kind,'replayed');
 const replay=await call('recordFinalReview',review);assert.deepEqual(replay.result.receipt,accepted.result.receipt);
 const rows=(await db.prepare('SELECT * FROM ops_config_audit').all()).results;assert.equal(rows.length,1);
 const a=rows[0];assert.equal(a.category,'final-review');assert.equal(a.actor,review.principal.id);assert.equal(a.entity,review.input.submissionId);
 assert.equal(JSON.parse(a.payload).requestDigest,review.requestDigest);
 assert.equal(a.event_hash,await createNodeCrypto().sha256(utf8(orderedJson(['10x-local-config-audit-v1',a.seq,a.previous_hash,a.category,a.entity,a.change_key,a.recorded_ms,a.actor,a.evidence_ref,JSON.parse(a.payload)]))));
});
