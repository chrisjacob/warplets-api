import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS } from '../domain/earn/index.mjs';
import { openDatabase } from '../storage/database.mjs';
import { addCampaign, finalizeBoard, recordReview, recordStakeRead, submitContent } from './workflow.mjs';
import { configureAction, deriveComponents, listActiveActions, recordActionCompletion, recordOwnership, registerCollection } from './components.mjs';
import { recordPositionEvent, reconcilePosition, registerPosition } from './positions.mjs';
import { observationAt } from '../pricing/evidence.mjs';
import { recordSamplePrice } from '../pricing/fixtures.mjs';

const epoch=21_000, start=epoch*DAY_MS, cutoff=start+DAY_MS-1, wallet='fixture-owner', tokenId='ATT-A';
const dbFor=t=>{const db=openDatabase();t.after(()=>db.close());return db;};
const campaign=(db,id=tokenId)=>addCampaign(db,{tokenId:id,activationMs:start,originalUnits:'100000'});
function ownership(db,day=epoch,assets=[]) {
  recordOwnership(db,{wallet,epoch:day,assets,asOfMs:(day+1)*DAY_MS-1,sourceRef:'ownership-proof-'+day});
}
function purchase(db,sequence,qty,atMs,token=tokenId) {
  const signature=token+'-purchase-'+sequence;
  return recordPositionEvent(db,{wallet,tokenId:token,sequence,atMs,type:'verified-buy-and-stake',signature,instructionIndex:2,
    confirmed:true,sourceRef:'transaction-receipt',
    swap:{wallet,tokenId:token,signature,instructionIndex:1,netBoughtUnits:qty},
    deposit:{wallet,tokenId:token,signature,instructionIndex:2,depositedUnits:qty}});
}
function position(db,day,seq,overrides={}) {
  const id=overrides.tokenId??tokenId;
  const asOfMs=(day+1)*DAY_MS-1;
  if (observationAt(db,wallet,id,asOfMs).status!=='verified') {
    recordSamplePrice(db,{wallet,tokenId:id,asOfMs,stakedUnits:'12',ogPriceMicros:'1000000',sourceRef:'synthetic-position'});
  }
  return reconcilePosition(db,{wallet,tokenId,epoch:day,asOfMs:(day+1)*DAY_MS-1,reconciledSequence:seq,stakedUnits:'12',
    priceNumerator:'1000000',priceDenominator:'1',sourceRef:'position-'+day,...overrides});
}

test('prospective action rotation and verified ownership combine with eligible purchases and streak', t=>{
  const db=dbFor(t);
  campaign(db);
  registerCollection(db,{collectionId:'G',kind:'genesis'});
  registerCollection(db,{collectionId:'S',kind:'season',seasonStartMs:start-100*DAY_MS});
  configureAction(db,{actionId:'follow',label:'Follow the project',verifier:'follow-check',enabled:true,effectiveEpoch:epoch,atMs:start-1});
  recordActionCompletion(db,{wallet,actionId:'follow',verifier:'follow-check',sourceRef:'verified-follow',verifiedMs:start});
  registerPosition(db,{wallet,tokenId,enrolledMs:start});
  purchase(db,1,'12',start);
  ownership(db,epoch,[{assetId:'one',owner:wallet,chain:'solana',collectionId:'G',level:4},
    {assetId:'two',owner:wallet,chain:'solana',collectionId:'G',level:3},
    {assetId:'expired',owner:wallet,chain:'solana',collectionId:'S',level:1},
    {assetId:'other',owner:wallet,chain:'solana',collectionId:'unknown',level:10}]);
  recordStakeRead(db,{wallet,tokenId,observedMs:start,expiresMs:start+1000,microUsd:'10000000',sourceRef:'entry'});
  const post=submitContent(db,{wallet,tokenId,url:'https://example.org/post',requestKey:'k',nowMs:start}).submission;
  recordReview(db,{submissionId:post.id,score:10,reason:'Useful',moderator:'mod',sourceRef:'post-proof',reviewedMs:start+100});
  recordSamplePrice(db,{wallet,tokenId,asOfMs:cutoff,stakedUnits:'12',ogPriceMicros:'1000000',sourceRef:'closing'});
  const finish=()=>finalizeBoard(db,{epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'reviewed-board'});
  assert.equal(finish().reason,'purchase-reconciliation');
  position(db,epoch,1);
  const board=finish();
  assert.equal(board.items[0].multiplierTenths,15); // 1 action + 1 streak + 12 NFT + 1 purchased token-day.
  assert.equal(board.items[0].pointsTenths,150);
  configureAction(db,{actionId:'follow',label:'Follow the project',verifier:'follow-check',enabled:false,effectiveEpoch:epoch+1,atMs:start+1000});
  assert.equal(listActiveActions(db,epoch+1).length,0);
  assert.equal(finish().snapshotId,board.snapshotId);
  assert.throws(()=>recordOwnership(db,{wallet,epoch,asOfMs:cutoff,assets:[],sourceRef:'replacement'}),/immutable/);
  assert.throws(()=>configureAction(db,{actionId:'now',label:'Now',verifier:'v',enabled:true,effectiveEpoch:epoch,atMs:start}),/future/);
  assert.throws(()=>recordActionCompletion(db,{wallet:'late',actionId:'follow',verifier:'follow-check',verifiedMs:cutoff,sourceRef:'fake'}),/prospectively/);
});

test('complete ownership snapshots reject duplicate assets across wallets and preserve existing rows on conflict',t=>{
  const db=dbFor(t);
  registerCollection(db,{collectionId:'G',kind:'genesis'});
  ownership(db,epoch,[{assetId:'a',owner:wallet,chain:'solana',collectionId:'G',level:5}]);
  assert.throws(()=>recordOwnership(db,{wallet:'second',epoch,asOfMs:cutoff,sourceRef:'other',assets:[
    {assetId:'a',owner:'second',chain:'solana',collectionId:'G',level:5}]}),/same NFT/);
  assert.equal(deriveComponents(db,epoch,wallet).components.highestEligibleLevel,5);
  assert.equal(deriveComponents(db,epoch,'second').status,'pending');
});

test('five active positions held three boards yield fifteen verified token-days',t=>{
  const db=dbFor(t);
  for (let n=0;n<5;n++) {
    const token='ATT-'+n;
    campaign(db,token);registerPosition(db,{wallet,tokenId:token,enrolledMs:start});
    purchase(db,1,'12',start+1000,token);
    for (let d=0;d<3;d++) position(db,epoch+d,1,{tokenId:token});
  }
  ownership(db,epoch+2);
  assert.equal(deriveComponents(db,epoch+2,wallet).components.purchaseTokenDays,15);
});

test('purchase journal rejects cross-wallet swaps, replay aliases, gaps and retroactive withdrawals',t=>{
  const db=dbFor(t); campaign(db);registerPosition(db,{wallet,tokenId,enrolledMs:start});
  const bad={wallet,tokenId,sequence:1,atMs:start,type:'verified-buy-and-stake',signature:'s',instructionIndex:3,
    confirmed:true,sourceRef:'ref',swap:{wallet:'other',tokenId,signature:'s',instructionIndex:1,netBoughtUnits:'20'},
    deposit:{wallet,tokenId,signature:'s',instructionIndex:3,depositedUnits:'20'}};
  assert.throws(()=>recordPositionEvent(db,bad),/share wallet/);
  purchase(db,1,'12',start);purchase(db,1,'12',start);
  const signature=tokenId+'-purchase-1';
  assert.throws(()=>recordPositionEvent(db,{...bad,sequence:2,signature,swap:{...bad.swap,wallet,signature},
    deposit:{...bad.deposit,signature}}),/at most one/);
  assert.throws(()=>position(db,epoch,2),/sequence/);
  position(db,epoch,1);
  const withdraw={wallet,tokenId,sequence:2,type:'withdrawal',signature:'out',instructionIndex:1,
    withdrawnUnits:'12',remainingStakeUnits:'0',atMs:cutoff,confirmed:true,sourceRef:'withdrawal'};
  assert.throws(()=>recordPositionEvent(db,withdraw),/reconciled/);
  recordPositionEvent(db,{...withdraw,atMs:cutoff+1});
  recordPositionEvent(db,{wallet,tokenId,sequence:3,type:'restake',signature:'stake',instructionIndex:1,
    atMs:cutoff+2,confirmed:true,sourceRef:'new-stake'});
  const after=position(db,epoch+1,3);assert.equal(after.tokenDays,0);
  ownership(db,epoch+1);assert.equal(deriveComponents(db,epoch+1,wallet).components.purchaseTokenDays,0);
});
