import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {seedCollectionContext} from '../../application/fixtures/collection-context.mjs';
import {dispatchProgressionReservation,reviewedReservation} from '../../collect/reservation-test-harness.mjs';
import {futureRound,roundTime} from '../../randomness/request-plan.mjs';
test('actual Node/D1 quote-required reservations atomically bind pair locks, configured draws, original receipts and fail-closed authority',async t=>{
 const node=openDatabase();t.after(()=>node.close());const edge=await localRuntime(t,new URL('./fixtures/collection-reservations-worker.ts',import.meta.url));const f=seedCollectionContext(node),driver=createNodeAtomicDriver(node),crypto=createNodeCrypto();
 for(const table of ['collect_inventories','vault_assets','vault_observations','collect_assets']){const rows=node.prepare('SELECT * FROM '+table).all();await edge.db.batch(rows.map(row=>{const keys=Object.keys(row);return edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));}
 for(const row of node.prepare('SELECT * FROM app_revisions').all())await edge.db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(row.revision,row.name).run();
 const slots=node.prepare('SELECT id,slot,bind_ms,reveal_ms FROM collect_assets ORDER BY id').all().map(r=>({...r})),vault=node.prepare('SELECT * FROM vault_assets ORDER BY id').all().map(r=>({...r}));
 let seq=0,paired=0,maxStatements=0,maxBatchBytes=0,maxParameters=0,now=f.nowMs;
 const both=async(patch)=>{const request={principal:{kind:'wallet',wallet:f.wallet},nowMs:now,idPrefix:'synthetic-pair-'+(++seq),...patch};const a=await dispatchProgressionReservation({driver,crypto,request}),response=await edge.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(request)});assert.equal(response.status,200);const b=await response.json();assert.deepEqual(b,a);paired++;maxStatements=Math.max(maxStatements,a.metrics.statements);maxBatchBytes=Math.max(maxBatchBytes,a.metrics.maxBatchBytes);maxParameters=Math.max(maxParameters,a.metrics.maxParameters);return a;};
 const quote=async(level)=>{const r=await both({method:'quote',input:{requestKey:'synthetic-quote-'+seq,inventoryId:f.inventoryId,...f.request(level,level===10?'visual':'upgrade')}});assert.equal(r.result.kind,'committed',JSON.stringify(r));return r.result.value;};
 const write=async(sql,...values)=>{node.prepare(sql).run(...values);await edge.db.prepare(sql).bind(...values).run();};
 const q=await quote(1),input=reviewedReservation(q,'synthetic-manual'),first=await both({input});assert.equal(first.result.kind,'committed');assert.equal(first.result.value.fairness,'manual-fixture');
 await write('INSERT INTO ops_scope_log VALUES(?,?,?,?,?,?,?,?,?)','synthetic-pause','collection-progression',1,null,now+1,'synthetic-operator','synthetic','synthetic','synthetic-pause');
 const replay=await both({input,nowMs:q.expiresMs+1});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,first.result.value);
 now+=2;await write('INSERT INTO ops_scope_log VALUES(?,?,?,?,?,?,?,?,?)','synthetic-resume','collection-progression',0,'synthetic-pause',now,'synthetic-operator','synthetic','synthetic','synthetic-resume');
 const q2=await quote(2);let failure=0;
 for(const patch of [{bindingDigest:'b'.repeat(64)},{reviewedFeeLamports:'1'},{reviewedMaxTotalLamports:'999999999'},{quoteExpiresMs:q2.expiresMs+1},{policyVersion:'wrong'}])assert.equal((await both({input:{...reviewedReservation(q2,'synthetic-bad-'+(++failure)),...patch}})).result.kind,'pending');
 assert.equal((await both({input:reviewedReservation(q2,'synthetic-expired'),nowMs:q2.expiresMs})).result.reason,'quote-expired-or-not-yet-valid');
 for(const fault of ['source-change','expire-during-hash','expire-in-batch']){const r=await both({input:reviewedReservation(q2,'synthetic-'+fault),fault});assert.equal(r.injected,true);assert.ok(['pending','conflict'].includes(r.result.kind));}
 const before=node.prepare('SELECT COUNT(*) n FROM collect_operations').get().n;
 for(const fault of ['omit-target','omit-material','omit-operation','omit-link']){const r=await both({input:reviewedReservation(q2,'synthetic-'+fault),fault});assert.equal(r.error,'mandatory-effects-aborted');assert.equal(node.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,before);}
 await write('INSERT INTO fair_inventories VALUES(?,?,?,?)',f.inventoryId,'a'.repeat(64),'{}',f.start);
 const roundAtMs=roundTime(futureRound(now));
 for(const patch of [{fault:'advance-in-batch',advanceMs:roundAtMs-now},{fault:'fair-final-hash',roundAtMs}]){const lateFair=await both({input:reviewedReservation(q2,'synthetic-late-fair'),...patch});assert.equal(lateFair.result.reason,'fairness-window-expired');}
 const missingFair=await both({input:reviewedReservation(q2,'synthetic-omit-fair'),fault:'omit-fair'});assert.equal(missingFair.error,'mandatory-effects-aborted');
 const configured=await both({input:reviewedReservation(q2,'synthetic-configured'),fault:'lost-response'});assert.equal(configured.result.kind,'replayed');assert.equal(configured.result.value.fairness,'configured-offline-beacon');
 const opId=configured.result.value.operationId;
 for(const sql of ['UPDATE fair_requests SET target_round=target_round+1 WHERE operation_id=?','DELETE FROM fair_requests WHERE operation_id=?',"UPDATE collect_operations SET commitment='tampered' WHERE id=?"]){assert.throws(()=>node.prepare(sql).run(opId),/immutable|Retain|guarded|identity/i);await assert.rejects(edge.db.prepare(sql).bind(opId).run(),/immutable|Retain|guarded|identity/i);}
 for(const sql of ["UPDATE fair_inventories SET traits='{}' WHERE inventory_id=?",'DELETE FROM fair_inventories WHERE inventory_id=?']){assert.throws(()=>node.prepare(sql).run(f.inventoryId),/immutable|policy|Retain/i);await assert.rejects(edge.db.prepare(sql).bind(f.inventoryId).run(),/immutable|policy|Retain/i);}
 const visual=await quote(10);assert.equal((await both({input:reviewedReservation(visual,'synthetic-visual')})).result.kind,'committed');
 const productionNow=Date.now(),productionAt=productionNow%1000===0?productionNow-1:productionNow;
 const productionQuote=await both({method:'quote',productionClock:true,nowMs:productionAt,input:{requestKey:'synthetic-production-quote',inventoryId:f.inventoryId,...f.request(5)}});assert.equal(productionQuote.result.kind,'committed');
 const production=await both({productionClock:true,nowMs:productionAt,input:reviewedReservation(productionQuote.result.value,'synthetic-production-reserve')});assert.equal(production.result.kind,'committed');assert.equal(production.result.value.createdMs,productionAt);
 const a=await quote(4),b=await quote(4),requests=[a,b].map((q,index)=>({principal:{kind:'wallet',wallet:f.wallet},nowMs:now,idPrefix:'synthetic-race-'+index,input:reviewedReservation(q,'synthetic-race-'+index)}));
 const nr=await Promise.all(requests.map(request=>dispatchProgressionReservation({driver,crypto,request}))),er=await Promise.all(requests.map(async request=>(await edge.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(request)})).json()));
 for(const r of [nr,er])assert.equal(r.filter(x=>x.result.kind==='committed').length,1);paired+=2;
 // Arrival order may differ across engines; either contender may win, while
 // both assets must belong to that one durable winning operation.
 const nodeWinner=nr.find(r=>r.result.kind==='committed').result.value,edgeWinner=er.find(r=>r.result.kind==='committed').result.value;
 for(const id of [a.targetId,a.materialId]){assert.equal(JSON.parse(node.prepare('SELECT asset FROM collect_assets WHERE id=?').get(id).asset).pending,nodeWinner.operationId);assert.equal(JSON.parse(await edge.db.prepare('SELECT asset FROM collect_assets WHERE id=?').bind(id).first('asset')).pending,edgeWinner.operationId);}
 for(const table of ['collect_operations','app_collection_reservations','fair_requests']){const order=table==='collect_operations'?'id':'operation_id',query='SELECT * FROM '+table+" WHERE "+order+" NOT LIKE 'synthetic-race-%' ORDER BY "+order;assert.deepEqual((await edge.db.prepare(query).all()).results,node.prepare(query).all().map(r=>({...r})));}
 const ownerQuote=await quote(6),ownerRace=await both({input:reviewedReservation(ownerQuote,'synthetic-owner-race'),fault:'owner-change',other:f.other});assert.equal(ownerRace.result.code,'revision_conflict');
 const futureQuote=await quote(7);await write('INSERT INTO ops_scope_log VALUES(?,?,?,?,?,?,?,?,?)','synthetic-future-pause','collection-progression',1,'synthetic-resume',now+500,'synthetic-operator','synthetic','synthetic','synthetic-future-pause');
 const futurePause=await both({input:reviewedReservation(futureQuote,'synthetic-future-pause'),fault:'advance-in-batch',advanceMs:500});assert.equal(futurePause.result.code,'revision_conflict');
 assert.deepEqual(node.prepare('SELECT id,slot,bind_ms,reveal_ms FROM collect_assets ORDER BY id').all().map(r=>({...r})),slots);assert.deepEqual((await edge.db.prepare('SELECT id,slot,bind_ms,reveal_ms FROM collect_assets ORDER BY id').all()).results,slots);assert.deepEqual(node.prepare('SELECT * FROM vault_assets ORDER BY id').all().map(r=>({...r})),vault);
 for(const table of ['collect_level_history','vault_claim_totals','tx_intents','tx_attempts'])assert.equal(node.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 t.diagnostic(JSON.stringify({pairedCalls:paired,maxStatements,maxBatchBytes,maxParameters,reservations:node.prepare('SELECT COUNT(*) n FROM app_collection_reservations').get().n,publicRoutes:false,financialExecution:false,draftMigrations:false}));
});
