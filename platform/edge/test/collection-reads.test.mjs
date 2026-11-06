import test from 'node:test';
import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {createCollectionEdgeFixture} from '../../application/fixtures/collection-edges.mjs';
import {createCollectionReadRepository} from '../../collect/read-model.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {dispatchProgressionReservation,reviewedReservation} from '../../collect/reservation-test-harness.mjs';
import {dispatchCollectionObservation,observationInput,OBSERVATION_TEST_OPERATOR} from '../../collect/observation-test-harness.mjs';
import {memoryArtifacts} from '../../application/fixtures/memory-artifacts.mjs';
import {createClient} from '../../contracts/client.mjs';
import {encode58} from '../../server/base58.mjs';
import {measureBatch} from '../../storage/atomic-driver.mjs';
const origin='http://localhost';
test('actual D1 collection reads preserve paged owner/private DTOs, quote identity and retained external-transfer holds',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/collection-read-worker.ts',import.meta.url),{nodeCompat:true}),f=await createCollectionEdgeFixture({assetCount:28,startServer:false});t.after(()=>f.close());
 for(const table of ['collect_inventories','collect_operations','collect_assets','vault_assets','vault_observations']){const rows=f.db.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=40)await db.batch(rows.slice(offset,offset+40).map(row=>{const columns=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row));}));}
 const base=createNodeAtomicDriver(f.db),measurements=[];const driver={...base,async batch(statements){const m=measureBatch(statements),result=await base.batch(statements);measurements.push({...m,maximumRows:Math.max(...result.map(r=>r.rows.length))});return result;}};
 const reads=createCollectionReadRepository(driver),principal={kind:'wallet',wallet:f.accounts.original.wallet},crypto=createNodeCrypto(),store=memoryArtifacts();
 const edge=async body=>{const response=await mf.dispatchFetch(origin+'/__fixture',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 for(const method of ['listOwnedAssets','listOwnOperations']){let after='';do{const query={principal,nowMs:f.nowMs,after},node=await reads[method](query),actual=await edge({lane:'read',method,query});assert.deepEqual(actual,node);after=node.value.nextCursor;}while(after);}
 for(const assetId of ['synthetic-genesis-before','synthetic-genesis-late','synthetic-season-000'])assert.deepEqual(await edge({lane:'read',method:'readAsset',query:{assetId,nowMs:f.nowMs}}),await reads.readAsset({assetId,nowMs:f.nowMs}));
 assert.equal(Math.max(...measurements.map(m=>m.maximumRows)),26);assert.ok(measurements.every(m=>m.statements===3));
 const nodeCall=request=>request.lane==='reservation'?dispatchProgressionReservation({driver:base,crypto,request}):dispatchCollectionObservation({driver:base,crypto,store,request});
 const both=async request=>{const node=await nodeCall(request),actual=await edge(request);assert.equal(node.result?.kind,'committed',JSON.stringify(node));assert.equal(actual.result?.kind,node.result.kind,JSON.stringify(actual));assert.deepEqual(actual.result.value,node.result.value);assert.equal(actual.result.receipt.outputDigest,node.result.receipt.outputDigest);return node.result.value;};
 const q=await both({lane:'reservation',method:'quote',principal,nowMs:f.nowMs,idPrefix:'read-d1-quote',input:{requestKey:'read-d1-quote',inventoryId:f.seasonId,kind:'upgrade',targetId:'synthetic-season-000',materialId:'synthetic-season-001',expectedTargetVersion:0,expectedMaterialVersion:0}});
 const operation=await both({lane:'reservation',principal,nowMs:f.nowMs,idPrefix:'read-d1-reserve',input:reviewedReservation(q,'read-d1-reserve')});
 for(const scope of ['evidence-ingest','collection-evidence']){f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(OBSERVATION_TEST_OPERATOR.id,scope);await db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(OBSERVATION_TEST_OPERATOR.id,scope).run();}
 const events=[{id:'away',kind:'transfer',observedMs:f.nowMs-1000,from:principal.wallet,to:f.accounts.buyer.wallet}];
 const evidence=await both({method:'evidence',inventoryId:f.seasonId,assetId:'synthetic-season-000',events,recordId:'away',nowMs:f.nowMs+10000,idPrefix:'read-d1-evidence'});
 await both({input:observationInput(evidence,{requestKey:'read-d1-away',expectedAssetVersion:1}),nowMs:f.nowMs+10000,idPrefix:'read-d1-observe'});
 const query={principal,operationId:operation.operationId,nowMs:f.nowMs+10000},expected=await reads.readOwnOperation(query);assert.deepEqual(await edge({lane:'read',method:'readOwnOperation',query}),expected);assert.equal(expected.value.status,'awaiting-evidence');assert.equal(expected.value.reconciliation.reason,'external-transfer');assert.equal(expected.value.quoteId,q.id);
 // Actual public auth and generated client, not a fixture principal transport.
 async function clientFor(account){let cookie='';const client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{const headers=new Headers(init.headers);headers.set('origin',origin);headers.set('cookie',cookie);const response=await mf.dispatchFetch(url,{...init,headers});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}});const challenge=await client.createWalletChallenge({body:{wallet:account.wallet}});await client.verifyWalletSignature({body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),account.privateKey))}});return {client,raw:(path,init={})=>mf.dispatchFetch(origin+'/api/v1'+path,{...init,headers:{cookie,...init.headers}})};}
 const owner=await clientFor(f.accounts.original),buyer=await clientFor(f.accounts.buyer);
 const capabilities=await (await mf.dispatchFetch(origin+'/api/v1/capabilities')).json(),feature=capabilities.features.find(f=>f.id==='collection-asset-operation-read');assert.equal(feature.routes.length,4);assert.equal(capabilities.production.financialExecution,false);assert.ok(capabilities.features.some(f=>f.id==='collection-inventory-read'));
 const publicAsset=(await owner.client.readLocalAsset({path:{id:'synthetic-season-000'}})).data;assert.equal(publicAsset.owner,f.accounts.buyer.wallet);assert.equal(publicAsset.operationPending,true);assert.equal(publicAsset.reconciliation,undefined);
 const held=(await owner.client.readMyCollectionOperation({path:{id:operation.operationId}})).data;assert.equal(held.quoteId,q.id);assert.deepEqual(held.reconciliation,expected.value.reconciliation);assert.equal(held.status,'awaiting-evidence');
 await assert.rejects(buyer.client.readMyCollectionOperation({path:{id:operation.operationId}}),e=>e.status===404);assert.equal((await mf.dispatchFetch(origin+'/api/v1/collect/me/assets')).status,401);
 assert.equal((await owner.raw('/collect/me/assets?cursor=x&cursor=y')).status,400);assert.equal((await owner.raw('/collect/me/operations',{method:'POST'})).status,405);assert.equal((await owner.raw('/collect/inventories')).status,200);
 const page=await owner.client.listMyCollectionAssets();assert.equal(page.items.length,25);assert.ok(page.nextCursor);const next=await owner.client.listMyCollectionAssets({query:{cursor:page.nextCursor}});assert.ok(next.items.length>0);assert.ok(![...page.items,...next.items].some(a=>a.id==='synthetic-season-000'));
 await db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await owner.raw('/collect/me/operations')).status,401);
 t.diagnostic(JSON.stringify({runtimes:2,maximumRows:26,statementsPerRead:3,maxParameters:Math.max(...measurements.map(m=>m.maxParameters)),maxBatchBytes:Math.max(...measurements.map(m=>m.batchBytes)),actualB04Hold:true,realWalletAuth:true,financialExecution:false}));
});
