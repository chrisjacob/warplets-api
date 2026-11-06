import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createApp} from '../../server/application.mjs';
import {localRuntime} from './local-runtime.mjs';
import {mintFixture} from '../../collect/mint-test-fixture.mjs';
import {createClient} from '../../contracts/client.mjs';
import {encode58} from '../../server/base58.mjs';
const origin='http://localhost';
async function actor(mf){const keys=generateKeyPairSync('ed25519'),wallet=encode58(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));let cookie='';const client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{const headers=new Headers(init.headers);headers.set('origin',origin);headers.set('cookie',cookie);const response=await mf.dispatchFetch(url,{...init,headers});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}});const c=await client.createWalletChallenge({body:{wallet}});await client.verifyWalletSignature({body:{nonce:c.data.nonce,signature:encode58(sign(null,Buffer.from(c.data.message),keys.privateKey))}});return {wallet,client,send:(path,init)=>mf.dispatchFetch(origin+path,{...init,headers:{origin,cookie,...init?.headers}})};}
for(const runtime of ['node','d1'])test(runtime+' mounted mint uses production wallet sessions and keeps exact reviewed retry',async t=>{
 const f=await mintFixture(t,{type:'public',admissionAtMs:Date.now()-10000});let mf,db;if(runtime==='d1')({mf,db}=await localRuntime(t,new URL('../src/worker.ts',import.meta.url)));else{const app=createApp(f.db);mf={dispatchFetch:(url,init)=>app(new Request(url,init))};db={prepare:query=>({run:async()=>f.db.prepare(query).run(),first:async key=>f.db.prepare(query).get()?.[key],bind:(...args)=>({run:async()=>f.db.prepare(query).run(...args)})})};}
 if(runtime==='d1')for(const table of ['app_operator_scopes','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_eligibility_pages','collect_inventories','app_collection_authorities','app_collection_stages']){const rows=f.db.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=20)await db.batch(rows.slice(offset,offset+20).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));}
 const a=await actor(mf),b=await actor(mf),path='/api/v1/collect/inventories/'+f.input.inventoryId+'/stages/'+f.input.stageId+'/reservations',body={expectedTermsDigest:f.published.value.termsDigest},request={method:'POST',headers:{'content-type':'application/json','idempotency-key':'synthetic-reviewed-mint'},body:JSON.stringify(body)};
 assert.equal((await mf.dispatchFetch(origin+path,{...request,headers:{...request.headers,origin}})).status,401);
 const [one,two]=await Promise.all([a.send(path,request),a.send(path,request)]);assert.deepEqual([one.status,two.status].sort(),[200,201]);const first=await one.json(),second=await two.json();assert.deepEqual(first.operation,second.operation);assert.equal(first.operation.owner,a.wallet);assert.equal(first.operation.termsDigest,body.expectedTermsDigest);assert.equal(first.operation.executable,false);assert.doesNotMatch(JSON.stringify(first),/commitment|targetRound|contextDigest|ticket|traits/);
 assert.equal((await a.send(path,{...request,body:JSON.stringify({expectedTermsDigest:'0'.repeat(64)})})).status,409);
 await db.prepare("INSERT INTO ops_scope_log VALUES('synthetic-mint-pause','collection-mint',1,NULL,?,'synthetic-operator','fixture pause','synthetic-evidence','synthetic-mint-pause')").bind(Date.now()-1).run();assert.equal((await a.send(path,request)).status,200);assert.equal((await b.send(path,request)).status,503);
 assert.deepEqual((await a.client.readMyCollectionOperation({path:{id:first.operation.id}})).data,first.operation);
 const caps=await (await a.send('/api/v1/capabilities')).json();assert.ok(caps.features.flatMap(f=>f.routes).some(r=>r.path.endsWith('/stages/{stage}/reservations')));assert.equal(caps.production.financialExecution,false);
 const get=await b.client.readMyCollectionOperation({path:{id:first.operation.id}}).then(()=>200,e=>e.status);assert.equal(get,404);
 await a.client.revokeSession();assert.equal((await a.send(path,request)).status,401);await db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await b.send(path,request)).status,401);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').first('n'),1);assert.equal(await db.prepare('SELECT COUNT(*) n FROM tx_intents').first('n'),0);
});
