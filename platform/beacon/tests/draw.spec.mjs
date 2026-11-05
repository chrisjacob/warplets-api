import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openDatabase} from '../../storage/database.mjs';
import {encode58} from '../../server/base58.mjs';
import {publishDrawPolicy,roundTime,leadMs,futureRound} from '../../randomness/selection.mjs';
import {verifyBeacon,settleBeaconDraw} from '../quicknet.mjs';
import {createCollection,publishCollectionStage,reserveMint,fulfillMint,inspectOperation} from '../../collect/store.mjs';
const proof=JSON.parse(readFileSync(new URL('../fixtures/round-30000000.json',import.meta.url)));
const outcomeAt=roundTime(proof.round),at=outcomeAt-leadMs,minute=60000;
const owner=n=>encode58(Buffer.alloc(32,n));
const terms=inventoryId=>({inventoryId,at:at-3*86400000,
 assets:Array.from({length:1000},(_,i)=>encode58(createHash('sha256').update('lab-slot-'+i).digest())),
 traitChoices:Object.fromEntries(['model','backdrop','symbol'].map(name=>[name,[{name:'first',weight:2},{name:'second',weight:1}]]))});
test('actual quicknet signature is pinned to its own round, key and derived entropy',()=>{
 assert.equal(verifyBeacon(proof,proof.round),proof.randomness);
 for(const mutant of [{round:proof.round+1},{chain:'wrong'},{randomness:'0'.repeat(64)},{signature:proof.signature.replace(/^../,'82')}])
  assert.throws(()=>verifyBeacon({...proof,...mutant},proof.round));
 assert.equal(futureRound(at),proof.round);assert.equal(futureRound(at+1),proof.round+1);
});
test('committed, ordered purchase draws settle only with the pinned proof and reserved ID',t=>{
 const db=openDatabase();t.after(()=>db.close());
 const inventory='one';createCollection(db,{id:inventory,kind:'genesis',tranche:1});
 const terms1=terms(inventory),commit=publishDrawPolicy(db,terms1,at);
 assert.equal(publishDrawPolicy(db,terms1,at),commit);
 assert.throws(()=>publishDrawPolicy(db,{...terms1,assets:terms1.assets.toReversed()},at),/immutable/);
 publishCollectionStage(db,{inventoryId:inventory,stage:{id:'first',type:'whitelist',publishedAt:at-2*86400000,
   opensAt:at,closesAt:at+60*minute,allocation:1000,priceLamports:'100000000',costLamports:'5210',wallets:[owner(1),owner(2)],walletLimit:1}},at);
 const [a,b]=[1,2].map(n=>reserveMint(db,{inventoryId:inventory,stageId:'first',wallet:owner(n),requestKey:'buy-'+n,now:at}).operation.id);
 const pledge=inspectOperation(db,a).commitment;
 assert.throws(()=>fulfillMint(db,{operationId:a,commitment:pledge,proofId:'fake',ticket:999,assetId:'selected',finalized:true,
  at:outcomeAt,traits:{model:'first',backdrop:'first',symbol:'first'}},outcomeAt),/Verified draw receipt/);
 assert.throws(()=>settleBeaconDraw(db,a,proof,outcomeAt-1),/unavailable/);
 assert.throws(()=>settleBeaconDraw(db,b,proof,outcomeAt),/earlier admissions/);
 const first=settleBeaconDraw(db,a,proof,outcomeAt);
 assert.ok(terms1.assets.includes(first.result.assetId));
 assert.equal(settleBeaconDraw(db,a,proof,outcomeAt+minute).proofId,first.proofId);
 const second=settleBeaconDraw(db,b,proof,outcomeAt+minute);
 assert.notEqual(second.result.assetId,first.result.assetId);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fair_results').get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vault_assets').get().n,2);
});
