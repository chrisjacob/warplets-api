import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localRuntime } from './local-runtime.mjs';
import { createNodeCrypto } from '../../security/node-crypto.mjs';
import { createOperationsCommand,createAtomicOperationsRepository,OPERATIONS } from '../../storage/atomic-operations.mjs';
import { createNodeAtomicDriver } from '../../storage/node/atomic-driver.mjs';
import { openDatabase } from '../../storage/database.mjs';
import { verifyConfigChain } from '../../operations/audit.mjs';
const crypto=createNodeCrypto(),jan=Date.parse('2026-01-31T23:59:00Z'),feb=Date.parse('2026-02-01T00:01:00Z');
const principal={kind:'operator',id:'fixture-operator'};
const command=(method,key,input,nowMs=jan)=>createOperationsCommand(OPERATIONS[method],{principal,requestKey:key,input,nowMs},crypto);
async function fixture(t){
 const {mf,db}=await localRuntime(t,new URL('./fixtures/operations-worker.ts',import.meta.url));
 await db.prepare("INSERT INTO app_operator_scopes VALUES('fixture-operator','operations',0,1)").run();
 const call=body=>mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify(body)});
 const result=async body=>{const response=await call(body);assert.equal(response.status,200,await response.clone().text());return (await response.json()).result;};
 return {db,call,result};
}
test('real D1 operations match Node scope/staffing hashes and atomic cost/attempt month boundaries',async t=>{
 const {db,result}=await fixture(t),node=openDatabase();t.after(()=>node.close());
 node.exec("INSERT INTO app_operator_scopes VALUES('fixture-operator','operations',0,1)");
 const reference=createAtomicOperationsRepository(createNodeAtomicDriver(node),{crypto,ids:{next:randomUUID}});
 const cases=[['changeScope','scope',{scope:'optional-refresh',paused:true,previousRevision:null,reason:'fixture pause',evidenceRef:'fixture evidence'}],
 ['configureWorkload','staff',{effectiveEpoch:Math.floor(jan/86400000),staffedMinutes:2,secondsPerReview:30,admissionLimit:5,reason:'fixture staffing'}]];
 for(const [method,key,input] of cases){
  const c=await command(method,key,input),actual=await result({method,command:c}),expected=await reference[method](c);
  assert.equal(actual.kind,'committed');assert.deepEqual(actual.value,expected.value);
 }
 assert.equal((await result({method:'capacityAt',epoch:Math.floor(jan/86400000),nowMs:jan})).limit,4);
 assert.equal((await result({method:'actionDecision',scope:'optional-refresh',nowMs:jan})).reason,'operator-pause');
 assert.equal((await result({method:'actionDecision',scope:'vault-claim',nowMs:jan})).allowed,true);
 assert.deepEqual(await db.prepare('SELECT event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1').first('event_hash'),verifyConfigChain(node).head);
 const input={scope:'optional-notifications',upperUsdMicros:'3000000',quoteRef:'fixture quote'};
 const commands=await Promise.all(['one','two'].map(key=>command('reserveOptionalCost',key,input)));
 const outcomes=await Promise.all(commands.map(c=>result({method:'reserveOptionalCost',command:c})));
 assert.equal(outcomes.filter(row=>row.kind==='committed').length,1);
 const accepted=commands[outcomes.findIndex(row=>row.kind==='committed')];
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ops_optional_spend').first('n'),1);
 assert.equal((await result({method:'costPressure',nowMs:feb})).recurring.totalUsdMicros,'3000000');
 assert.equal((await result({method:'reserveOptionalCost',command:await command('reserveOptionalCost','three',input,feb)})).reason,'monthly-ceiling');
 const settlement=await command('settleOptionalCost','settle',{reservationKey:accepted.requestKey,actualUsdMicros:'4000000',evidenceRef:'fixture actual'},feb);
 assert.equal((await result({method:'settleOptionalCost',command:settlement})).value.overrun,true);
 assert.equal((await result({method:'settleOptionalCost',command:{...settlement,nowMs:feb+1}})).kind,'replayed');
 assert.equal((await result({method:'costPressure',nowMs:feb+1})).recurring.totalUsdMicros,'4000000');
 const attempt={provider:'fixture-provider',units:'1',quota:'2',evidenceRef:'fixture failed call'};
 for(let i=1;i<=2;i++){
  const c=await command('meterProviderAttempt','meter-'+i,{...attempt,attemptId:'attempt-'+i},feb+i);
  assert.equal((await result({method:'meterProviderAttempt',command:c})).value.measured,String(i));
  assert.equal((await result({method:'meterProviderAttempt',command:{...c,nowMs:feb+100}})).kind,'replayed');
 }
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_provider_attempts').first('n'),2);
 assert.equal((await result({method:'meterProviderAttempt',command:await command('meterProviderAttempt','meter-three',{...attempt,attemptId:'attempt-three'},feb+3)})).reason,'provider-quota');
 assert.equal((await result({method:'actionDecision',scope:'earn-admission',nowMs:feb+3})).reason,'budget-limit');
 assert.equal((await result({method:'actionDecision',scope:'reconciliation',nowMs:feb+3})).allowed,true);
 await db.prepare("UPDATE app_operator_scopes SET enabled=0,revision=revision+1").run();
 assert.equal((await result({method:'reserveOptionalCost',command:{...accepted,nowMs:feb+200}})).kind,'replayed');
 assert.equal((await result({method:'costPressure',nowMs:Date.parse('2026-03-01T00:00:00Z')})).recurring.totalUsdMicros,'0');
});
test('real D1 drops all partial operating effects and reconciles a lost acknowledgement',async t=>{
 const {db,call,result}=await fixture(t);
 const c=await command('changeScope','partial',{scope:'earn-admission',paused:true,previousRevision:null,reason:'fixture',evidenceRef:'fixture'});
 const failure=await call({method:'changeScope',command:c,fault:'skip-child'});
 assert.equal(failure.status,500);assert.match(await failure.text(),/Missing scope or audit/);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ops_scope_log').first('n'),0);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),0);
 const meter=await command('meterProviderAttempt','partial-meter',{provider:'fixture',attemptId:'partial',units:'1',quota:'10',evidenceRef:'fixture'});
 assert.equal((await call({method:'meterProviderAttempt',command:meter,fault:'skip-child'})).status,500);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ops_usage').first('n'),0);
 const reserve=await command('reserveOptionalCost','lost',{scope:'optional-notifications',upperUsdMicros:'10',quoteRef:'fixture'});
 assert.equal((await result({method:'reserveOptionalCost',command:reserve,fault:'lost-response'})).kind,'replayed');
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ops_optional_spend').first('n'),1);
});
test('real D1 scope, cost, staffing and authority races recompute before any accepted write',async t=>{
 for(const fault of ['scope','cost','staff','revoke']){
  await t.test(fault,async t=>{
   const {db,result}=await fixture(t);
   const c=await command('reserveOptionalCost','race-command',{scope:'optional-notifications',upperUsdMicros:'200000',quoteRef:'fixture'});
   const outcome=await result({method:'reserveOptionalCost',command:c,fault});
   if(fault==='staff')assert.equal(outcome.kind,'committed','unrelated staffing revision is safely recomputed');
   else if(fault==='scope')assert.equal(outcome.reason,'operator-pause');
   else if(fault==='cost')assert.equal(outcome.reason,'monthly-ceiling');
   else assert.equal(outcome.code,'operator_scope_required');
   assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),fault==='staff'?1:0);
   assert.equal(await db.prepare("SELECT COUNT(*) n FROM ops_optional_spend WHERE request_key='race-command'").first('n'),fault==='staff'?1:0);
  });
 }
});
