import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {dispatchCollectionQuote} from './quote-test-harness.mjs';
import {createCollectionQuoteRepository} from './quote-repository.mjs';
import {createCollectionQuoteService} from './quote-service.mjs';
const crypto=createNodeCrypto();
function setup(t){const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),driver=createNodeAtomicDriver(db);let seq=0;
 const call=(patch={})=>dispatchCollectionQuote({driver,crypto,request:{principal:{kind:'wallet',wallet:f.wallet},nowMs:f.nowMs,idPrefix:'synthetic-quote-'+(++seq),input:{requestKey:'synthetic-issue',inventoryId:f.inventoryId,...f.request(1)},...patch}});return {db,f,driver,call};}

test('stored progression quote is immutable, private, locally costed and replayable after expiry and ownership changes',async t=>{
 const {db,f,call}=setup(t),first=await call();assert.equal(first.result.kind,'committed');const q=first.result.value;
 assert.equal(q.expiresMs-q.asOfMs,120000);assert.equal(q.feeLamports,q.maxTotalLamports);assert.equal(q.executable,false);assert.equal(q.totalCost,'unknown');assert.equal(q.costQuote.network.amountLamports,null);
 const row=db.prepare('SELECT q.*,r.created_ms,r.expected_revisions FROM app_collection_quotes q JOIN app_command_receipts r ON r.operation_id=q.operation_id').get();assert.equal(row.as_of_ms,row.created_ms);assert.equal(row.source_revisions_json,row.expected_revisions);
 assert.throws(()=>db.prepare('UPDATE app_collection_quotes SET fee_lamports=?').run('0'),/immutable/);assert.throws(()=>db.prepare('DELETE FROM app_collection_quotes').run(),/Retain/);
 assert.equal((await call({method:'read',id:q.id})).result.lifetime,'within-window');assert.equal((await call({method:'read',id:q.id,principal:{kind:'wallet',wallet:f.other}})).result.kind,'missing');
 db.prepare('UPDATE collect_assets SET owner=? WHERE id=?').run(f.other,q.targetId);
 const replay=await call({nowMs:q.expiresMs});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,q);
 const historical=(await call({method:'read',id:q.id,nowMs:q.expiresMs})).result;assert.equal(historical.lifetime,'expired');assert.equal(historical.currentStateVerified,false);assert.deepEqual(historical.quote,q);
 assert.equal((await call({input:{requestKey:'synthetic-issue',inventoryId:f.inventoryId,...f.request(2)}})).result.code,'idempotency_conflict');
 assert.equal((await call({input:{requestKey:'new-key',inventoryId:f.inventoryId,...f.request(1)}})).result.reason,'owner-changed');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_quotes').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});

test('fresh quote independently derives bounded context and fences source, control, owner, expiry and omitted effects',async t=>{
 const {db,f,call}=setup(t);let n=0;
 const issue=(fault,level=2)=>call({fault,other:f.other,input:{requestKey:'synthetic-fault-'+(++n),inventoryId:f.inventoryId,...f.request(level)}});
 for(const fault of ['source-change','control-change']){const r=await issue(fault);assert.equal(r.injected,true);assert.equal(r.result.code,'revision_conflict');}
 for(const fault of ['expire-during-hash','expire-in-batch']){const r=await issue(fault);assert.equal(r.injected,true);assert.equal(r.result.reason,'quote-expired-before-storage');}
 const omitted=await issue('omit-child');assert.equal(omitted.status,500);assert.equal(omitted.error,'mandatory-child-aborted');
 const owner=await issue('owner-change',3);assert.equal(owner.result.code,'revision_conflict');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_quotes').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='collection.issue-quote.v1'").get().n,0);
 const forged=await call({method:'forged'});assert.equal(forged.status,500);assert.match(forged.error,/digest or identity mismatch/);
 const lost=await issue('lost-response');assert.equal(lost.result.kind,'replayed');assert.equal(lost.injected,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_quotes').get().n,1);
 const visual=await call({input:{requestKey:'synthetic-visual',inventoryId:f.inventoryId,...f.request(10,'visual')}});assert.equal(visual.result.kind,'committed');assert.equal(visual.result.value.materialId,null);
});

test('concurrent request keys return one immutable server quote without a second accepted receipt',async t=>{
 const {db,f,driver}=setup(t);let id=0;const repository=createCollectionQuoteRepository({...driver,leaseNowSql:String(f.nowMs)},{crypto,clock:{nowMs:()=>f.nowMs},ids:{next:()=> 'synthetic-concurrent-'+(++id)}}),service=createCollectionQuoteService({repository,crypto});
 const input={requestKey:'synthetic-concurrent',inventoryId:f.inventoryId,...f.request(4)},principal={kind:'wallet',wallet:f.wallet};
 const results=await Promise.all([service.issueQuote(principal,input),service.issueQuote(principal,input)]);assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);assert.deepEqual(results[0].value,results[1].value);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_quotes').get().n,1);
});

test('production SQL clock admits millisecond-precision quotes without rounding reviewed asOf',async t=>{
 const {call}=setup(t),nowMs=Date.now(),at=nowMs%1000===0?nowMs-1:nowMs;
 const accepted=await call({productionClock:true,nowMs:at});assert.equal(accepted.result.kind,'committed');assert.equal(accepted.result.value.asOfMs,at);assert.notEqual(at%1000,0);
});

test('historical retrieval rejects indexed source metadata that disagrees with its accepted receipt',async t=>{
 const {call,f,driver}=setup(t),accepted=await call(),corrupt={...driver,async batch(statements){const results=await driver.batch(statements);return results.map((result,index)=>statements[index].sql.startsWith('SELECT q.*')?{...result,rows:result.rows.map(row=>({...row,source_revisions_json:'{"control":"0","earn":"0","source":"0"}'}))}:result);}};
 const repository=createCollectionQuoteRepository(corrupt,{crypto,clock:{nowMs:()=>f.nowMs},ids:{next:()=> 'unused'}});
 assert.equal((await repository.readQuote({kind:'wallet',wallet:f.wallet},accepted.result.value.id)).reason,'quote-storage-conflict');
});
