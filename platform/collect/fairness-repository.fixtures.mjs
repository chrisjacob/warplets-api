// Actual B04/045/046/041 local fixture; no public write surface or remote data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mintFixture} from './mint-test-fixture.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {dispatchMintFulfillment,mintFulfillmentInput,MINT_FULFILLMENT_TEST_OPERATOR} from './mint-fulfillment-test-harness.mjs';
import {dispatchCollectionObservation,observationInput,OBSERVATION_TEST_OPERATOR} from './observation-test-harness.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
const proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url)));
export async function fairnessRepositoryFixture(t,{configured=true,two=false}={}){
 const f=await mintFixture(t,{configured,admissionAtMs:roundTime(proof.round)-leadMs}),store=memoryArtifacts();let now=f.getNow(),seq=0;f.db.function('synthetic_fairness_now',()=>now);const driver={...f.base,leaseNowSql:'synthetic_fairness_now()'},clock={nowMs:()=>now};const {createNobleBeaconVerifier}=await import('../beacon/noble-verifier.mjs'),beaconVerifier=createNobleBeaconVerifier();
 for(const operator of [MINT_FULFILLMENT_TEST_OPERATOR,OBSERVATION_TEST_OPERATOR])for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(operator.id,scope);
 const service=createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)}),operations=[];
 for(let i=0;i<(two?2:1);i++){const principal={kind:'wallet',wallet:f.holders[i]},accepted=await service.reserveMint(principal,{...f.request,requestKey:'fairness-mint-'+i});assert.equal(accepted.kind,'committed',JSON.stringify(accepted));operations.push(f.db.prepare('SELECT * FROM collect_operations WHERE id=?').get(accepted.value.operationId));}
 const fulfill=async(index=0)=>{const op=operations[index],event={inventoryId:f.input.inventoryId,operationId:op.id,kind:'mint',commitment:op.commitment,provenance:configured?'configured-offline-beacon':'manual-fixture',atMs:roundTime(proof.round),proof:configured?proof:{proofId:'synthetic-manual-'+index,assetId:'synthetic-asset-'+index,ticket:0,traits:{model:'Synthetic model',backdrop:'Synthetic backdrop',symbol:'Synthetic symbol'}}};now=Math.max(now,roundTime(proof.round)+1000);const call=request=>dispatchMintFulfillment({driver,crypto:f.ports.crypto,store,beaconVerifier,request:{nowMs:now,idPrefix:'fairness-fulfill-'+(++seq),...request}}),e=await call({method:'evidence',event});assert.equal(e.result.kind,'committed',JSON.stringify(e));const r=await call({input:mintFulfillmentInput(e.result.value,'fairness-fulfill-'+index)});assert.equal(r.result.kind,'committed',JSON.stringify(r));return r.result.value.assetId;};
 const reveal=async(assetId)=>{now+=1000;const asset=f.db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(assetId),event={id:'fairness-reveal-'+(++seq),kind:'reveal',observedMs:now,from:null,to:null},call=request=>dispatchCollectionObservation({driver,crypto:f.ports.crypto,store,request:{nowMs:now,idPrefix:'fairness-observe-'+(++seq),...request}}),e=await call({method:'evidence',inventoryId:f.input.inventoryId,assetId,events:[event],recordId:event.id});assert.equal(e.result.kind,'committed',JSON.stringify(e));const r=await call({input:observationInput(e.result.value,{requestKey:'fairness-reveal-'+assetId,expectedAssetVersion:JSON.parse(asset.asset).version})});assert.equal(r.result.kind,'committed',JSON.stringify(r));return r;};
 return {...f,driver,clock,store,beaconVerifier,operations,fulfill,reveal,setReadNow:v=>now=v,query:(index=0)=>({principal:{kind:'wallet',wallet:operations[index].owner},operationId:operations[index].id})};
}
