import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {seedCollectionContext} from '../../application/fixtures/collection-context.mjs';
import {encode58} from '../../server/base58.mjs';
import {createClient} from '../../contracts/client.mjs';
const origin='http://localhost',key=()=>{const keys=generateKeyPairSync('ed25519');return {...keys,wallet:encode58(keys.publicKey.export({type:'spki',format:'der'}).subarray(-32))};};
async function actor(fetch,keys){
 const a={cookie:'',statuses:[]};a.raw=(path,init={})=>fetch(origin+'/api/v1'+path,{...init,headers:{origin,cookie:a.cookie,...init.headers}});
 a.client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{const headers=new Headers(init.headers);headers.set('origin',origin);if(a.cookie)headers.set('cookie',a.cookie);const response=await fetch(url,{...init,headers});a.statuses.push(response.status);if(response.headers.has('set-cookie'))a.cookie=response.headers.get('set-cookie').split(';')[0];return response;}});
 const challenge=await a.client.createWalletChallenge({body:{wallet:keys.wallet}});await a.client.verifyWalletSignature({body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),keys.privateKey))}});return a;
}
async function exercise(fetch,keys,f,sql){
 const [a,outside]=await Promise.all(keys.map(k=>actor(fetch,k))),path={id:f.inventoryId},body=f.request(1),route='/collect/inventories/'+f.inventoryId+'/progression';
 const capabilities=await (await a.raw('/capabilities')).json(),routes=capabilities.features.flatMap(feature=>feature.routes.map(r=>r.method+' '+r.path));
 assert.equal(routes.filter(r=>r==='POST /api/v1/collect/inventories/{id}/progression').length,1);assert.ok(routes.includes('POST /api/v1/collect/inventories/{id}/progression/quote'));assert.equal(capabilities.production.financialExecution,false);
 const missing=await fetch(origin+'/api/v1'+route+'/quote',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(missing.status,401);
 const q=(await a.client.quoteLocalProgression({path,body,idempotencyKey:'reviewed-quote'})).data;assert.equal(q.source,'local-fixture');assert.equal(q.executable,false);assert.equal(q.totalCost,'unknown');assert.equal(q.networkCost,'unknown');assert.equal(q.quoteExpiresMs-Date.parse(q.asOf),120000);assert.equal(q.materialProbabilities.reduce((sum,r)=>sum+r.count,0),1000);
 const reviewed={...body,quoteId:q.quoteId,bindingDigest:q.bindingDigest,policyVersion:q.policyVersion,reviewedFeeLamports:q.feeLamports,reviewedMaxTotalLamports:q.maxTotalLamports,quoteExpiresMs:q.quoteExpiresMs};
 await assert.rejects(a.client.reserveLocalProgression({path,body,idempotencyKey:'legacy-body'}),e=>e.status===400);
 await assert.rejects(outside.client.reserveLocalProgression({path,body:reviewed,idempotencyKey:'wrong-wallet'}),e=>e.status===404&&e.code==='stored-quote-missing');
 await assert.rejects(a.client.reserveLocalProgression({path,body:{...reviewed,reviewedFeeLamports:'1'},idempotencyKey:'wrong-fee'}),e=>e.status===409&&e.code==='quote-reviewed-terms-mismatch');
 const reserve=()=>a.client.reserveLocalProgression({path,body:reviewed,idempotencyKey:'reviewed-reservation'}),accepted=await Promise.all([reserve(),reserve()]);
 assert.deepEqual(accepted.map(r=>r.data.replayed).sort(),[false,true]);assert.deepEqual(accepted[0].data.operation,accepted[1].data.operation);assert.deepEqual(a.statuses.slice(-2).sort(),[200,201]);
 const op=accepted[0].data.operation;assert.equal(op.quoteId,q.quoteId);assert.equal(op.bindingDigest,q.bindingDigest);assert.equal(op.owner,keys[0].wallet);assert.equal(op.status,'awaiting-evidence');assert.equal(op.executable,false);
 assert.deepEqual((await a.client.quoteLocalProgression({path,body,idempotencyKey:'reviewed-quote'})).data,q);
 await assert.rejects(a.client.reserveLocalProgression({path,body:{...reviewed,reviewedMaxTotalLamports:'99999999'},idempotencyKey:'reviewed-reservation'}),e=>e.status===409&&e.code==='idempotency_conflict');
 await sql("INSERT INTO ops_scope_log VALUES('synthetic-http-pause','collection-progression',1,NULL,?,'synthetic-operator','fixture pause','synthetic-evidence','synthetic-http-pause')",[Date.now()-1]);
 assert.deepEqual((await reserve()).data,{operation:op,replayed:true});
 const q2=(await a.client.quoteLocalProgression({path,body:f.request(2),idempotencyKey:'paused-quote'})).data;
 await assert.rejects(a.client.reserveLocalProgression({path,body:{...f.request(2),quoteId:q2.quoteId,bindingDigest:q2.bindingDigest,policyVersion:q2.policyVersion,reviewedFeeLamports:q2.feeLamports,reviewedMaxTotalLamports:q2.maxTotalLamports,quoteExpiresMs:q2.quoteExpiresMs},idempotencyKey:'paused-reservation'}),e=>e.status===503&&e.code==='operator-pause');
 for(const [input,headers,status]of [[body,{'idempotency-key':''},400],[body,{origin:'http://other.invalid'},403],['x'.repeat(4097),{},413],[{...body,wallet:keys[0].wallet},{},400]]){
  const r=await outside.raw(route+'/quote',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'invalid-request',...headers},body:typeof input==='string'?input:JSON.stringify(input)});assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');
 }
 assert.equal((await outside.raw(route+'/quote?wallet=other',{method:'POST'})).status,400);assert.equal((await outside.raw(route+'/quote')).status,405);
 const old=await sql('SELECT asset FROM collect_assets WHERE id IN (?,?)',[body.targetId,body.materialId]);for(const row of old)assert.equal(JSON.parse(row.asset).pending,op.id);
 assert.equal((await sql('SELECT COUNT(*) n FROM app_collection_reservations',[]))[0].n,1);assert.equal((await sql('SELECT COUNT(*) n FROM tx_intents',[]))[0].n,0);
 await sql('UPDATE sessions SET expires_at=0',[]);assert.equal((await a.raw(route+'/quote',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'expired-session'},body:JSON.stringify(body)})).status,401);
 return {reservations:1,quotes:2,authenticatedWallets:2,exactReplay:true,financialExecution:false};
}
test('mounted Node/Worker progression requires stored reviewed quotes with real wallet auth and exact replay',async t=>{
 const {mf,db:d1}=await localRuntime(t,new URL('../src/worker.ts',import.meta.url)),db=openDatabase();t.after(()=>db.close());const keys=[key(),key()],f=seedCollectionContext(db);
 db.prepare('UPDATE collect_assets SET owner=?,asset=replace(asset,?,?)').run(keys[0].wallet,f.wallet,keys[0].wallet);db.prepare('UPDATE vault_assets SET owner=?').run(keys[0].wallet);db.prepare('UPDATE vault_observations SET body=replace(body,?,?)').run(f.wallet,keys[0].wallet);
 for(const table of ['collect_inventories','collect_assets','vault_assets','vault_observations']){const rows=db.prepare('SELECT * FROM '+table).all();await d1.batch(rows.map(row=>{const columns=Object.keys(row);return d1.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row));}));}
 const app=createApp(db),node=await exercise((url,init)=>app(new Request(url,init)),keys,f,async(query,args)=>{const stmt=db.prepare(query);return /^SELECT/.test(query)?stmt.all(...args):(stmt.run(...args),[]);});
 const edge=await exercise((url,init)=>mf.dispatchFetch(url,init),keys,f,async(query,args)=>{const statement=d1.prepare(query).bind(...args);return /^SELECT/.test(query)?(await statement.all()).results:(await statement.run(),[]);});
 assert.deepEqual(edge,node);t.diagnostic(JSON.stringify({...node,runtimes:2,publicQuoteAndReservationMounted:true}));
});
