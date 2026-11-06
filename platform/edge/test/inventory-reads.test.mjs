import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {governanceOperatorFixture,governanceWallets} from '../../governance/operator-test-fixture.mjs';
import {createCollection,publishCollectionStage} from '../../collect/store.mjs';
import {createStagePublicationRepository} from '../../collect/stage-repository.mjs';
import {createStagePublicationService} from '../../collect/stage-service.mjs';
import {createInventoryReadRepository} from '../../collect/inventory-read-model.mjs';
import {createClient} from '../../contracts/client.mjs';
import {encode58} from '../../server/base58.mjs';
const origin='http://localhost';
function account(){const keys=generateKeyPairSync('ed25519');return {...keys,wallet:encode58(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32))};}

test('actual D1 and production inventory routes preserve normalized10000-member and bounded legacy views with real wallet sessions',async t=>{
 const owner=account(),other=account(),holders=[...governanceWallets(9999),owner.wallet].sort(),f=await governanceOperatorFixture(t,{holders,nextWhitelist:[]}),{mf,db}=await localRuntime(t,new URL('./fixtures/inventory-read-worker.ts',import.meta.url));
 const inventoryId='synthetic-normalized-read',publisher={kind:'operator',id:'synthetic-inventory-publisher'};createCollection(f.db,{id:inventoryId,kind:'genesis',tranche:1});f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(publisher.id,'collection-publication');
 const input={inventoryId,stageId:'synthetic-stage',type:'whitelist',publishedAt:f.getNow(),opensAt:f.getNow()+172800000,closesAt:f.getNow()+259200000,priceLamports:'100000000',costLamports:'500000',allocation:1000,walletLimit:null,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture'};
 assert.equal((await createStagePublicationService({...f.ports,repository:createStagePublicationRepository(f.base,f.ports)}).publishStage(publisher,{input,requestKey:'synthetic-publish'})).kind,'committed');
 createCollection(f.db,{id:'synthetic-legacy-read',kind:'season',seasonStart:f.getNow()});publishCollectionStage(f.db,{inventoryId:'synthetic-legacy-read',stage:{id:'synthetic-legacy-stage',type:'whitelist',publishedAt:f.getNow(),opensAt:f.getNow()+1000,closesAt:f.getNow()+86400000,priceLamports:'100000000',costLamports:'500000',allocation:1000,walletLimit:2,wallets:[owner.wallet]}},f.getNow());
 for(const table of ['app_operator_scopes','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_eligibility_pages','collect_inventories','app_collection_authorities','app_collection_stages']){
  const rows=f.db.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=20)await db.batch(rows.slice(offset,offset+20).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));
 }
 const reads=createInventoryReadRepository(f.base);
 for(const principal of [null,{kind:'wallet',wallet:owner.wallet},{kind:'wallet',wallet:other.wallet}]){
  const query={nowMs:input.opensAt,principal},expected=await reads.listInventories(query),actual=await (await mf.dispatchFetch(origin+'/__fixture/inventory-read',{method:'POST',body:JSON.stringify({method:'listInventories',query})})).json();assert.deepEqual(actual,expected);assert.equal(actual.kind,'ready');assert.equal(actual.value.items.length,2);
 }
 async function clientFor(account){let cookie='';const client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{const headers=new Headers(init.headers);headers.set('origin',origin);headers.set('cookie',cookie);const response=await mf.dispatchFetch(url,{...init,headers});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}});const challenge=await client.createWalletChallenge({body:{wallet:account.wallet}});await client.verifyWalletSignature({body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),account.privateKey))}});return {client,raw:(path,init={})=>mf.dispatchFetch(origin+'/api/v1'+path,{...init,headers:{cookie,...init.headers}})};}
 const signed=await clientFor(owner),outsider=await clientFor(other);
 for(const [client,wallet] of [[signed,owner.wallet],[outsider,other.wallet]]){
  const view=(await client.client.readLocalInventory({path:{id:inventoryId}})).data,expected=await reads.readInventory({inventoryId,nowMs:Date.parse(view.asOf),principal:{kind:'wallet',wallet}});assert.deepEqual(view,expected.value);assert.equal(view.stages[0].eligible,wallet===owner.wallet);assert.equal(view.executable,false);
  const listed=await client.client.listLocalInventories();assert.equal(listed.items.length,2);assert.equal(listed.items.find(i=>i.id===inventoryId).stages[0].eligible,wallet===owner.wallet);
 }
 const anonymous=await (await mf.dispatchFetch(origin+'/api/v1/collect/inventories/'+inventoryId)).json();assert.equal(anonymous.stages[0].eligible,null);assert.equal(anonymous.stages[0].eligibility.reason,'wallet-not-connected');
 const capabilities=await (await mf.dispatchFetch(origin+'/api/v1/capabilities')).json(),feature=capabilities.features.find(f=>f.id==='collection-inventory-read');assert.equal(feature.routes.length,2);assert.equal(capabilities.production.financialExecution,false);assert.ok(!capabilities.features.flatMap(f=>f.routes).some(r=>r.path.endsWith('/stages/{stage}/reservations')));
 assert.equal((await signed.raw('/collect/inventories?wallet='+other.wallet)).status,400);assert.equal((await signed.raw('/collect/inventories?cursor=x&cursor=y')).status,400);assert.equal((await signed.raw('/collect/inventories/'+inventoryId+'?cursor=x')).status,400);assert.equal((await signed.raw('/collect/inventories/'+inventoryId,{method:'POST'})).status,405);assert.equal((await signed.raw('/collect/inventories/missing')).status,404);
 await db.prepare('UPDATE sessions SET expires_at=0').run();const expired=await (await signed.raw('/collect/inventories/'+inventoryId)).json();assert.equal(expired.stages[0].eligible,null);
 t.diagnostic(JSON.stringify({runtimes:2,normalizedMembers:10000,legacyCompatibility:true,realWalletAuth:true,expiredSessionPublicOnly:true,financialExecution:false}));
});
