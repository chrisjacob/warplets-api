// Synthetic local 040/042 lineage, with the existing pinned beacon recording.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {dispatchProgressionReservation,reviewedReservation} from './reservation-test-harness.mjs';
import {dispatchCollectionFulfillment,fulfillmentInput,FULFILLMENT_TEST_OPERATOR} from './fulfillment-test-harness.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
import {createNobleBeaconVerifier} from '../beacon/noble-verifier.mjs';
export async function fairnessProgressionFixture(t,{kind='upgrade',configured=true}={}){
 const proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url))),db=openDatabase();t.after(()=>db.close());
 const f=seedCollectionContext(db),crypto=createNodeCrypto(),store=memoryArtifacts(),beaconVerifier=createNobleBeaconVerifier();let now=configured?roundTime(proof.round)-leadMs:f.nowMs,seq=0;
 db.function('synthetic_progression_fairness_now',()=>now);const driver={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_progression_fairness_now()'},principal={kind:'wallet',wallet:f.wallet},clock={nowMs:()=>now};
 for(const scope of ['evidence-ingest','collection-evidence'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(FULFILLMENT_TEST_OPERATOR.id,scope);
 if(configured)db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(f.inventoryId,'a'.repeat(64),JSON.stringify(Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,[{name:'Synthetic first',weight:1},{name:'Synthetic second',weight:1}]]))),f.start);
 const createdMs=now,baseTables=Object.fromEntries(['collect_inventories','vault_assets','vault_observations','collect_assets','app_operator_scopes','fair_inventories'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
 const q=await dispatchProgressionReservation({driver,crypto,request:{method:'quote',principal,nowMs:now,idPrefix:'synthetic-quote',input:{requestKey:'synthetic-quote',inventoryId:f.inventoryId,...f.request(2,kind)}}});assert.equal(q.result.kind,'committed');
 const reservation=await dispatchProgressionReservation({driver,crypto,request:{principal,nowMs:now,idPrefix:'synthetic-reserve',input:reviewedReservation(q.result.value,'synthetic-reserve')}});assert.equal(reservation.result.kind,'committed');
 const op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(reservation.result.value.operationId),atMs=configured?roundTime(proof.round):now+5000;
 async function fulfill(){now=atMs+1000;const event={inventoryId:f.inventoryId,operationId:op.id,kind,commitment:op.commitment,provenance:configured?'configured-offline-beacon':'manual-fixture',atMs,proof:configured?proof:{proofId:'synthetic-proof',ticket:kind==='upgrade'?999:null,traits:kind==='visual'?{model:'Synthetic changed',backdrop:'Synthetic dusk',symbol:'Synthetic star'}:null}};
  const call=request=>dispatchCollectionFulfillment({driver,crypto,store,beaconVerifier,request:{nowMs:now,idPrefix:'synthetic-fulfill-'+(++seq),...request}}),ev=await call({method:'evidence',event});assert.equal(ev.result.kind,'committed');const result=await call({input:fulfillmentInput(ev.result.value,'synthetic-fulfillment')});assert.equal(result.result.kind,'committed',JSON.stringify(result));return result;
 }
 return {db,driver,crypto,clock,beaconVerifier,op,fulfill,baseTables,createdMs,proof,atMs,context:f,query:{principal,operationId:op.id}};
}
