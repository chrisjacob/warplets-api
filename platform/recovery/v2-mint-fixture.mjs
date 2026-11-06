// Synthetic Node setup only. Consumers choose their own trusted verifier.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mintFixture} from '../collect/mint-test-fixture.mjs';
import {createMintReservationService} from '../collect/mint-service.mjs';
import {createMintReservationRepository} from '../collect/mint-repository.mjs';
import {dispatchMintFulfillment,mintFulfillmentInput,MINT_FULFILLMENT_TEST_OPERATOR} from '../collect/mint-fulfillment-test-harness.mjs';
import {memoryArtifacts} from './fixtures.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
import {publishDrawPolicy} from '../randomness/selection.mjs';
const proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url))),traits={model:'Synthetic model',backdrop:'Synthetic backdrop',symbol:'Synthetic symbol'};
export async function recoveryMintFixture(t,{configured=false,kind='season',largeTraits=false}={}){
 const f=await mintFixture(t,{configured:configured&&!largeTraits,kind,...(configured?{admissionAtMs:roundTime(proof.round)-leadMs}:{})});
 if(largeTraits){const choices=Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,Array.from({length:256},(_,n)=>({name:'\u9fff'.repeat(124)+String(n).padStart(4,'0'),weight:1000000}))]));publishDrawPolicy(f.db,{inventoryId:f.input.inventoryId,assets:f.assets,traitChoices:choices,at:f.input.publishedAt},f.input.publishedAt);}
 for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(MINT_FULFILLMENT_TEST_OPERATOR.id,scope);
 const accepted=await createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)}).reserveMint(f.principal,f.request);assert.equal(accepted.kind,'committed');
 const op=f.db.prepare('SELECT * FROM collect_operations WHERE id=?').get(accepted.value.operationId),store=memoryArtifacts(),atMs=configured?roundTime(proof.round):Math.ceil((f.getNow()+1000)/1000)*1000,beaconVerifier=configured?{verifyShortSignature:()=>true}:undefined;
 const call=request=>dispatchMintFulfillment({driver:f.base,crypto:f.ports.crypto,store,beaconVerifier,request:{nowMs:atMs+1000,idPrefix:'synthetic-recovery-mint',...request}});
 const event={inventoryId:f.input.inventoryId,operationId:op.id,kind:'mint',commitment:op.commitment,provenance:configured?'configured-offline-beacon':'manual-fixture',atMs,proof:configured?proof:{proofId:'synthetic-recovery-mint-proof',assetId:'synthetic-recovery-mint-asset',ticket:0,traits}},evidence=await call({method:'evidence',event,idPrefix:'synthetic-recovery-evidence'});assert.equal(evidence.result.kind,'committed');
 const input=mintFulfillmentInput(evidence.result.value,'synthetic-recovery-fulfill'),fulfilled=await call({input});assert.equal(fulfilled.result.kind,'committed',JSON.stringify(fulfilled));return {...f,store,op,atMs,call,event,input,beaconVerifier,assetId:fulfilled.result.value.assetId};
}
