import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database.mjs';
import { createNodeAtomicDriver } from './node/atomic-driver.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
import { createAtomicOperationsRepository,createOperationsCommand,OPERATIONS } from './atomic-operations.mjs';
import { changeScope,costPressure } from '../operations/controls.mjs';
import { configureWorkload } from '../earn/operations.mjs';
import { verifyConfigChain } from '../operations/audit.mjs';
const crypto=createNodeCrypto(),jan=Date.parse('2026-01-31T23:59:00Z'),feb=Date.parse('2026-02-01T00:01:00Z');
const principal={kind:'operator',id:'fixture-operator'},ports={crypto,ids:{next:randomUUID}};
const command=(method,key,input,nowMs=jan,expectedRevisions={})=>createOperationsCommand(OPERATIONS[method],{principal,requestKey:key,input,nowMs,expectedRevisions},crypto);
function fixture(t){
 const db=openDatabase();t.after(()=>db.close());db.exec("INSERT INTO app_operator_scopes VALUES('fixture-operator','operations',0,1)");
 const driver=createNodeAtomicDriver(db);return {db,driver,repo:createAtomicOperationsRepository(driver,ports)};
}

test('receipt attempt nonce identifies one winner when trigger-inclusive mutation counts differ by runtime',async t=>{
 const {db,driver}=fixture(t),inclusive={...driver,async batch(statements){return (await driver.batch(statements)).map(result=>({...result,changes:result.changes?result.changes+7:0}));}};
 const make=nonce=>{let step=0;return createAtomicOperationsRepository(inclusive,{crypto,ids:{next:()=>step++===0?'synthetic-shared-operation':nonce}});};
 const c=await command('changeScope','synthetic-trigger-count',{scope:'earn-admission',paused:true,previousRevision:null,reason:'synthetic count parity',evidenceRef:'synthetic'});
 const outcomes=await Promise.all([make('synthetic-attempt-a').changeScope(c),make('synthetic-attempt-b').changeScope(c)]);
 assert.deepEqual(outcomes.map(o=>o.kind).sort(),['committed','replayed']);assert.deepEqual(outcomes[0].receipt,outcomes[1].receipt);assert.deepEqual(outcomes[0].value,outcomes[1].value);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_scope_log').get().n,1);
});
test('portable scope and workload preserve exact legacy revisions/audit hashes; retry survives revocation',async t=>{
 const {db,repo}=fixture(t),legacy=openDatabase();t.after(()=>legacy.close());
 const scope={scope:'earn-admission',paused:true,previousRevision:null,reason:'fixture pause',evidenceRef:'fixture evidence'};
 const change=await command('changeScope','pause',scope),result=await repo.changeScope(change);
 assert.equal(result.kind,'committed');
 const expected=changeScope(legacy,{...scope,atMs:jan,actor:principal.id,requestKey:'pause'});
 assert.deepEqual(result.value,expected);
 const workload={effectiveEpoch:Math.floor(jan/86400000),staffedMinutes:5,secondsPerReview:30,admissionLimit:12,reason:'fixture staffing'};
 const staffed=await repo.configureWorkload(await command('configureWorkload','staff',workload,jan+1));
 assert.equal(staffed.kind,'committed');
 assert.deepEqual(staffed.value,configureWorkload(legacy,{...workload,atMs:jan+1,operator:principal.id}));
 assert.deepEqual(verifyConfigChain(db),verifyConfigChain(legacy));
 assert.equal((await repo.capacityAt(workload.effectiveEpoch,jan+1)).limit,10);
 db.exec("UPDATE app_operator_scopes SET enabled=0,revision=revision+1");
 assert.equal((await repo.changeScope({...change,nowMs:feb})).kind,'replayed');
 assert.equal((await repo.configureWorkload(await command('configureWorkload','other',{...workload,effectiveEpoch:Math.floor(feb/86400000)},feb))).code,'operator_scope_required');
 for(const protectedScope of ['principal-withdrawal','stake-harvest','vault-claim','earn-claim','reconciliation','operation-recovery']){
  assert.equal((await repo.actionDecision(protectedScope,feb)).allowed,true);
  await assert.rejects(repo.changeScope(await command('changeScope','bad-'+protectedScope,{...scope,scope:protectedScope},feb)));
 }
});
test('bounded cost reservations race safely, carry across months, replay after pause and settle in actual month',async t=>{
 const {db,repo}=fixture(t),input={scope:'optional-notifications',upperUsdMicros:'3000000',quoteRef:'fixture quote'};
 const one=await command('reserveOptionalCost','one',input),two=await command('reserveOptionalCost','two',input);
 const results=await Promise.all([repo.reserveOptionalCost(one),repo.reserveOptionalCost(two)]);
 assert.equal(results.filter(row=>row.kind==='committed').length,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_optional_spend').get().n,1);
 const accepted=results.find(row=>row.kind==='committed').value.requestKey;
 assert.equal((await repo.costPressure(feb)).recurring.totalUsdMicros,'3000000');
 assert.equal((await repo.reserveOptionalCost(await command('reserveOptionalCost','three',input,feb))).reason,'monthly-ceiling');
 await repo.changeScope(await command('changeScope','pause',{scope:input.scope,paused:true,previousRevision:null,reason:'fixture pause',evidenceRef:'fixture'},feb));
 assert.equal((await repo.reserveOptionalCost({...(accepted==='one'?one:two),nowMs:feb+1})).kind,'replayed');
 const settle=await command('settleOptionalCost','settle',{reservationKey:accepted,actualUsdMicros:'4000000',evidenceRef:'fixture actual'},feb+1);
 assert.equal((await repo.settleOptionalCost(settle)).value.overrun,true);
 assert.equal((await repo.settleOptionalCost({...settle,nowMs:feb+100})).kind,'replayed');
 assert.equal((await repo.costPressure(feb+2)).recurring.totalUsdMicros,'4000000');
 assert.deepEqual((await repo.costPressure(feb+2)).recurring,costPressure(db,feb+2).recurring);
 assert.equal((await repo.costPressure(Date.parse('2026-03-01T00:00:00Z'))).recurring.totalUsdMicros,'0');
});
test('pre-attempt quota is reserved once, failed attempts retain usage, and pending never admits a provider call',async t=>{
 const {db,repo}=fixture(t),input={provider:'fixture-provider',units:'1',quota:'2',evidenceRef:'fixture failed attempt'};
 const first=await command('meterProviderAttempt','meter-one',{...input,attemptId:'attempt-one'});
 assert.equal((await repo.meterProviderAttempt(first)).value.measured,'1');
 assert.equal((await repo.meterProviderAttempt({...first,nowMs:jan+5})).kind,'replayed');
 const second=await command('meterProviderAttempt','meter-two',{...input,attemptId:'attempt-two'});
 assert.equal((await repo.meterProviderAttempt(second)).reason,'attempt-observation-time');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_provider_attempts').get().n,1,'pending admits no new attempt');
 assert.equal((await repo.meterProviderAttempt({...second,nowMs:jan+1})).value.measured,'2');
 assert.equal((await repo.actionDecision('earn-admission',jan+1)).reason,'budget-limit');
 assert.equal((await repo.meterProviderAttempt(await command('meterProviderAttempt','meter-three',{...input,attemptId:'attempt-three'},jan+2))).reason,'provider-quota');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_provider_attempts').get().n,2);
 assert.equal((await repo.actionDecision('earn-claim',jan+2)).allowed,true);
 assert.equal((await repo.meterProviderAttempt(await command('meterProviderAttempt','changed',{...input,attemptId:'attempt-one'},jan+3))).code,'attempt_sealed');
});
test('scope/cost/authority races fail the whole receipt and missing mandatory final effects roll back',async t=>{
 const {db,driver}=fixture(t),input={scope:'optional-images',upperUsdMicros:'100',quoteRef:'fixture'};
 let fired=false;
 const race={...driver,async batch(statements){
  if(!fired&&statements[0].sql.startsWith('INSERT INTO app_command_receipts')){fired=true;db.exec("UPDATE app_operator_scopes SET enabled=0,revision=revision+1");}
  return driver.batch(statements);
 }};
 assert.equal((await createAtomicOperationsRepository(race,ports).reserveOptionalCost(await command('reserveOptionalCost','race',input))).code,'operator_scope_required');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_optional_spend').get().n,0);
 db.exec("UPDATE app_operator_scopes SET enabled=1,revision=revision+1");
 const broken={...driver,async batch(statements){return driver.batch(statements[0].sql.startsWith('INSERT INTO app_command_receipts')?[...statements.slice(0,-2),statements.at(-1)]:statements);}};
 const change=await command('changeScope','partial',{scope:'earn-admission',paused:true,previousRevision:null,reason:'fixture',evidenceRef:'fixture'});
 await assert.rejects(createAtomicOperationsRepository(broken,ports).changeScope(change),/Missing scope or audit/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_scope_log').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
});
test('lost operating batch acknowledgement reconciles its existing receipt and changed-body key conflicts',async t=>{
 const {driver,db}=fixture(t);
 const lost={...driver,async batch(statements){const result=await driver.batch(statements);if(statements[0].sql.startsWith('INSERT INTO app_command_receipts'))throw Error('fixture lost response');return result;}};
 const repo=createAtomicOperationsRepository(lost,ports),input={scope:'optional-notifications',upperUsdMicros:'1',quoteRef:'fixture'};
 const first=await command('reserveOptionalCost','lost',input);
 assert.equal((await repo.reserveOptionalCost(first)).kind,'replayed');
 assert.equal((await repo.reserveOptionalCost(await command('reserveOptionalCost','lost',{...input,upperUsdMicros:'2'}))).code,'idempotency_conflict');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_optional_spend').get().n,1);
});

test('persistent operating contention is bounded pending, and caller revisions are never bypassed',async t=>{
 const {db,driver}=fixture(t);let attempts=0;
 const racing={...driver,async batch(statements){
  if(statements[0].sql.startsWith('INSERT INTO app_command_receipts')){attempts++;db.exec("UPDATE app_revisions SET revision=revision+1 WHERE name='control'");}
  return driver.batch(statements);
 }};
 const repo=createAtomicOperationsRepository(racing,ports),input={scope:'optional-notifications',upperUsdMicros:'1',quoteRef:'fixture'};
 const outcome=await repo.reserveOptionalCost(await command('reserveOptionalCost','bounded',input));
 assert.equal(outcome.reason,'operating-contention');assert.equal(attempts,2);
 const explicit=await command('reserveOptionalCost','stale',input,jan,{control:'0'});
 assert.equal((await repo.reserveOptionalCost(explicit)).code,'revision_conflict');assert.equal(attempts,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
});
