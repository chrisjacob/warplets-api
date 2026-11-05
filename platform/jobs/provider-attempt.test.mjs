import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createAtomicOperationsRepository} from '../storage/atomic-operations.mjs';
import {createJobCommand} from './model.mjs';
import {createJobRepository} from './repository.mjs';
import {createProviderAttemptExecutor} from './provider-attempt.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'fixture-jobs'};
async function fixture(t){
 const db=openDatabase();t.after(()=>db.close());let now=Date.parse('2026-11-01T00:00:00Z');db.function('fixture_clock',()=>now);
 for(const scope of ['jobs-runner','operations'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,scope);
 const driver={...createNodeAtomicDriver(db),leaseNowSql:'fixture_clock()'},ports={crypto,ids:{next:randomUUID}},clock={nowMs:()=>now};
 const repository=createJobRepository(driver,{...ports,clock,principal}),operations=createAtomicOperationsRepository(driver,ports);
 await repository.enqueue(await createJobCommand({principal,requestKey:'one',nowMs:now,input:{businessKey:'one',sourceKey:'source-one',type:'capture-eligibility',payload:{mode:'synthetic-fixture'},readyMs:now,maxAttempts:5}},crypto));
 const executor=createProviderAttemptExecutor({repository,operations,crypto,clock,principal});
 const acquire=async()=>{const job=(await repository.acquireJob()).job;return {job,lease:job.lease,signal:new AbortController().signal};};
 const config={step:'raw-account',provider:'synthetic-recording',units:'1',quota:'3',evidenceRef:'synthetic-vector',cost:{upperUsdMicros:'0',quoteRef:'recorded-free-fixture'}};
 const enqueue=async key=>repository.enqueue(await createJobCommand({principal,requestKey:key,nowMs:now,input:{businessKey:key,sourceKey:'source-'+key,type:'capture-eligibility',payload:{mode:'synthetic-fixture'},readyMs:now,maxAttempts:5}},crypto));
 return {db,repository,operations,executor,acquire,config,enqueue,advance:()=>now+=30001};
}
test('provider dispatch is metered before call, exact replay cannot resend, failed reads retain quota',async t=>{
 const f=await fixture(t);let calls=0;let context=await f.acquire();
 const read=async()=>{calls++;assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_provider_attempts').get().n,calls);return {byteDigest:'a'.repeat(64)};};
 assert.equal((await f.executor(context,f.config,read)).kind,'completed');
 assert.equal((await f.executor(context,f.config,read)).kind,'replayed');assert.equal(calls,1);
 assert.equal((await f.executor(context,{...f.config,provider:'different-source'},read)).reason,'provider-configuration-conflict');assert.equal(calls,1);
 f.advance();context=await f.acquire();assert.equal((await f.executor(context,f.config,read)).kind,'replayed');assert.equal(calls,1);
 await f.repository.finish(context.lease,{state:'completed',result:{known:true}});await f.enqueue('two');context=await f.acquire();
 await assert.rejects(f.executor(context,f.config,async()=>{calls++;throw Error('recorded transport failure');}),e=>e.effect==='read-only');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_provider_attempts').get().n,2);
 assert.equal((await f.executor(context,f.config,read)).reason,'read-attempt-failed');assert.equal(calls,2);
 f.advance();context=await f.acquire();assert.equal((await f.executor(context,{...f.config,quota:'2'},read)).kind,'pending');assert.equal(calls,2);
 assert.equal((await f.operations.actionDecision('earn-claim',Date.parse('2026-11-02'))).allowed,true);
});
test('unknown costs and durable dispatch interruption block calls; replacement does not reuse dispatch',async t=>{
 const f=await fixture(t),context=await f.acquire();let calls=0;
 assert.equal((await f.executor(context,{...f.config,cost:null},async()=>calls++)).reason,'free-cost-evidence-required');
 const abort=new AbortController();abort.abort();
 assert.equal((await f.executor({...context,signal:abort.signal},f.config,async()=>calls++)).reason,'provider-dispatch-reconciliation');
 assert.equal((await f.executor(context,f.config,async()=>calls++)).reason,'provider-outcome-unknown');assert.equal(calls,0);
 f.advance();const replacement=await f.acquire();assert.equal((await f.executor(replacement,f.config,async()=>calls++)).reason,'provider-outcome-unknown');assert.equal(calls,0);
});
