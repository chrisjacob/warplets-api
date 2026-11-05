import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {createCollection,publishCollectionStage,reserveMint,inspectOperation,fulfillMint,
 observeCollectionAsset,reserveProgression,fulfillProgression} from '../collect/store.mjs';
import {registerCampaign,seasonsAt} from './registry.mjs';

const day=86400000,start=Date.UTC(2026,9,1),at=n=>start+n*day;
const addr=n=>encode58(Buffer.alloc(32,n)),owner=addr(21);
function campaign(number,activation){
 const time=new Date(activation).toISOString();
 return {market:{id:'m-'+number,symbol:'DEMO'+number,ogSymbol:'OG',attMint:addr(number),ogMint:addr(120),poolAddress:addr(50+number),activatedAt:time},
  originalUnits:'402600000',treasuryFeeBps:0,sourceRef:'local-evidence-'+number,observedThrough:time};
}
test('one evidence intake creates all four budgets and rolls every participant back on conflict',t=>{
 const db=openDatabase();t.after(()=>db.close());
 const one=campaign(1,at(1));const receipt=registerCampaign(db,one,at(2));
 assert.equal(receipt.allocations.genesisVault,'20130000');assert.equal(receipt.allocations.seasonVault,'0');
 assert.deepEqual(registerCampaign(db,one,at(2)),receipt);
 assert.equal(db.prepare('SELECT original_units FROM earn_fixture_campaigns').get().original_units,one.originalUnits);
 assert.equal(db.prepare('SELECT funded_units FROM stake_fixture_farms').get().funded_units,receipt.allocations.stake);
 assert.throws(()=>registerCampaign(db,{...one,originalUnits:'200'},at(2)),/Conflicting/);
 assert.throws(()=>registerCampaign(db,campaign(2,at(1)+1000),at(2)),/Sydney day/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market_fixtures').get().n,1);
 assert.throws(()=>createCollection(db,{id:'retro',kind:'season',seasonStart:at(0)}),/froze/);
});
test('all reserved slots count and an upgrade changes only subsequent launch snapshots',t=>{
 const db=openDatabase();t.after(()=>db.close());
 createCollection(db,{id:'oct',kind:'season',seasonStart:start});
 const stage={id:'paid',type:'whitelist',publishedAt:at(0),opensAt:at(2),closesAt:at(5),allocation:1000,
  priceLamports:'100000000',costLamports:'1000',wallets:[owner],walletLimit:3};
 publishCollectionStage(db,{inventoryId:'oct',stage},at(4));
 const old=registerCampaign(db,campaign(1,at(1)),at(4));assert.equal(old.activeSeasonWeight,'2013');
 for(const [i,stageId] of [[1,'paid'],[2,'extra']]){
  if(i===2)publishCollectionStage(db,{inventoryId:'oct',stage:{...stage,id:stageId,opensAt:at(5),closesAt:at(8)}},at(5));
  const when=i===1?at(2):at(5);
  const {operation}=reserveMint(db,{inventoryId:'oct',stageId,wallet:owner,requestKey:'mint-'+i,now:when});
  const {commitment}=inspectOperation(db,operation.id);
  fulfillMint(db,{operationId:operation.id,assetId:'n'+i,proofId:'proof-'+i,commitment,ticket:0,at:when+1000,
    traits:{model:'m',backdrop:'b',symbol:'s'},finalized:true},when+1000);
  observeCollectionAsset(db,{sourceId:'reveal-'+i,kind:'reveal',assetId:'n'+i,at:when+2000,finalized:true},when+2000);
 }
 const {operation}=reserveProgression(db,{inventoryId:'oct',wallet:owner,requestKey:'up',
  request:{kind:'upgrade',targetId:'n1',materialId:'n2',expectedTargetVersion:0,expectedMaterialVersion:0},now:at(6)});
 const {commitment}=inspectOperation(db,operation.id);
 fulfillProgression(db,{operationId:operation.id,proofId:'up-proof',commitment,at:at(6)+1000,ticket:999,finalized:true},at(7));
 const before=seasonsAt(db,at(5)+3000)[0].levels,after=seasonsAt(db,at(7))[0].levels;
 assert.deepEqual(before.slice(0,2),[1,1]);assert.deepEqual(after.slice(0,2),[2,10]);
 const later=registerCampaign(db,campaign(2,at(7)),at(8));
 assert.equal(later.activeSeasonWeight,'2023');assert.deepEqual(registerCampaign(db,campaign(1,at(1)),at(8)),old);
 assert.equal(JSON.parse(db.prepare('SELECT seasons FROM vault_manifests WHERE id=?').get('m-1').seasons)[0].levels[0],1);
});
