import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {mintFixture} from '../../collect/mint-test-fixture.mjs';
import {dispatchMintReservation} from '../../collect/mint-test-harness.mjs';
import {roundTime,futureRound,leadMs} from '../../randomness/request-plan.mjs';
import {encode58} from '../../server/base58.mjs';
import {governanceWallets} from '../../governance/operator-test-fixture.mjs';
import {createMintReservationService} from '../../collect/mint-service.mjs';
import {createMintReservationRepository} from '../../collect/mint-repository.mjs';

test('actual D1 normalized mint admission matches Node through mandatory rollback, fairness binding, races and replay',async t=>{
 const f=await mintFixture(t,{configured:true,large:true,allocation:2}),{mf,db}=await localRuntime(t,new URL('./fixtures/collection-mint-worker.ts',import.meta.url));
 for(const table of ['app_operator_scopes','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_eligibility_pages','collect_inventories','app_collection_authorities','app_collection_stages','fair_inventories','fair_reserved_assets']){
  const rows=f.db.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=20)await db.batch(rows.slice(offset,offset+20).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));
 }
 for(const r of f.db.prepare('SELECT * FROM app_revisions').all())await db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(r.revision,r.name).run();
 let paired=0;const measured=[];
 const edge=async request=>{const response=await mf.dispatchFetch('http://localhost/__fixture/mint',{method:'POST',body:JSON.stringify(request)});assert.equal(response.status,200);return response.json();};
 const both=async(patch={})=>{const request={principal:f.principal,nowMs:f.getNow(),idPrefix:'synthetic-mint',input:f.request,...patch},n=await dispatchMintReservation({driver:f.base,crypto:f.ports.crypto,request}),d=await edge(request);paired++;assert.equal(d.status,n.status,JSON.stringify({n,d}));if(n.status===200){assert.deepEqual(d.result,n.result);measured.push(d.metrics);}else assert.equal(d.error,n.error);return d;};
 const rows=table=>db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),before=await rows('app_command_receipts');
 for(const fault of ['omit-operation','omit-authority','omit-admission','omit-fair']){assert.equal((await both({fault})).status,500);assert.equal(await rows('app_collection_mint_admissions'),0);assert.equal(await rows('collect_operations'),0);assert.equal(await rows('app_command_receipts'),before);assert.equal(await db.prepare('SELECT admitted FROM app_collection_authorities').first('admitted'),0);}
 for(const fault of ['source-change','watermark-change'])assert.equal((await both({fault})).result.code,'revision_conflict');
 assert.equal((await both({method:'forged'})).status,500);assert.equal((await both({input:{...f.request,expectedTermsDigest:'0'.repeat(64)}})).result.reason,'mint-command-binding');
 const unknown=encode58(new Uint8Array(32).fill(255));assert.equal((await both({principal:{kind:'wallet',wallet:unknown}})).result.reason,'wallet_ineligible');
 const policy=f.db.prepare('SELECT * FROM fair_inventories').get(),reserved=f.db.prepare('SELECT * FROM fair_reserved_assets WHERE slot_index=0').get();
 for(const table of ['asset','traits']){
  const statement=table==='asset'?'UPDATE fair_reserved_assets SET asset_id=? WHERE slot_index=0':'UPDATE fair_inventories SET traits=?',value=table==='asset'?unknown:JSON.stringify(Object.fromEntries(['backdrop','model','symbol'].map(k=>[k,[{name:'Synthetic changed',weight:1}]])));
  f.db.prepare(statement).run(value);await db.prepare(statement).bind(value).run();assert.match((await both()).result.reason,/mint-fair-policy/);const original=table==='asset'?reserved.asset_id:policy.traits;f.db.prepare(statement).run(original);await db.prepare(statement).bind(original).run();
 }
 assert.equal((await both({fault:'advance-final-hash',advanceMs:f.input.closesAt-f.getNow()})).result.reason,'mint-window-expired');
 const phase=roundTime(futureRound(f.getNow()))-leadMs;assert.equal((await both({nowMs:phase,fault:'advance-in-batch',advanceMs:30000})).result.reason,'fairness-window-expired');
 const accepted=await both({fault:'lost-response'});assert.equal(accepted.result.kind,'replayed');assert.equal(accepted.result.value.executable,false);assert.equal(await rows('fair_requests'),1);assert.equal(await rows('collect_assets'),0);assert.equal(await rows('tx_intents'),0);assert.doesNotMatch(JSON.stringify(accepted.result.value),/commitment|ordinal|contextDigest|targetRound|remaining|level|traits/);
 const stageUsed=await both({idPrefix:'synthetic-second-same-wallet',input:{...f.request,requestKey:'synthetic-second-same-wallet'}});assert.equal(stageUsed.result.reason,'stage_wallet_limit');
 for(const statement of ['UPDATE fair_inventories SET traits=traits','DELETE FROM fair_reserved_assets','UPDATE fair_requests SET target_round=target_round','UPDATE collect_operations SET commitment=commitment','UPDATE app_collection_mint_admissions SET ordinal=ordinal']){assert.throws(()=>f.db.prepare(statement).run(),/immutable/);await assert.rejects(db.prepare(statement).run(),/immutable/);}
 assert.throws(()=>f.db.prepare('UPDATE collect_operations SET settled_ms=created_ms').run(),/Guarded normalized mint requires retained fulfillment evidence/);await assert.rejects(db.prepare('UPDATE collect_operations SET settled_ms=created_ms').run(),/Guarded normalized mint requires retained fulfillment evidence/);
 const requestFor=k=>({principal:{kind:'wallet',wallet:f.holders[k]},nowMs:f.getNow(),idPrefix:'synthetic-race-'+k,input:{...f.request,requestKey:'synthetic-race-'+k}}),nr=await Promise.all([1,2].map(k=>dispatchMintReservation({driver:f.base,crypto:f.ports.crypto,request:requestFor(k)}))),dr=await Promise.all([1,2].map(k=>edge(requestFor(k))));
 assert.equal(nr.filter(r=>r.result.kind==='committed').length,1,JSON.stringify(nr));assert.equal(dr.filter(r=>r.result.kind==='committed').length,1,JSON.stringify(dr));assert.equal(await rows('app_collection_mint_admissions'),2);assert.equal(f.db.prepare('SELECT admitted FROM app_collection_authorities').get().admitted,2);assert.equal(await db.prepare('SELECT admitted FROM app_collection_authorities').first('admitted'),2);
 const sold=await both({principal:{kind:'wallet',wallet:f.holders[3]},idPrefix:'synthetic-sold',input:{...f.request,requestKey:'synthetic-sold'}});assert.equal(sold.result.reason,'sold_out');
 const replay=await both({nowMs:f.input.closesAt+1});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,accepted.result.value);
 assert.equal((await mf.dispatchFetch('http://localhost/api/v1/collect/inventories/'+f.input.inventoryId+'/stages/publish',{method:'POST'})).status,404);
 const maxStatements=Math.max(...measured.map(m=>m.statements)),maxBatchBytes=Math.max(...measured.map(m=>m.maxBatchBytes)),maxResultBytes=Math.max(...measured.map(m=>m.maxResultBytes));assert.ok(maxStatements<=30);assert.ok(maxBatchBytes<=262144);assert.ok(maxResultBytes<=1048576);t.diagnostic(JSON.stringify({pairedCalls:paired,concurrentCalls:4,wallets:10000,reservedAssets:1000,maxStatements,maxBatchBytes,maxResultBytes,admissions:2,financialExecution:false,installedMigration:45}));
});

test('actual D1 admits exactly one final inventory slot after999 genuine guarded Node admissions',async t=>{
 const f=await mintFixture(t,{type:'public'}),wallets=governanceWallets(1001),service=createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)}),requestFor=n=>({...f.request,requestKey:'synthetic-full-'+n});let first;
 for(let n=0;n<999;n++){const r=await service.reserveMint({kind:'wallet',wallet:wallets[n]},requestFor(n));assert.equal(r.kind,'committed',JSON.stringify({n,r}));if(n===0)first=r;}
 const {mf,db}=await localRuntime(t,new URL('./fixtures/collection-mint-worker.ts',import.meta.url));
 for(const table of ['app_operator_scopes','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_eligibility_pages','collect_inventories','app_collection_authorities','app_collection_stages','collect_operations','app_collection_mint_admissions']){
  const rows=f.db.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=20)await db.batch(rows.slice(offset,offset+20).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));
 }
 for(const r of f.db.prepare('SELECT * FROM app_revisions').all())await db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(r.revision,r.name).run();
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').first('n'),999);assert.equal(await db.prepare('SELECT admitted FROM app_collection_authorities').first('admitted'),999);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').get().n,999);
 const call=async n=>{const response=await mf.dispatchFetch('http://localhost/__fixture/mint',{method:'POST',body:JSON.stringify({principal:{kind:'wallet',wallet:wallets[n]},nowMs:f.getNow(),idPrefix:'synthetic-full-'+n,input:requestFor(n)})});assert.equal(response.status,200);return response.json();};
 const results=await Promise.all([999,1000].map(call));assert.equal(results.filter(r=>r.result?.kind==='committed').length,1,JSON.stringify(results));assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').first('n'),1000);assert.equal(await db.prepare('SELECT COUNT(*) n FROM collect_operations').first('n'),1000);const authority=await db.prepare('SELECT * FROM app_collection_authorities').first();assert.equal(authority.admitted,1000);assert.equal(authority.fulfilled,0);assert.equal(JSON.parse(authority.remaining_json).reduce((sum,n)=>sum+n,0),1000);
 const loser=results.findIndex(r=>r.result?.kind!=='committed')+999;assert.equal((await call(loser)).result.reason,'sold_out');const replay=await call(0);assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,first.value);assert.deepEqual(replay.result.receipt,first.receipt);assert.equal(await db.prepare('SELECT COUNT(*) n FROM collect_assets').first('n'),0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM tx_intents').first('n'),0);
 t.diagnostic(JSON.stringify({sourceGenuineAdmissions:999,targetGenuineAdmissions:1000,finalInventoryRaceWinners:1,maxStatements:Math.max(...results.map(r=>r.metrics.statements)),maxBatchBytes:Math.max(...results.map(r=>r.metrics.maxBatchBytes)),financialExecution:false,installedMigration:45}));
});
