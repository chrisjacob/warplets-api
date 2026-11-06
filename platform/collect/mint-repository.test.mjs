import test from 'node:test';
import assert from 'node:assert/strict';
import {mintFixture,MINT_TEST_OPERATOR} from './mint-test-fixture.mjs';
import {dispatchMintReservation} from './mint-test-harness.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {roundTime,futureRound,leadMs} from '../randomness/request-plan.mjs';
import {encode58} from '../server/base58.mjs';
import {createCollection} from './store.mjs';
import {changeScope,recordUsage} from '../operations/controls.mjs';
import {governanceWallets} from '../governance/operator-test-fixture.mjs';
const call=(f,patch={})=>dispatchMintReservation({driver:f.base,crypto:f.ports.crypto,request:{principal:f.principal,nowMs:f.getNow(),idPrefix:'synthetic-mint',input:f.request,...patch}});
const count=(f,name)=>f.db.prepare('SELECT COUNT(*) n FROM '+name).get().n;

test('normalized admission atomically retains terms, compact counts and original replay after stage close/pause',async t=>{
 const f=await mintFixture(t),r=await call(f);assert.equal(r.result?.kind,'committed',JSON.stringify(r));assert.equal(count(f,'app_collection_mint_admissions'),1);assert.equal(count(f,'collect_operations'),1);assert.equal(count(f,'collect_assets'),0);assert.equal(count(f,'tx_intents'),0);
 const row=f.db.prepare('SELECT * FROM app_collection_mint_admissions').get(),a=f.db.prepare('SELECT * FROM app_collection_authorities').get();assert.equal(a.admitted,1);assert.equal(a.fulfilled,0);assert.equal(a.revision,2);assert.equal(row.ordinal,0);assert.equal(row.cost_lamports,'500000');assert.equal(row.result_json,JSON.stringify(JSON.parse(row.result_json)));assert.deepEqual(JSON.parse(row.effect_json).authorityBefore,{admitted:0,fulfilled:0,remainingJson:a.remaining_json,revision:1});assert.doesNotMatch(JSON.stringify(r.result.value),/commitment|ordinal|contextDigest|targetRound|remaining|level|traits/);
 f.setNow(f.input.closesAt+1);const replay=await call(f);assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result,r.result.kind==='committed'?{...r.result,kind:'replayed'}:r.result);assert.equal((await call(f,{input:{...f.request,expectedTermsDigest:'0'.repeat(64)}})).result.code,'idempotency_conflict');
 assert.throws(()=>f.db.prepare('UPDATE collect_operations SET settled_ms=created_ms').run(),/Guarded normalized mint requires retained fulfillment evidence/);assert.throws(()=>f.db.prepare('UPDATE app_collection_mint_admissions SET ordinal=ordinal').run(),/immutable/);assert.throws(()=>f.db.prepare('DELETE FROM app_collection_mint_admissions').run(),/Retain/);assert.throws(()=>f.db.prepare('UPDATE collect_inventories SET state=state').run(),/Normalized/);
 t.diagnostic(JSON.stringify(r.metrics));
});

test('each missing child rolls back counts, operation, fair request and receipt',async t=>{
 for(const fault of ['omit-operation','omit-authority','omit-admission','omit-fair']){const f=await mintFixture(t,{configured:true}),before=count(f,'app_command_receipts'),r=await call(f,{fault});assert.equal(r.status,500,JSON.stringify(r));assert.equal(r.error,'mandatory-effects-aborted');for(const table of ['collect_operations','app_collection_mint_admissions','fair_requests'])assert.equal(count(f,table),0);assert.equal(count(f,'app_command_receipts'),before);assert.equal(f.db.prepare('SELECT admitted FROM app_collection_authorities').get().admitted,0);}
});

test('configured policy rederives all reserved identities and traits, then freezes policy/request after acceptance',async t=>{
 for(const change of ['asset','traits']){const f=await mintFixture(t,{configured:true});if(change==='asset')f.db.prepare('UPDATE fair_reserved_assets SET asset_id=? WHERE slot_index=0').run(encode58(new Uint8Array(32).fill(255)));else f.db.prepare('UPDATE fair_inventories SET traits=?').run(JSON.stringify(Object.fromEntries(['backdrop','model','symbol'].map(k=>[k,[{name:'Synthetic changed',weight:1}]]))));const r=await call(f);assert.equal(r.result.kind,'pending',JSON.stringify(r));assert.match(r.result.reason,/mint-fair-policy/);assert.equal(count(f,'collect_operations'),0);}
 const f=await mintFixture(t,{configured:true}),r=await call(f);assert.equal(r.result.kind,'committed',JSON.stringify(r));const admission=f.db.prepare('SELECT * FROM app_collection_mint_admissions').get(),request=f.db.prepare('SELECT * FROM fair_requests').get();assert.equal(admission.context_digest,request.context_digest);assert.equal(admission.target_round,request.target_round);assert.ok(roundTime(request.target_round)>f.getNow());
 for(const statement of ['UPDATE fair_inventories SET traits=traits','DELETE FROM fair_inventories','UPDATE fair_reserved_assets SET asset_id=asset_id','DELETE FROM fair_reserved_assets','UPDATE fair_requests SET target_round=target_round','DELETE FROM fair_requests','UPDATE collect_operations SET commitment=commitment'])assert.throws(()=>f.db.prepare(statement).run(),/immutable/);
});

test('wallet/terms/limit/scoped founder and fixed approved budget all fail closed',async t=>{
 const f=await mintFixture(t);assert.equal((await call(f,{principal:{kind:'wallet',wallet:f.assets[999]}})).result.reason,'wallet_ineligible');assert.equal((await call(f,{input:{...f.request,expectedTermsDigest:'0'.repeat(64)}})).result.reason,'mint-command-binding');assert.equal((await call(f,{method:'forged'})).status,500);
 assert.equal((await call(f)).result.kind,'committed');assert.equal((await call(f,{idPrefix:'synthetic-second',input:{...f.request,requestKey:'synthetic-second'}})).result.reason,'stage_wallet_limit');
 const founder=await mintFixture(t,{type:'founder'});founder.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-founder'").run(MINT_TEST_OPERATOR.id);assert.equal((await call(founder)).result.code,'operator_scope_required');founder.db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE operator=? AND scope='collection-founder'").run(MINT_TEST_OPERATOR.id);assert.equal((await call(founder)).result.kind,'committed');assert.equal((await call(founder,{idPrefix:'synthetic-founder-second',input:{...founder.request,requestKey:'synthetic-founder-second',wallet:founder.holders[1]}})).result.reason,'founder_budget_exceeded');
});

test('lost response, concurrent last-stage-slot and current revision/watermark races remain exact',async t=>{
 const f=await mintFixture(t),lost=await call(f,{fault:'lost-response'});assert.equal(lost.result.kind,'replayed',JSON.stringify(lost));assert.equal(count(f,'collect_operations'),1);
 for(const fault of ['source-change','watermark-change']){const raced=await mintFixture(t),r=await call(raced,{fault});assert.equal(r.result.code,'revision_conflict',JSON.stringify(r));assert.equal(count(raced,'collect_operations'),0);}
 const last=await mintFixture(t,{allocation:1}),service=createMintReservationService({...last.ports,repository:createMintReservationRepository(last.base,last.ports)}),results=await Promise.all([service.reserveMint(last.principal,last.request),service.reserveMint({kind:'wallet',wallet:last.holders[1]},{...last.request,requestKey:'other'})]);assert.equal(results.filter(r=>r.kind==='committed').length,1);assert.equal(count(last,'collect_operations'),1);assert.equal((await service.reserveMint({kind:'wallet',wallet:last.holders[2]},{...last.request,requestKey:'third'})).reason,'sold_out');
});

test('actual SQL clock guards both stage expiry and future entropy after final asynchronous hash',async t=>{
 const f=await mintFixture(t),expired=await call(f,{fault:'advance-final-hash',advanceMs:f.input.closesAt-f.getNow()});assert.equal(expired.result.reason,'mint-window-expired',JSON.stringify(expired));assert.equal(count(f,'collect_operations'),0);
 const configured=await mintFixture(t,{configured:true});configured.setNow(roundTime(futureRound(configured.getNow()))-leadMs);const boundary=await call(configured,{fault:'advance-in-batch',advanceMs:30000});assert.equal(boundary.result.reason,'fairness-window-expired',JSON.stringify(boundary));assert.equal(count(configured,'collect_operations'),0);
});

test('10000-member stage admission reads compact membership aggregates without hydrating list wallets',async t=>{
 const f=await mintFixture(t,{large:true}),r=await call(f);assert.equal(r.result.kind,'committed',JSON.stringify(r));assert.ok(r.metrics.maxResultBytes<32768);assert.ok(r.metrics.maxParameters<=100);assert.ok(r.metrics.maxBatchBytes<=262144);assert.ok(r.metrics.statements<40);t.diagnostic(JSON.stringify({wallets:10000,...r.metrics}));
});

test('accepted manual admission cannot be poisoned by moved policy/assets or inserted/repointed fairness requests',async t=>{
 const f=await mintFixture(t),r=await call(f);assert.equal(r.result.kind,'committed');const op=r.result.value.operationId;
 createCollection(f.db,{id:'synthetic-unrelated',kind:'season',seasonStart:f.getNow()});f.db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run('synthetic-unrelated','a'.repeat(64),'{}',f.getNow());f.db.prepare('INSERT INTO fair_reserved_assets VALUES(?,?,?)').run('synthetic-unrelated',0,encode58(new Uint8Array(32).fill(255)));
 assert.throws(()=>f.db.prepare('UPDATE fair_inventories SET inventory_id=? WHERE inventory_id=?').run(f.input.inventoryId,'synthetic-unrelated'),/immutable/);assert.throws(()=>f.db.prepare('UPDATE fair_reserved_assets SET inventory_id=? WHERE inventory_id=?').run(f.input.inventoryId,'synthetic-unrelated'),/immutable/);
 assert.throws(()=>f.db.prepare('INSERT INTO fair_requests VALUES(?,?,?)').run(op,1,'a'.repeat(64)),/immutable/);
 f.db.prepare("INSERT INTO collect_operations(id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms,operation) VALUES(?,'mint',?,?,?,?,?,?,?)").run('synthetic-unrelated-op','synthetic-unrelated',f.holders[0],'synthetic-unrelated-key','b'.repeat(64),'synthetic-unrelated-commitment',f.getNow(),'{}');f.db.prepare('INSERT INTO fair_requests VALUES(?,?,?)').run('synthetic-unrelated-op',1,'a'.repeat(64));assert.throws(()=>f.db.prepare('UPDATE fair_requests SET operation_id=? WHERE operation_id=?').run(op,'synthetic-unrelated-op'),/immutable/);
 assert.equal((await call(f)).result.kind,'replayed');
});

test('current pause/budget/future control evidence holds new admissions while accepted receipt replays first',async t=>{
 const f=await mintFixture(t),accepted=await call(f);assert.equal(accepted.result.kind,'committed');changeScope(f.db,{scope:'collection-mint',paused:true,atMs:f.getNow(),actor:'synthetic-mint-controls',reason:'Synthetic pause',evidenceRef:'synthetic-local-controls',requestKey:'synthetic-pause'});
 assert.equal((await call(f)).result.kind,'replayed');assert.equal((await call(f,{principal:{kind:'wallet',wallet:f.holders[1]},input:{...f.request,requestKey:'synthetic-held'}})).result.reason,'operator-pause');
 const budget=await mintFixture(t);recordUsage(budget.db,{provider:'synthetic-local-provider',metric:'new-monthly-usd',measured:'1000000000',atMs:budget.getNow(),evidenceRef:'synthetic-budget'});assert.equal((await call(budget)).result.reason,'budget-limit');assert.equal(count(budget,'collect_operations'),0);
 const future=await mintFixture(t);changeScope(future.db,{scope:'collection-mint',paused:false,atMs:future.getNow()+1,actor:'synthetic-mint-controls',reason:'Synthetic future observation',evidenceRef:'synthetic-local-controls',requestKey:'synthetic-future'});assert.equal((await call(future)).result.reason,'operating-input-invalid');assert.equal(count(future,'collect_operations'),0);
});

test('all 1000 normalized public admissions exhaust one shared inventory with one winner at the final slot',async t=>{
 const f=await mintFixture(t,{type:'public'}),wallets=governanceWallets(1001),service=createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)}),requestFor=n=>({...f.request,requestKey:'synthetic-capacity-'+n});
 for(let n=0;n<999;n++){const r=await service.reserveMint({kind:'wallet',wallet:wallets[n]},requestFor(n));assert.equal(r.kind,'committed',JSON.stringify({n,r}));}
 const results=await Promise.all([999,1000].map(n=>service.reserveMint({kind:'wallet',wallet:wallets[n]},requestFor(n))));assert.equal(results.filter(r=>r.kind==='committed').length,1);assert.equal(count(f,'app_collection_mint_admissions'),1000);assert.equal(count(f,'collect_operations'),1000);
 const a=f.db.prepare('SELECT * FROM app_collection_authorities').get();assert.equal(a.admitted,1000);assert.equal(a.fulfilled,0);assert.equal(a.revision,1001);assert.equal(JSON.parse(a.remaining_json).reduce((sum,n)=>sum+n,0),1000);assert.equal(JSON.parse(f.db.prepare('SELECT state FROM collect_inventories').get().state).admissions.length,0);
 const loser=results.findIndex(r=>r.kind!=='committed')+999;assert.equal((await service.reserveMint({kind:'wallet',wallet:wallets[loser]},requestFor(loser))).reason,'sold_out');assert.equal((await service.reserveMint({kind:'wallet',wallet:wallets[0]},requestFor(0))).kind,'replayed');assert.equal(count(f,'collect_assets'),0);
});
