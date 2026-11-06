import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {seedCollectionContext} from '../../application/fixtures/collection-context.mjs';
import {dispatchCollectionQuote} from '../../collect/quote-test-harness.mjs';

test('actual Node/D1 stored progression quotes have exact private receipt parity, expiry and source fencing, rollback and lost-response recovery',async t=>{
 const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),driver=createNodeAtomicDriver(db),crypto=createNodeCrypto(),edge=await localRuntime(t,new URL('./fixtures/collection-quotes-worker.ts',import.meta.url));
 for(const table of ['collect_inventories','vault_assets','vault_observations','collect_assets']){
  const rows=db.prepare('SELECT * FROM '+table).all();await edge.db.batch(rows.map(row=>{const keys=Object.keys(row);return edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));
 }
 for(const row of db.prepare('SELECT * FROM app_revisions').all())await edge.db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(row.revision,row.name).run();
 let seq=0,paired=0,maxStatements=0,maxBatchBytes=0,maxParameters=0;
 const request=(level,key)=>({requestKey:key,inventoryId:f.inventoryId,...f.request(level,level===10?'visual':'upgrade')});
 const both=async(patch={})=>{
  const input={principal:{kind:'wallet',wallet:f.wallet},nowMs:f.nowMs,idPrefix:'synthetic-quote-pair-'+(++seq),input:request(1,'synthetic-original'),...patch};
  const a=await dispatchCollectionQuote({driver,crypto,request:input}),response=await edge.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(input)});assert.equal(response.status,200);const b=await response.json();assert.deepEqual(b,a);
  paired++;maxStatements=Math.max(maxStatements,a.metrics.statements);maxBatchBytes=Math.max(maxBatchBytes,a.metrics.maxBatchBytes);maxParameters=Math.max(maxParameters,a.metrics.maxParameters);return a;
 };
 const write=async(sql,...values)=>{db.prepare(sql).run(...values);await edge.db.prepare(sql).bind(...values).run();};
 const first=await both();assert.equal(first.result.kind,'committed');const quote=first.result.value;assert.equal(quote.expiresMs,quote.asOfMs+120000);assert.equal(quote.totalCost,'unknown');assert.equal(quote.costQuote.network.amountLamports,null);assert.equal(quote.executable,false);
 assert.equal((await both({method:'read',id:quote.id})).result.lifetime,'within-window');assert.equal((await both({method:'read',id:quote.id,principal:{kind:'wallet',wallet:f.other}})).result.kind,'missing');
 assert.equal((await both({input:request(2,'synthetic-original')})).result.code,'idempotency_conflict');
 await write('UPDATE collect_assets SET owner=? WHERE id=?',f.other,quote.targetId);
 const replay=await both({nowMs:quote.expiresMs});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,quote);
 const expired=await both({method:'read',id:quote.id,nowMs:quote.expiresMs});assert.equal(expired.result.lifetime,'expired');assert.equal(expired.result.currentStateVerified,false);
 assert.equal((await both({input:request(1,'synthetic-owner-revoked')})).result.reason,'owner-changed');
 for(const fault of ['source-change','control-change','owner-change']){
  const r=await both({fault,other:f.other,input:request(fault==='owner-change'?3:2,'synthetic-'+fault)});assert.equal(r.injected,true);assert.equal(r.result.code,'revision_conflict');
 }
 for(const fault of ['expire-during-hash','expire-in-batch']){const r=await both({fault,input:request(2,'synthetic-'+fault)});assert.equal(r.injected,true);assert.equal(r.result.reason,'quote-expired-before-storage');}
 const omitted=await both({fault:'omit-child',input:request(2,'synthetic-omitted')});assert.equal(omitted.status,500);assert.equal(omitted.error,'mandatory-child-aborted');
 const forged=await both({method:'forged',input:request(2,'synthetic-forged')});assert.equal(forged.status,500);assert.match(forged.error,/digest or identity mismatch/);
 const lost=await both({fault:'lost-response',input:request(2,'synthetic-lost')});assert.equal(lost.result.kind,'replayed');assert.equal(lost.injected,true);
 for(let level=4;level<=10;level++){const r=await both({input:request(level,'synthetic-level-'+level)});assert.equal(r.result.kind,'committed');assert.equal(r.result.value.materialId,level===10?null:f.ids(level,'material'));}
 const nowMs=Date.now(),at=nowMs%1000===0?nowMs-1:nowMs,production=await both({productionClock:true,nowMs:at,input:request(2,'synthetic-production-clock')});assert.equal(production.result.kind,'committed');assert.equal(production.result.value.asOfMs,at);assert.notEqual(at%1000,0);
 const concurrent={principal:{kind:'wallet',wallet:f.wallet},nowMs:f.nowMs,idPrefix:'synthetic-concurrent',input:request(4,'synthetic-concurrent')};
 const nodeRace=await Promise.all([1,2].map(()=>dispatchCollectionQuote({driver,crypto,request:concurrent}))),edgeRace=await Promise.all([1,2].map(async()=>{const r=await edge.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(concurrent)});assert.equal(r.status,200);return r.json();}));
 for(const results of [nodeRace,edgeRace]){assert.deepEqual(results.map(r=>r.result.kind).sort(),['committed','replayed']);assert.deepEqual(results[0].result.value,results[1].result.value);}assert.deepEqual(edgeRace[0].result.value,nodeRace[0].result.value);paired+=2;
 const nodeRows=db.prepare('SELECT * FROM app_collection_quotes ORDER BY id').all().map(r=>({...r})),edgeRows=(await edge.db.prepare('SELECT * FROM app_collection_quotes ORDER BY id').all()).results;assert.deepEqual(edgeRows,nodeRows);assert.equal(nodeRows.length,11);
 for(const table of ['collect_operations','tx_intents','tx_attempts']){assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),0);}
 const receiptSql="SELECT * FROM app_command_receipts WHERE operation_kind='collection.issue-quote.v1' ORDER BY operation_id";assert.deepEqual((await edge.db.prepare(receiptSql).all()).results,db.prepare(receiptSql).all().map(r=>({...r})));
 t.diagnostic(JSON.stringify({pairedCalls:paired,quotes:nodeRows.length,maxStatements,maxBatchBytes,maxParameters,publicIssuance:false,reservations:0,financialExecution:false}));
});
