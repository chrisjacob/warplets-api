import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {dispatchProgressionReservation,reviewedReservation} from './reservation-test-harness.mjs';
import {fulfillProgression,readOwnOperation,reserveProgression} from './store.mjs';
import {changeScope,recordUsage} from '../operations/controls.mjs';
import {futureRound,roundTime} from '../randomness/request-plan.mjs';
const crypto=createNodeCrypto();
function setup(t,{fair=false}={}){const db=openDatabase();t.after(()=>db.close());
 const f=seedCollectionContext(db),driver=createNodeAtomicDriver(db);let seq=0;
 if(fair)db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(f.inventoryId,'a'.repeat(64),'{}',f.start);
 const call=(patch)=>dispatchProgressionReservation({driver,crypto,request:{principal:{kind:'wallet',wallet:f.wallet},nowMs:f.nowMs,idPrefix:'synthetic-reserve-'+(++seq),...patch}});
 const quote=async(level=1)=>{const r=await call({method:'quote',input:{requestKey:'synthetic-quote-'+seq,inventoryId:f.inventoryId,...f.request(level,level===10?'visual':'upgrade')}});assert.equal(r.result.kind,'committed',JSON.stringify(r));return r.result.value;};
 return {db,f,call,quote,driver};}
test('guarded pair reservation preserves legacy fulfillment format, past clocks and durable replay after pause/expiry',async t=>{
 const {db,f,call,quote}=setup(t),q=await quote(),input=reviewedReservation(q,'synthetic-reserve'),r=await call({input});assert.equal(r.result.kind,'committed',JSON.stringify(r));assert.equal(r.result.value.fairness,'manual-fixture');const opId=r.result.value.operationId;
 for(const id of [input.targetId,input.materialId]){const row=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(id),a=JSON.parse(row.asset);assert.equal(a.pending,opId);assert.equal(a.version,1);assert.equal(row.observed_ms,f.nowMs);}
 const op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(opId);assert.deepEqual(JSON.parse(op.operation).feeLamports,{$lamports:q.feeLamports});assert.equal(readOwnOperation(db,f.wallet,opId).feeLamports,q.feeLamports);
 changeScope(db,{scope:'collection-progression',paused:true,atMs:f.nowMs+1,actor:'synthetic-operator',reason:'synthetic-pause',evidenceRef:'synthetic-proof',requestKey:'synthetic-pause'});
 const replay=await call({input,nowMs:q.expiresMs+1});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,r.result.value);
 const changed=await call({input:{...input,reviewedMaxTotalLamports:String(BigInt(q.feeLamports)+1n)}});assert.equal(changed.result.code,'idempotency_conflict');
 const receipt=fulfillProgression(db,{operationId:opId,commitment:op.commitment,proofId:'synthetic-manual-proof',at:f.nowMs+1000,finalized:true,ticket:489},f.nowMs+1000);assert.equal(receipt.operationId,opId);
 const target=JSON.parse(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(input.targetId).asset);assert.equal(target.pending,null);assert.equal(target.level,2);assert.equal(target.version,2);assert.equal((await call({input,nowMs:q.expiresMs+1})).result.kind,'replayed');assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});
test('configured fair request and all mandatory children are atomic and retain locks on unverified fulfillment',async t=>{
 const {db,f,call,quote}=setup(t,{fair:true}),q=await quote(2);let seq=0;
 for(const fault of ['omit-target','omit-material','omit-operation','omit-fair','omit-link']){const r=await call({input:reviewedReservation(q,'synthetic-fault-'+(++seq)),fault});assert.equal(r.status,500,JSON.stringify(r));assert.equal(r.error,'mandatory-effects-aborted');assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);assert.ok(db.prepare('SELECT asset FROM collect_assets').all().every(a=>JSON.parse(a.asset).pending===null));}
 const r=await call({input:reviewedReservation(q,'synthetic-lost'),fault:'lost-response'});assert.equal(r.result.kind,'replayed',JSON.stringify(r));assert.equal(r.result.value.fairness,'configured-offline-beacon');
 const op=db.prepare('SELECT * FROM collect_operations').get(),fair=db.prepare('SELECT * FROM fair_requests').get(),link=db.prepare('SELECT * FROM app_collection_reservations').get();assert.equal(fair.context_digest,link.context_digest);assert.equal(fair.target_round,link.target_round);
 assert.throws(()=>db.prepare('UPDATE fair_requests SET target_round=target_round+1 WHERE operation_id=?').run(op.id),/immutable|Retain|guarded/i);assert.throws(()=>db.prepare('DELETE FROM fair_requests WHERE operation_id=?').run(op.id),/immutable|Retain|guarded/i);
 assert.throws(()=>db.prepare('UPDATE collect_operations SET commitment=? WHERE id=?').run('rewritten',op.id),/immutable|identity/i);
 assert.throws(()=>db.prepare("UPDATE fair_inventories SET traits='{}' WHERE inventory_id=?").run(f.inventoryId),/immutable|policy|Retain/i);assert.throws(()=>db.prepare('DELETE FROM fair_inventories WHERE inventory_id=?').run(f.inventoryId),/immutable|policy|Retain/i);
 assert.throws(()=>fulfillProgression(db,{operationId:op.id,commitment:op.commitment,proofId:'synthetic-unverified',at:f.nowMs+1000,finalized:true,ticket:0},f.nowMs+1000),/Verified draw receipt required/);assert.equal(JSON.parse(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(q.targetId).asset).pending,op.id);
});
test('new reservations reject changed quote terms, stale participants, expiry and controls without effects',async t=>{
 const {db,f,call,quote}=setup(t),q=await quote(3);let seq=0;
 for(const patch of [{bindingDigest:'b'.repeat(64)},{reviewedFeeLamports:'1'},{reviewedMaxTotalLamports:'999999999'},{policyVersion:'wrong'},{quoteExpiresMs:q.expiresMs+1}]){const r=await call({input:{...reviewedReservation(q,'synthetic-wrong-'+(++seq)),...patch}});assert.equal(r.result.kind,'pending',JSON.stringify(r));}
 assert.equal((await call({input:reviewedReservation(q,'synthetic-expired'),nowMs:q.expiresMs})).result.reason,'quote-expired-or-not-yet-valid');
 for(const fault of ['source-change','expire-during-hash','expire-in-batch']){const r=await call({fault,input:reviewedReservation(q,'synthetic-'+fault)});assert.equal(r.injected,true);assert.ok(r.result.kind==='conflict'||r.result.kind==='pending',JSON.stringify(r));}
 recordUsage(db,{provider:'synthetic',metric:'new-monthly-usd',measured:'1000000000',quota:null,atMs:f.nowMs,evidenceRef:'synthetic'});assert.equal((await call({input:reviewedReservation(q,'synthetic-budget')})).result.reason,'budget-limit');assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);
});
test('concurrent pair use accepts exactly one quote, while legacy same-key rows are never adopted',async t=>{
 const {db,f,call,quote}=setup(t),a=await quote(4),b=await quote(4);const results=await Promise.all([call({input:reviewedReservation(a,'synthetic-a')}),call({input:reviewedReservation(b,'synthetic-b')})]);assert.equal(results.filter(r=>r.result.kind==='committed').length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,1);
 const oldQuote=await quote(5);reserveProgression(db,{inventoryId:f.inventoryId,wallet:f.wallet,requestKey:'synthetic-legacy',request:f.request(5),now:f.nowMs});assert.equal((await call({input:reviewedReservation(oldQuote,'synthetic-legacy')})).result.code,'legacy_operation_key');assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_reservations').get().n,1);
});

test('ownership, pause and configured-policy changes during acceptance cannot reuse a stale approval',async t=>{
 for(const fault of ['owner-change','pause','configure-fair'])await t.test(fault,async t=>{const {f,db,call,quote}=setup(t),q=await quote(6),r=await call({input:reviewedReservation(q,'synthetic-'+fault),fault,other:f.other});assert.equal(r.injected,true);assert.equal(r.result.code,'revision_conflict');assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);});
});

test('already recorded future pause or budget limits becoming effective before SQL commit fail closed',async t=>{
 for(const kind of ['pause','budget'])await t.test(kind,async t=>{const {db,f,call,quote}=setup(t),q=await quote(7);
  if(kind==='pause')changeScope(db,{scope:'collection-progression',paused:true,atMs:f.nowMs+500,actor:'synthetic-operator',reason:'synthetic-future',evidenceRef:'synthetic',requestKey:'synthetic-future'});
  else recordUsage(db,{provider:'synthetic',metric:'new-monthly-usd',measured:'1000000000',quota:null,atMs:f.nowMs+500,evidenceRef:'synthetic-future'});
  const r=await call({input:reviewedReservation(q,'synthetic-scheduled'),fault:'advance-in-batch',advanceMs:500});assert.equal(r.injected,true);assert.equal(r.result.code,'revision_conflict');assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);
 });
});

test('malformed operating evidence cannot become an allowed reservation decision',async t=>{
 const {db,f,call,quote}=setup(t),q=await quote(8);db.prepare('INSERT INTO ops_usage VALUES(?,?,?,?,?,?,?,?)').run('synthetic-malformed','synthetic','new-monthly-usd',new Date(f.nowMs).toISOString().slice(0,7),f.nowMs,'not-integer',null,'synthetic');
 const r=await call({input:reviewedReservation(q,'synthetic-malformed')});assert.equal(r.result.reason,'operating-input-invalid');assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);
});

test('configured fairness cannot accept a round that becomes observable before the SQL claim',async t=>{
 const {db,f,call,quote}=setup(t,{fair:true}),q=await quote(8),roundAtMs=roundTime(futureRound(f.nowMs)),input=reviewedReservation(q,'synthetic-late-fair');
 for(const patch of [{fault:'advance-in-batch',advanceMs:roundAtMs-f.nowMs},{fault:'fair-final-hash',roundAtMs}]){const r=await call({input,...patch});assert.equal(r.injected,true);assert.equal(r.result.reason,'fairness-window-expired');assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='collection.reserve-operation.v1'").get().n,0);}
 const retry=await call({input,nowMs:roundAtMs+1});assert.equal(retry.result.kind,'committed');const fair=db.prepare('SELECT * FROM fair_requests').get();assert.ok(roundTime(fair.target_round)>roundAtMs);const replay=await call({input,nowMs:q.expiresMs+1});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,retry.result.value);assert.deepEqual(db.prepare('SELECT * FROM fair_requests').get(),fair);
});

test('visual reservation preserves Level and traits, and completed reroll count and cooldown still begin at fulfillment',async t=>{
 const {db,f,call,quote}=setup(t),q=await quote(10),initial=JSON.parse(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(q.targetId).asset),accepted=await call({input:reviewedReservation(q,'synthetic-visual-first')});assert.equal(accepted.result.kind,'committed');
 const locked=JSON.parse(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(q.targetId).asset);assert.equal(locked.level,initial.level);assert.deepEqual(locked.traits,initial.traits);assert.equal(locked.rerolls,0);assert.equal(locked.eligibleAt,0);assert.equal(locked.expiresAt,initial.expiresAt);
 const op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(accepted.result.value.operationId),fulfilledAt=f.nowMs+3600123;
 fulfillProgression(db,{operationId:op.id,commitment:op.commitment,proofId:'synthetic-visual-proof',at:fulfilledAt,finalized:true,traits:{model:'Synthetic second',backdrop:'Synthetic dusk',symbol:'Synthetic ring'}},fulfilledAt);
 const finished=JSON.parse(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(q.targetId).asset);assert.equal(finished.rerolls,1);assert.equal(finished.level,10);assert.equal(finished.eligibleAt,fulfilledAt+3600000);assert.equal(finished.expiresAt,initial.expiresAt);
 const quoteInput={requestKey:'synthetic-second-visual',inventoryId:f.inventoryId,...f.request(10,'visual'),expectedTargetVersion:2};assert.equal((await call({method:'quote',input:quoteInput,nowMs:finished.eligibleAt-1})).result.reason,'reroll_cooldown');
 const next=await call({method:'quote',input:quoteInput,nowMs:finished.eligibleAt});assert.equal(next.result.kind,'committed');assert.equal(next.result.value.feeLamports,'20000000');assert.equal((await call({input:reviewedReservation(next.result.value,'synthetic-visual-second'),nowMs:finished.eligibleAt})).result.kind,'committed');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_level_history').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});
