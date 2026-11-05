import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {importMarket} from '../markets/catalog.mjs';
import {observeAsset,readAsset,recordVaultManifest} from './ledger.mjs';
import {memberVaultSummary} from './member-projection.mjs';
import {createCollection,publishCollectionStage,reserveMint,fulfillMint,inspectOperation,observeCollectionAsset} from '../collect/store.mjs';
const key=n=>encode58(Buffer.alloc(32,n)),base=Date.UTC(2026,10,1),hour=3600000,at=h=>new Date(base+h*hour).toISOString();
function setup(t){const db=openDatabase();t.after(()=>db.close());importMarket(db,{id:'demo',symbol:'DEMO',ogSymbol:'OG',activatedAt:at(0),attMint:key(3),ogMint:key(4),poolAddress:key(5)});recordVaultManifest(db,{marketId:'demo',originalUnits:'402600000'});return db;}
test('complete owner snapshot sums all assets and preserves original clocks across claim and transfer',t=>{
 const db=setup(t);
 for(let n=0;n<26;n++)observeAsset(db,{eventId:'bind-'+n,assetId:'nft-'+n,kind:'bind',at:at(36),owner:key(1),slot:{kind:'genesis',tranche:1,level:1,ordinal:n}},base+36*hour);
 const summary=memberVaultSummary(db,key(1),base+36*hour);
 assert.equal(summary.status,'complete');assert.equal(summary.assetCount,26);assert.equal(summary.items[0].allocated,'26000');assert.equal(summary.items[0].claimable,'13000');
 assert.equal(summary.items[0].activatedAt,at(0));assert.equal(summary.items[0].cliffEndsAt,at(24));assert.equal(summary.items[0].fullyVestedAt,at(48));
 observeAsset(db,{eventId:'claim',assetId:'nft-0',kind:'claim',at:at(37),owner:key(1),marketId:'demo',units:'100'},base+37*hour);
 assert.equal(readAsset(db,'nft-0',base+37*hour).ownerObservedAt,at(36));
 observeAsset(db,{eventId:'transfer',assetId:'nft-0',kind:'transfer',at:at(48),from:key(1),to:key(2)},base+48*hour);
 const buyer=memberVaultSummary(db,key(2),base+49*hour);assert.equal(buyer.items[0].claimable,'900');assert.equal(buyer.items[0].activatedAt,at(0));
 assert.equal(memberVaultSummary(db,key(1),base+49*hour).assetCount,25);
});
test('concealed tracked asset suppresses all aggregate amounts until approved reveal',t=>{
 const db=setup(t);createCollection(db,{id:'genesis',kind:'genesis',tranche:1});
 publishCollectionStage(db,{inventoryId:'genesis',stage:{id:'first',type:'whitelist',publishedAt:base,opensAt:base+48*hour,closesAt:base+72*hour,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[key(1)],walletLimit:1}},base+48*hour);
 const op=reserveMint(db,{inventoryId:'genesis',stageId:'first',wallet:key(1),requestKey:'one',now:base+48*hour}).operation;
 fulfillMint(db,{operationId:op.id,assetId:'hidden',proofId:'proof',commitment:inspectOperation(db,op.id).commitment,ticket:999,at:base+49*hour,traits:{model:'Fixture',backdrop:'Fixture',symbol:'Fixture'},finalized:true},base+49*hour);
 const hidden=memberVaultSummary(db,key(1),base+50*hour);assert.equal(hidden.reason,'concealed-metadata');assert.deepEqual(hidden.items,[]);assert.equal(hidden.assetCount,null);
 observeCollectionAsset(db,{sourceId:'reveal',assetId:'hidden',kind:'reveal',at:base+51*hour,finalized:true},base+51*hour);
 assert.equal(memberVaultSummary(db,key(1),base+50*hour).status,'unavailable');
 assert.equal(memberVaultSummary(db,key(1),base+51*hour).status,'complete');
});
test('over-bound owner holdings never expose a misleading partial total',t=>{
 const db=setup(t);
 for(let n=0;n<101;n++)observeAsset(db,{eventId:'bind-'+n,assetId:'nft-'+n,kind:'bind',at:at(36),owner:key(1),slot:{kind:'genesis',tranche:1,level:1,ordinal:n}},base+36*hour);
 const result=memberVaultSummary(db,key(1),base+48*hour);assert.equal(result.reason,'asset-bound');assert.deepEqual(result.items,[]);assert.equal(result.assetCount,null);
});
