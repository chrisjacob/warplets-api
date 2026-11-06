import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mintFixture} from './mint-test-fixture.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {createMintFulfillmentService} from './mint-fulfillment-service.mjs';
import {createMintFulfillmentRepository} from './mint-fulfillment-repository.mjs';
import {dispatchMintFulfillment,mintFulfillmentInput,MINT_FULFILLMENT_TEST_OPERATOR} from './mint-fulfillment-test-harness.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
import {seasonExpiry} from '../domain/collections/policy.mjs';
const proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url))),traits={model:'Synthetic model',backdrop:'Synthetic backdrop',symbol:'Synthetic symbol'};
const rows=(f,table)=>f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
async function fixture(t,{configured=false,kind='genesis',two=false}={}){
 const f=await mintFixture(t,{configured,kind,...(configured?{admissionAtMs:roundTime(proof.round)-leadMs}:{})});
 for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(MINT_FULFILLMENT_TEST_OPERATOR.id,scope);
 const service=createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)}),accepted=await service.reserveMint(f.principal,f.request);assert.equal(accepted.kind,'committed',JSON.stringify(accepted));const operations=[f.db.prepare('SELECT * FROM collect_operations WHERE id=?').get(accepted.value.operationId)];
 if(two){const next=await service.reserveMint({kind:'wallet',wallet:f.holders[1]},{...f.request,requestKey:'synthetic-second'});assert.equal(next.kind,'committed');operations.push(f.db.prepare('SELECT * FROM collect_operations WHERE id=?').get(next.value.operationId));}
 const store=memoryArtifacts(),atMs=configured?roundTime(proof.round):Math.ceil((f.getNow()+1000)/1000)*1000,beaconVerifier=configured?{verifyShortSignature:()=>true}:undefined;
 const call=request=>dispatchMintFulfillment({driver:f.base,crypto:f.ports.crypto,store,beaconVerifier,request:{nowMs:atMs+1000,idPrefix:'synthetic-mint-fulfill',...request}});
 const evidence=async(n=0,patch={},supersedes=null)=>{const op=operations[n],event={inventoryId:f.input.inventoryId,operationId:op.id,kind:'mint',commitment:op.commitment,provenance:configured?'configured-offline-beacon':'manual-fixture',atMs,proof:configured?proof:{proofId:'synthetic-mint-proof-'+n,assetId:'synthetic-mint-asset-'+n,ticket:0,traits},...patch},r=await call({method:'evidence',event,supersedes,idPrefix:'synthetic-mint-evidence-'+n});assert.ok(['committed','replayed'].includes(r.result?.kind),JSON.stringify(r));return r.result.value;};
 const ev=await evidence();return {...f,operations,store,atMs,call,evidence,input:mintFulfillmentInput(ev,'synthetic-mint-fulfill'),ev};
}
test('normalized mint atomically binds concealed Collect/Vault and preserves fixed quotas, original expiry and replay',async t=>{
 for(const kind of ['genesis','season']){const f=await fixture(t,{kind}),r=await f.call({input:f.input});assert.equal(r.result?.kind,'committed',JSON.stringify(r));const asset=f.db.prepare('SELECT * FROM collect_assets').get(),nft=JSON.parse(asset.asset),a=f.db.prepare('SELECT * FROM app_collection_authorities').get();assert.equal(asset.reveal_ms,null);assert.equal(nft.version,0);assert.equal(nft.pending,null);assert.equal(nft.level,1);assert.equal(a.admitted,1);assert.equal(a.fulfilled,1);assert.equal(JSON.parse(a.remaining_json)[0],488);assert.equal(rows(f,'vault_assets'),1);assert.equal(rows(f,'vault_observations'),1);assert.equal(rows(f,'collect_level_history'),kind==='season'?1:0);if(kind==='season')assert.equal(nft.expiresAt,seasonExpiry(f.db.prepare('SELECT season_start FROM collect_inventories').get().season_start,1));assert.doesNotMatch(JSON.stringify(r.result.value),/level|traits|slot|proofId|commitment|ticket/);
  f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").run(MINT_FULFILLMENT_TEST_OPERATOR.id);f.store.objects.clear();const replay=await f.call({input:f.input,nowMs:f.atMs+10*86400000});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,r.result.value);assert.deepEqual(replay.result.receipt,r.result.receipt);
 }
});
test('all omitted mint child effects abort authority, asset, Vault, history and receipt together',async t=>{
 for(const fault of ['omit-asset','omit-vault','omit-bind','omit-history','omit-authority','omit-link','omit-settlement']){const f=await fixture(t,{kind:'season'}),before=rows(f,'app_command_receipts'),r=await f.call({input:f.input,fault});assert.equal(r.status,500,JSON.stringify(r));for(const table of ['collect_assets','vault_assets','vault_observations','collect_level_history','app_collection_mint_fulfillments'])assert.equal(rows(f,table),0);assert.equal(rows(f,'app_command_receipts'),before);assert.equal(f.db.prepare('SELECT fulfilled FROM app_collection_authorities').get().fulfilled,0);assert.equal(f.db.prepare('SELECT settled_ms FROM collect_operations').get().settled_ms,null);}
});
test('mint order cannot be skipped and retained second evidence works after the earlier admission settles',async t=>{
 const f=await fixture(t,{two:true}),second=await f.evidence(1),secondInput=mintFulfillmentInput(second,'synthetic-second-fulfill');assert.equal((await f.call({input:secondInput})).result.reason,'draw_out_of_order');assert.equal(rows(f,'collect_assets'),0);assert.equal((await f.call({input:f.input})).result.kind,'committed');assert.equal((await f.call({input:secondInput,idPrefix:'synthetic-second-fulfill'})).result.kind,'committed');assert.equal(rows(f,'collect_assets'),2);assert.equal(f.db.prepare('SELECT fulfilled FROM app_collection_authorities').get().fulfilled,2);
 assert.throws(()=>f.db.prepare('INSERT INTO collect_level_history(asset_id,effective_ms,level,source_ref) VALUES(?,?,?,?)').run('synthetic-mint-asset-1',f.atMs+1000,10,f.operations[0].id),/immutable|Retain/i);
});
test('raw evidence loss, supersession, revocation and async preparation expiry produce no mint effects',async t=>{
 for(const [fault,kind,reason] of [['missing-object','pending','mint-fulfillment-artifact-missing'],['corrupt-bytes','pending','mint-payload'],['head-change','conflict','revision_conflict'],['source-change','conflict','revision_conflict'],['revoke','conflict','revision_conflict'],['advance-final-hash','pending','mint-fulfillment-preparation-window-expired']]){const f=await fixture(t),before=rows(f,'app_command_receipts'),r=await f.call({input:f.input,fault,advanceMs:30001});assert.equal(rows(f,'app_command_receipts'),before);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.result.kind,kind);assert.equal(r.result.reason??r.result.code,reason);assert.equal(rows(f,'collect_assets'),0);assert.equal(f.db.prepare('SELECT fulfilled FROM app_collection_authorities').get().fulfilled,0);}
});
test('configured mint reuses the original verified request and atomically retains deterministic fair result',async t=>{
 // Trusted verifier injection exercises orchestration only. Actual pinned BLS
 // verification is required separately in workerd/beacon acceptance.
 const f=await fixture(t,{configured:true}),omitted=await f.call({input:f.input,fault:'omit-fair'});assert.equal(omitted.status,500);assert.equal(rows(f,'fair_results'),0);const r=await f.call({input:f.input,fault:'lost-response'});assert.equal(r.result.kind,'replayed',JSON.stringify(r));const result=f.db.prepare('SELECT * FROM fair_results').get(),materialized=JSON.parse(result.fixture),asset=f.db.prepare('SELECT * FROM collect_assets').get(),slot=JSON.parse(asset.slot);assert.equal(asset.id,materialized.assetId);assert.equal(materialized.at,roundTime(proof.round));assert.equal(materialized.commitment,f.operations[0].commitment);assert.equal(asset.id,f.db.prepare('SELECT asset_id FROM fair_reserved_assets WHERE slot_index=?').get([489,256,128,64,32,16,8,4,2,1].slice(0,slot.level-1).reduce((a,b)=>a+b,0)+slot.ordinal).asset_id);assert.equal(rows(f,'fair_results'),1);
});


test('mint mandatory effects independently reject coherently altered derived slots and Season expiry',async t=>{
 for(const [kind,fault] of [['genesis','wrong-derived-slot'],['season','wrong-derived-slot'],['season','wrong-season-expiry']]){
  const f=await fixture(t,{kind}),before=rows(f,'app_command_receipts'),r=await f.call({input:f.input,fault});assert.equal(r.injected,true);assert.equal(r.status,500,JSON.stringify(r));assert.equal(rows(f,'collect_assets'),0);assert.equal(rows(f,'app_collection_mint_fulfillments'),0);assert.equal(rows(f,'app_command_receipts'),before);assert.equal(f.db.prepare('SELECT fulfilled FROM app_collection_authorities').get().fulfilled,0);
 }
});

test('retained mint evidence cannot backdate an actual historical campaign snapshot or occupy a globally reserved asset',async t=>{
 for(const boundary of [-1,0,1]){
  const f=await fixture(t),at=f.atMs+boundary;
  // Explicit synthetic historical catalog and registry rows; the production query
  // must inspect their actual activation clock rather than trust caller coverage.
  f.db.prepare('INSERT INTO market_fixtures(id,att_mint,pool_address,body) VALUES(?,?,?,?)').run('synthetic-history','synthetic-att','synthetic-pool','{}');
  f.db.prepare('INSERT INTO vault_manifests VALUES(?,?,?,?,?,?,?)').run('synthetic-history',at,'1','1','1','[]','synthetic-digest');
  f.db.prepare('INSERT INTO local_campaign_registry VALUES(?,?,?,?,?,?)').run('synthetic-history','synthetic-day','synthetic-digest','synthetic-history-source',at,'{}');
  const before=rows(f,'app_command_receipts'),r=await f.call({input:f.input});
  if(boundary<0)assert.equal(r.result.kind,'committed',JSON.stringify(r));
  else{assert.equal(r.result.kind,'pending');assert.equal(r.result.reason,'mint-existing-asset-proof-or-snapshot');assert.equal(rows(f,'collect_assets'),0);assert.equal(rows(f,'app_command_receipts'),before);}
 }
 const f=await fixture(t),inventory=f.db.prepare('SELECT * FROM collect_inventories').get(),columns=Object.keys(inventory);
 f.db.prepare('INSERT INTO collect_inventories('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(k=>k==='id'?'synthetic-other-inventory':k==='tranche'?2:inventory[k]));
 f.db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run('synthetic-other-inventory','0'.repeat(64),'{}',f.atMs-1000);
 f.db.prepare('INSERT INTO fair_reserved_assets VALUES(?,?,?)').run('synthetic-other-inventory',0,'synthetic-mint-asset-0');
 const r=await f.call({input:f.input});assert.equal(r.result.kind,'pending');assert.equal(r.result.reason,'mint-existing-asset-proof-or-snapshot');assert.equal(rows(f,'collect_assets'),0);
});


test('concurrent mint verification resolves the accepted receipt when another contender binds first',async t=>{
 const f=await fixture(t),outcomes=await Promise.all([0,1].map(n=>f.call({input:f.input,idPrefix:'synthetic-node-contender-'+n})));
 assert.ok(outcomes.every(o=>o.status===200),JSON.stringify(outcomes));assert.deepEqual(outcomes.map(o=>o.result.kind).sort(),['committed','replayed']);assert.deepEqual(outcomes[0].result.value,outcomes[1].result.value);assert.deepEqual(outcomes[0].result.receipt,outcomes[1].result.receipt);assert.equal(rows(f,'collect_assets'),1);assert.equal(rows(f,'app_collection_mint_fulfillments'),1);assert.equal(f.db.prepare('SELECT fulfilled FROM app_collection_authorities').get().fulfilled,1);
});


test('a changed-body contender cannot adopt the winner receipt when its original hold resolves',async t=>{
 const f=await fixture(t,{two:true}),second=await f.evidence(1),input=mintFulfillmentInput(second,f.input.requestKey);let winner;
 const artifacts={...f.store,async getVerified(identity){winner=await f.call({input:f.input,idPrefix:'synthetic-body-winner'});assert.equal(winner.result.kind,'committed');return f.store.getVerified(identity);}};
 const ports={...f.ports,clock:{nowMs:()=>f.atMs+1000},artifacts},service=createMintFulfillmentService({crypto:f.ports.crypto,repository:createMintFulfillmentRepository({...f.base,leaseNowSql:String(f.atMs+1000)},ports)});
 const loser=await service.fulfillMint(MINT_FULFILLMENT_TEST_OPERATOR,input);assert.equal(loser.kind,'conflict');assert.equal(loser.code,'idempotency_conflict');assert.equal(rows(f,'app_collection_mint_fulfillments'),1);assert.equal(rows(f,'collect_assets'),1);assert.equal(f.db.prepare('SELECT settled_ms FROM collect_operations WHERE id=?').get(f.operations[1].id).settled_ms,null);
});
