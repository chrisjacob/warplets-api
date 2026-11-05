import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../storage/database.mjs';
import { encode58 } from '../server/base58.mjs';
import { dryRunWhitelist } from './whitelist-import.mjs';
import { stageEligibility,expirySchedule,inventoryDisclosure } from './projections.mjs';
import { createCollection,publishCollectionStage,readInventory,readCollectionAsset,reserveMint,inspectOperation,fulfillMint,observeCollectionAsset } from './store.mjs';
const start=Date.UTC(2026,0,31),day=86400000,open=start+2*day;
const wallet=encode58(Buffer.alloc(32,1));
const stage={id:'first',type:'whitelist',publishedAt:start,opensAt:open,closesAt:open+day,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[wallet],walletLimit:1};
test('unknown free eligibility retains the published opening cut after late evidence acceptance',()=>{
 const s={type:'free',opensAt:open,wallets:null};
 assert.deepEqual(stageEligibility(s,wallet),{status:'unknown',reason:'opening-snapshot-pending',cutoffAt:new Date(open).toISOString()});
 assert.equal(stageEligibility({...s,wallets:[]},wallet).status,'ineligible');
 assert.equal(stageEligibility({...s,wallets:[wallet]},wallet).status,'eligible');
 assert.equal(stageEligibility(s,null).status,'unknown');
 assert.equal(stageEligibility({...s,wallets:[wallet]},wallet).cutoffAt,new Date(open).toISOString());
});
test('whitelist dry-run bounds and canonicalizes without granting duplicates extra slots; publication remains immutable',t=>{
 const report=dryRunWhitelist({source:'fixture-reviewed-list',entries:[wallet,wallet]});
 assert.equal(report.acceptedCount,1);assert.equal(report.duplicateCount,1);assert.equal(report.publishable,true);
 assert.equal(dryRunWhitelist({source:'fixture',entries:[wallet+' ',17,'bad']}).errorCount,3);
 assert.throws(()=>dryRunWhitelist({source:'fixture',entries:Array(10001).fill(wallet)}),/at most/);
 const db=openDatabase();t.after(()=>db.close());createCollection(db,{id:'genesis',kind:'genesis',tranche:1});
 const packet={inventoryId:'genesis',stage:{...stage,wallets:report.wallets}};
 publishCollectionStage(db,packet,open);
 assert.equal(publishCollectionStage(db,packet,open).replayed,true);
 assert.throws(()=>publishCollectionStage(db,{...packet,stage:{...packet.stage,wallets:[]}},open),e=>e.code==='stage_conflict');
});
test('collection disclosures do not read concealed Levels or confuse reveal observation with owner age',t=>{
 const db=openDatabase();t.after(()=>db.close());createCollection(db,{id:'genesis',kind:'genesis',tranche:1});
 publishCollectionStage(db,{inventoryId:'genesis',stage},open);
 const op=reserveMint(db,{inventoryId:'genesis',stageId:'first',wallet,requestKey:'one',now:open}).operation;
 fulfillMint(db,{operationId:op.id,assetId:'hidden',proofId:'proof',commitment:inspectOperation(db,op.id).commitment,ticket:999,at:open+1000,traits:{model:'head',backdrop:'sky',symbol:'sun'},finalized:true},open+1000);
 const before=readInventory(db,'genesis',open+1000,wallet);
 assert.equal(before.counts.paidStageAllocations,1);assert.equal(before.concealedCount,1);assert.deepEqual(before.revealedLevelCounts,Array(10).fill(0));
 assert.equal(readCollectionAsset(db,'hidden').level,undefined);
 assert.equal(readCollectionAsset(db,'hidden').ownerObservedAt,new Date(open+1000).toISOString());
 observeCollectionAsset(db,{sourceId:'reveal',assetId:'hidden',kind:'reveal',at:open+5000,finalized:true},open+5000);
 assert.equal(readCollectionAsset(db,'hidden').ownerObservedAt,new Date(open+1000).toISOString());
 const after=readInventory(db,'genesis',open+5000,wallet);assert.equal(after.concealedCount,0);assert.equal(after.revealedLevelCounts[9],1);
});
test('expiry previews preserve original month-end clamping and explicitly expire late mints',()=>{
 const expiry=expirySchedule(start,Date.UTC(2026,2,1));
 assert.equal(expiry[0].expiresAt,'2026-02-28T00:00:00.000Z');assert.equal(expiry[0].remainingMs,0);
 assert.equal(expiry[1].expiresAt,'2026-03-31T00:00:00.000Z');
});
