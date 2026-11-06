import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {recoveryReadFixture,recoveryReadTables} from '../../transactions/recovery-read.fixtures.mjs';
import {createActionRecoveryReadRepository} from '../../transactions/recovery-reads.mjs';
import {localRuntime} from './local-runtime.mjs';
test('actual workerd/D1 preserves unsigned recovery guidance, bounded complete history and unknown no-replacement',async t=>{
 const runtime=await localRuntime(t,new URL('./fixtures/action-recovery-worker.ts',import.meta.url));let maxBytes=0,maxResultBytes=0,maxRows=0;
 for(const options of [{state:'validated'},{state:'attempt_expired',attemptCount:2},{state:'unknown',attemptCount:16,receiptCount:64},{state:'finalized'}]){
  const node=openDatabase();try{
   const f=await recoveryReadFixture(node,options),source=f.dump();for(const table of [...recoveryReadTables].reverse())await runtime.db.prepare('DELETE FROM '+table).run();
   // Copy exact local legacy rows, including receipt rowids. Synthetic signatures
   // are retained labels only; no signing, simulation or external submission.
   for(const table of recoveryReadTables)for(const row of source[table])await runtime.db.prepare('INSERT INTO '+table+' ('+Object.keys(row).join(',')+') VALUES ('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row)).run();
   const call=async(extra={})=>{const r=await runtime.mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify({wallet:f.owner,intentId:f.intent.id,nowMs:f.now,...extra})});assert.equal(r.status,200,await r.clone().text());return r.json();};
   const expected=await createActionRecoveryReadRepository(createNodeAtomicDriver(node),{crypto:createNodeCrypto(),clock:{nowMs:()=>f.now}}).readRecovery({kind:'wallet',wallet:f.owner},{intentId:f.intent.id}),actual=await call();assert.deepEqual(actual.result,expected);assert.equal(actual.result.kind,'ready');assert.equal(actual.measurement.changes,0);assert.equal(actual.measurement.measures.reduce((n,m)=>n+m.statements,0),8);assert.equal(actual.measurement.measures.length,2);assert.ok(!JSON.stringify(actual.result).includes(f.signature));assert.doesNotMatch(JSON.stringify(actual.result),/"packet"|messageBase64|instructions|"signature"|simulation_ref/);assert.deepEqual((await call({wallet:f.other})).result,{kind:'not-found'});
   maxBytes=Math.max(maxBytes,...actual.measurement.measures.map(m=>m.batchBytes));maxResultBytes=Math.max(maxResultBytes,actual.measurement.resultBytes);maxRows=Math.max(maxRows,actual.measurement.rows);
   if(options.state==='unknown'){assert.equal(actual.result.value.replacementEligible,false);assert.equal(actual.result.value.nextLocalTransition,'reconcile-existing-attempt');assert.equal(actual.result.value.receiptObservations.length,64);assert.deepEqual(actual.result.value.receiptObservations.map(r=>r.eventId),source.tx_receipts.map(r=>r.event_id));assert.equal((await call({nowMs:f.plan.expiresMs+1})).result.value.nextLocalTransition,'reconcile-existing-attempt');const race=await call({fault:'source-race'});assert.equal(race.raced,true);assert.deepEqual(race.result,{kind:'pending',reason:'snapshot-changed'});await runtime.db.prepare("UPDATE tx_receipts SET state='finalized' WHERE rowid=1").run();assert.equal((await call()).result.kind,'pending');}
   if(options.state==='attempt_expired'){assert.equal(actual.result.value.replacementEligible,true);assert.equal((await call({nowMs:f.plan.expiresMs})).result.value.replacementEligible,false);}
  }finally{node.close();}
 }
 t.diagnostic(JSON.stringify({profiles:4,maxAttempts:16,maxReceipts:64,statements:8,maxBatchBytes:maxBytes,maxResultBytes,maxRows,signing:false,broadcast:false,provenance:'legacy-recorded-unverified'}));
});
