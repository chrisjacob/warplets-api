import {handleVault} from '../vault/http.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openDatabase } from '../storage/database.mjs';
import { encode58 } from '../server/base58.mjs';
import { handleCollect } from './http.mjs';
import { recordDecision, seedBallot } from '../governance/ballots.mjs';
import { observeAsset } from '../vault/ledger.mjs';
import { createCollection, freezeSeasonSnapshot, fulfillMint, fulfillProgression, inspectOperation,
  listOwnOperations, observeCollectionAsset, publishCollectionStage, quoteProgression, readCollectionAsset, readOwnOperation,
  readInventory, reserveFounderMint, reserveMint, reserveProgression } from './store.mjs';

const day=86_400_000, start=Date.UTC(2026,0,1), open=start+2*day;
const alice=encode58(Buffer.alloc(32,1)), bob=encode58(Buffer.alloc(32,2));
const visuals={model:'head1',backdrop:'space',symbol:'moon'};
const genesis={id:'genesis-1',kind:'genesis',tranche:1};
const season={id:'season-1',kind:'season',seasonStart:start};
const first={id:'first',type:'whitelist',publishedAt:start,opensAt:open,closesAt:open+day,
  allocation:1000,priceLamports:'100000000',costLamports:'5210',wallets:[alice,bob],walletLimit:1};
const code=expected=>err=>err.code===expected;
const stage=(db,inventoryId,s)=>publishCollectionStage(db,{inventoryId,stage:s},open+day);
const admit=(db,inventoryId,stageId,wallet,requestKey,now=open)=>reserveMint(db,{inventoryId,stageId,wallet,requestKey,now});
const resolveMint=(db,op,assetId,ticket,at=open+1000)=>{
  const {commitment}=inspectOperation(db,op.id);
  const fixture={operationId:op.id,assetId,proofId:'proof-'+assetId,commitment,ticket,at,traits:visuals,finalized:true};
  fulfillMint(db,fixture,at);
  return fixture;
};
const reveal=(db,assetId,at)=>observeCollectionAsset(db,{sourceId:'reveal-'+assetId,kind:'reveal',assetId,at,finalized:true},at);

test('mint recovery across restart, concealed metadata, immutable terms, binding and transfer track Vault custody',t=>{
  const dir=mkdtempSync(join(tmpdir(),'10x-coll-')),path=join(dir,'local.sqlite');
  let db=openDatabase(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  createCollection(db,genesis);
  stage(db,genesis.id,first);
  assert.equal(stage(db,genesis.id,first).replayed,true);
  assert.throws(()=>stage(db,genesis.id,{...first,costLamports:'5000'}),code('stage_conflict'));
  assert.throws(()=>createCollection(db,{...genesis,id:'duplicate'}),code('duplicate_tranche'));
  const req=admit(db,genesis.id,first.id,alice,'one');
  assert.equal(req.operation.status,'awaiting-evidence');
  assert.equal(req.operation.costLamports,'5210');
  db.close();db=openDatabase(path);
  assert.deepEqual(admit(db,genesis.id,first.id,alice,'one').operation,req.operation);
  assert.throws(()=>admit(db,genesis.id,first.id,alice,'two'),code('stage_wallet_limit'));
  const draw=resolveMint(db,req.operation,'g1',999);
  assert.equal(fulfillMint(db,draw,open+2000).replayed,true);
  assert.throws(()=>fulfillMint(db,{...draw,ticket:0},open+2000),code('receipt_conflict'));
  assert.equal(listOwnOperations(db,alice).items[0].assetId,'g1');
  assert.equal(readCollectionAsset(db,'g1').revealStatus,'unrevealed');
  assert.equal(readCollectionAsset(db,'g1').level,undefined);
  assert.equal(JSON.parse(db.prepare('SELECT coords FROM vault_assets WHERE id=?').get('g1').coords).level,10);
  const detail=new Request('http://localhost/api/v1/nfts/g1/vault');
  assert.equal(handleVault(db,detail,open+1000).status,409);
  assert.equal(reveal(db,'g1',open+2000).replayed,false);
  assert.equal(handleVault(db,detail,open+2000).status,200);
  assert.equal(readCollectionAsset(db,'g1').level,10);
  const transfer={sourceId:'sale',kind:'transfer',assetId:'g1',from:alice,to:bob,at:open+3000,finalized:true};
  observeCollectionAsset(db,transfer,open+3000);
  assert.equal(observeCollectionAsset(db,transfer,open+3000).replayed,true);
  assert.equal(readCollectionAsset(db,'g1').owner,bob);
  assert.equal(db.prepare('SELECT owner FROM vault_assets WHERE id=?').get('g1').owner,bob);
});

test('free snapshot includes only verified revealed Genesis and rejects conflicts or nonfinal/bad cutoffs',t=>{
  const db=openDatabase();t.after(()=>db.close());
  createCollection(db,genesis);stage(db,genesis.id,first);
  const g=admit(db,genesis.id,'first',alice,'genesis-a');
  resolveMint(db,g.operation,'g1',0);
  createCollection(db,season);
  const pri={...first,id:'pri',opensAt:start,closesAt:start+day};
  const expanded={...first,id:'expand',opensAt:start+day,closesAt:open};
  stage(db,season.id,pri);stage(db,season.id,expanded);
  const sale={...first,id:'free',type:'free',priceLamports:'0',opensAt:open+day,closesAt:open+2*day};
  stage(db,season.id,sale);
  const at=sale.opensAt;
  const fixture={inventoryId:season.id,stageId:'free',sourceRef:'snapshot-1',finalized:true,at,
    holdings:[{id:'g1',owner:alice,collection:'solana-genesis',revealedAt:null,level:null},
      {id:'other-genesis',owner:bob,collection:'solana-genesis',revealedAt:at-1,level:1}]};
  assert.throws(()=>freezeSeasonSnapshot(db,{...fixture,finalized:false},at),code('snapshot_not_final'));
  assert.throws(()=>freezeSeasonSnapshot(db,{...fixture,holdings:[{...fixture.holdings[0],revealedAt:at-1,level:1}]},at),
    code('conflicting_ownership_cut'));
  assert.equal(freezeSeasonSnapshot(db,fixture,at).eligibleWallets,1);
  reveal(db,'g1',at+1);
  assert.throws(()=>admit(db,season.id,'free',alice,'wrong',at+2),code('wallet_ineligible'));
  assert.equal(admit(db,season.id,'free',bob,'yes',at+2).operation.priceLamports,'0');
  assert.equal(freezeSeasonSnapshot(db,fixture,at+2).replayed,true);
});

test('progression locks and idempotent evidence survive restart; treasury cost and season rights remain separate',t=>{
  const dir=mkdtempSync(join(tmpdir(),'10x-coll-')),path=join(dir,'local.sqlite');
  let db=openDatabase(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  createCollection(db,season);
  stage(db,season.id,{...first,walletLimit:2});
  for(const [id,key] of [['s1','one'],['s2','two']]) {
    const {operation}=admit(db,season.id,'first',alice,key);
    resolveMint(db,operation,id,0);
    reveal(db,id,open+2000);
  }
  const reserve={inventoryId:season.id,wallet:alice,requestKey:'up',now:open+3000,request:{
    kind:'upgrade',targetId:'s1',materialId:'s2',expectedTargetVersion:0,expectedMaterialVersion:0}};
  const quote=quoteProgression(db,reserve);
  assert.equal(quote.feeLamports,'10000000');
  assert.equal(quote.nextTargetLevel,2);
  assert.equal(quote.materialProbabilities.reduce((sum,p)=>sum+p.count,0),1000);
  assert.equal(readCollectionAsset(db,'s1').operationPending,false);
  assert.equal(listOwnOperations(db,alice).items.filter(op=>op.kind==='upgrade').length,0);
  assert.throws(()=>reserveProgression(db,{...reserve,wallet:bob}),code('wrong_owner'));
  const pending=reserveProgression(db,reserve);
  assert.equal(pending.operation.feeLamports,'10000000');
  assert.throws(()=>readOwnOperation(db,bob,pending.operation.id),code('operation_not_found'));
  db.close();db=openDatabase(path);
  assert.deepEqual(reserveProgression(db,reserve).operation,pending.operation);
  assert.throws(()=>observeCollectionAsset(db,{kind:'transfer',sourceId:'sale',assetId:'s2',
    from:alice,to:bob,at:open+4000,finalized:true},open+4000),code('asset_reserved'));
  const draw={operationId:pending.operation.id,commitment:inspectOperation(db,pending.operation.id).commitment,
    proofId:'upgrade-proof',ticket:999,finalized:true,at:open+5000};
  fulfillProgression(db,draw,open+5000);
  assert.equal(fulfillProgression(db,draw,open+5000).replayed,true);
  assert.equal(readCollectionAsset(db,'s1').level,2);
  assert.equal(readCollectionAsset(db,'s2').level,10);
  const visual=reserveProgression(db,{inventoryId:season.id,wallet:alice,requestKey:'reroll',now:open+6000,
    request:{kind:'visual',targetId:'s1',expectedTargetVersion:2}});
  const visualProof={operationId:visual.operation.id,commitment:inspectOperation(db,visual.operation.id).commitment,
    proofId:'visual-proof',traits:{model:'new',backdrop:'new',symbol:'new'},at:open+7000,finalized:true};
  fulfillProgression(db,visualProof,open+7000);
  const asset=readCollectionAsset(db,'s1');
  assert.equal(asset.level,2);assert.equal(asset.rerolls,1);
  assert.equal(Date.parse(asset.nextRerollAt),open+7000+3_600_000);
  assert.throws(()=>reserveProgression(db,{inventoryId:season.id,wallet:alice,requestKey:'again',now:open+8000,
    request:{kind:'visual',targetId:'s1',expectedTargetVersion:4}}),code('reroll_cooldown'));
});

test('public API exposes policy terms only; owner operations, admission and privileged stage writes are isolated',async t=>{
  const db=openDatabase();t.after(()=>db.close());createCollection(db,genesis);stage(db,genesis.id,first);
  const url='http://localhost/api/v1/collect';
  const call=(path,method='GET')=>handleCollect(db,new Request(url+path,{method}), 'peer',open);
  const response=await call('/inventories');const body=await response.json();
  assert.equal(body.items[0].counts.unsold,1000);
  assert.equal(body.items[0].stages[0].eligible,null);
  assert.equal(body.items[0].stages[0].priceLamports,'100000000');
  assert.ok(!JSON.stringify(body).includes(alice));
  assert.equal((await call('/me/operations')).status,401);
  assert.equal((await call('/inventories/genesis-1/stages/first/reservations','POST')).status,401);
  assert.equal((await call('/operator','POST')).status,404);
  assert.equal((await call('/inventories','POST')).status,405);
});

test('parallel workers reserve at most one slot; identical requests recover the same operation',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'10x-coll-')),path=join(dir,'race.sqlite');
  const db=openDatabase(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  createCollection(db,genesis);stage(db,genesis.id,first);
  const imports={store:new URL('./store.mjs',import.meta.url).href,database:new URL('../storage/database.mjs',import.meta.url).href};
  const worker=(key)=>new Promise((resolve,reject)=>{
    const child=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      (async()=>{const {openDatabase}=await import(workerData.database);const {reserveMint}=await import(workerData.store);
      const db=openDatabase(workerData.path);try{parentPort.postMessage(reserveMint(db,workerData.req));}
      catch(e){parentPort.postMessage({error:e.code||e.message});}finally{db.close()}})().catch(err=>{throw err});`,
    {eval:true,workerData:{...imports,path,req:{inventoryId:genesis.id,stageId:'first',wallet:alice,requestKey:key,now:open}}});
    child.on('message',resolve);child.on('error',reject);
  });
  const [a,b]=await Promise.all([worker('same'),worker('same')]);
  assert.equal(a.operation.id,b.operation.id);
  assert.equal([a,b].filter(r=>r.replayed).length,1);
  assert.equal((await worker('different')).error,'stage_wallet_limit');
  assert.equal(readInventory(db,genesis.id,open).counts.pending,1);
});

test('an incompatible Vault slot bind rolls back the entire mint and leaves the committed admission pending',t=>{
  const db=openDatabase();t.after(()=>db.close());
  createCollection(db,genesis);stage(db,genesis.id,first);
  observeAsset(db,{eventId:'legacy',assetId:'older',kind:'bind',at:new Date(open).toISOString(),
    owner:bob,slot:{kind:'genesis',tranche:1,level:10,ordinal:0}},open);
  const {operation}=admit(db,genesis.id,'first',alice,'one');
  assert.throws(()=>resolveMint(db,operation,'new',999),/UNIQUE/);
  assert.equal(readInventory(db,genesis.id,open).counts.pending,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collect_assets').get().n,0);
  assert.equal(inspectOperation(db,operation.id).status,'awaiting-evidence');
});

test('founder reservations use an explicitly approved total budget and draw through ordinary inventory',t=>{
  const db=openDatabase();t.after(()=>db.close());createCollection(db,season);
  stage(db,season.id,{...first,id:'priority',opensAt:start,closesAt:start+day});
  stage(db,season.id,{...first,id:'expanded',opensAt:start+day,closesAt:open});
  stage(db,season.id,{...first,id:'free',type:'free',priceLamports:'0'});
  const afterFree=open+day;
  stage(db,season.id,{...first,id:'backstop',type:'founder',priceLamports:'0',opensAt:afterFree,
    closesAt:afterFree+day,approvedSpendLamports:'10000',costLamports:'6000',founderApproved:true,walletLimit:4});
  assert.throws(()=>admit(db,season.id,'backstop',alice,'public',afterFree),code('operator_only'));
  const args={inventoryId:season.id,stageId:'backstop',wallet:alice,requestKey:'founder1',now:afterFree};
  const result=reserveFounderMint(db,args);
  assert.throws(()=>reserveFounderMint(db,{...args,requestKey:'again'}),code('founder_budget_exceeded'));
  resolveMint(db,result.operation,'backstop1',999,afterFree+1000);
  assert.equal(readInventory(db,season.id,afterFree+1000).counts.founder,1);
});

test('conditional next-tranche notice can overlap the ballot, but early or unsold opening is held',t=>{
  const db=openDatabase();t.after(()=>db.close());
  createCollection(db,genesis);stage(db,genesis.id,first);
  const second={id:'genesis-2',kind:'genesis',tranche:2};createCollection(db,second);
  seedBallot(db,{id:'when-2',opensAt:open,currentTrancheOpenedAt:open,holders:[alice],nextWhitelist:[]});
  const nextStart=open+2*day;
  stage(db,second.id,{...first,ballotId:'when-2',publishedAt:open,opensAt:nextStart,closesAt:nextStart+day});
  const req=()=>admit(db,second.id,'first',alice,'two',nextStart);
  assert.throws(req,code('tranche_postponed'));
  recordDecision(db,{id:'when-2',choice:'ASAP',decidedAt:nextStart,noticeAt:open,rationale:'Demand observed.'},nextStart);
  assert.throws(req,code('tranche_postponed'));
  assert.equal(readInventory(db,second.id,nextStart).stages[0].status,'postponed');
});
