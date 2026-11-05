import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../storage/database.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { addCampaign, finalizeBoard, recordReview, submitContent } from '../earn/workflow.mjs';
import { recordOwnership } from '../earn/components.mjs';
import { reconcilePosition, registerPosition } from '../earn/positions.mjs';
import { assessObservation, normalizePolicy } from './policy.mjs';
import { importPriceObservation, observationAt, registerPriceSource } from './evidence.mjs';
import { sampleObservation, samplePolicy } from './fixtures.mjs';

const epoch=20_000, time=epoch*DAY_MS+60_000,cutoff=(epoch+1)*DAY_MS-1,wallet='holder',tokenId='ATT';
const policy=normalizePolicy(samplePolicy(tokenId));
function observation(asOfMs=time) {return sampleObservation(policy,{wallet,asOfMs,stakedUnits:'10000000'});}
function dbFor(t) {
  const db=openDatabase();t.after(()=>db.close());
  addCampaign(db,{tokenId,activationMs:time,originalUnits:'1000000'});registerPriceSource(db,policy);
  return db;
}

test('Q64.64 raw orientation agrees with pinned SDK vectors across mint decimals and exact threshold',()=>{
  // Reference getPriceFromSqrtPrice SDK 1.5.1: 2^64, decimals 9/6 => 1000 whole OG per ATT.
  const p={...policy,attDecimals:9,ogDecimals:6};
  const o=sampleObservation(p,{wallet,asOfMs:time,stakedUnits:'5000000',ogPriceMicros:'2000000'});
  const result=assessObservation(p,o);
  assert.equal(result.microUsd,'10000000');
  assert.equal(result.priceNumerator,'2');assert.equal(result.priceDenominator,'1');
  o.farm.stakedUnits='4999999';assert.equal(assessObservation(p,o).microUsd,'9999998');
  // SDK vector sqrt=1.5 * 2^64, decimals 6/9 => 0.00225 whole OG per ATT.
  const q={...policy,attDecimals:6,ogDecimals:9};
  const v=sampleObservation(q,{wallet,asOfMs:time,stakedUnits:'10000000000',ogPriceMicros:'2500000'});
  v.pool.sqrtPriceX64=v.reference.sqrtPriceX64=String(3n*(1n<<63n));
  v.depth.inputUnits='2000000000';v.depth.grossOutputUnits='4500000000';
  assert.equal(assessObservation(q,v).microUsd,'56250000');
});

test('mismatched mint, farm, source identity, freshness and manipulation hold decisions',()=>{
  const scenarios=[
    [o=>o.pool.mintA='OTHER','source-mismatch'],[o=>o.farm.owner='other','source-mismatch'],
    [o=>o.og.feed='wrong','source-mismatch'],[o=>o.pool.program='other','source-mismatch'],
    [o=>o.og.finalized=false,'unverified-provenance'],[o=>o.pool.slot+=99,'slot-skew'],
    [o=>o.pool.investigationOpen=true,'price-investigation'],[o=>o.og.observedMs++,'stale-or-future'],
    [o=>o.farm.observedMs-=policy.maxAgeMs+1,'stale-or-future'],
    [o=>o.og.confidenceMicros='1','price-confidence'],[o=>o.depth.inputUnits='1','insufficient-quoted-depth'],
    [o=>o.depth.grossOutputUnits='6000000','excessive-depth-impact'],
    [o=>o.pool.sqrtPriceX64=String(1n<<65n),'rapid-price-movement'],
    [o=>o.pool.sqrtPriceX64='1','pool-price-out-of-range'],
    [o=>o.reference.observedMs=o.pool.observedMs,'missing-lookback']
  ];
  for (const [mutate,reason] of scenarios) {
    const o=observation();mutate(o);assert.deepEqual(assessObservation(policy,o),{status:'pending',reason});
  }
});

test('newer pending reading masks previous valid quote; exact receipt revisions recover held boards',t=>{
  const db=dbFor(t);
  const initial=importPriceObservation(db,observation());
  assert.equal(initial.status,'verified');
  const params={wallet,tokenId,url:'https://example.org/post',requestKey:'aaa',nowMs:time+1};
  const broken=observation(time+1);delete broken.og;
  const pending=importPriceObservation(db,broken);
  assert.equal(pending.reason,'missing-observation');
  assert.throws(()=>submitContent(db,params),e=>e.code==='stake_evidence_pending');
  assert.throws(()=>importPriceObservation(db,observation(time+1)),e=>e.code==='revision_conflict');
  const accepted=importPriceObservation(db,{...observation(time+1),supersedes:pending.receipt});
  assert.equal(accepted.status,'verified');
  const post=submitContent(db,params).submission;
  recordReview(db,{submissionId:post.id,score:9,moderator:'mod',reason:'reviewed',sourceRef:'content',reviewedMs:time+100});
  recordOwnership(db,{epoch,wallet,asOfMs:cutoff,assets:[],sourceRef:'empty'});
  const suspicious=observation(cutoff);suspicious.og.priceMicros='-1';
  const held=importPriceObservation(db,suspicious);
  assert.equal(held.reason,'malformed-evidence');
  const close=()=>finalizeBoard(db,{epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'completed'});
  assert.equal(close().reason,'stake-evidence');
  const final=observation(cutoff);final.farm.stakedUnits='9999999';
  importPriceObservation(db,{...final,supersedes:held.receipt});
  assert.deepEqual(close().items,[]);
  assert.equal(observationAt(db,wallet,tokenId,cutoff+policy.maxAgeMs+1).reason,'stale-or-future');
});

test('enrolled purchase position uses the exact same wallet valuation as submission eligibility',t=>{
  const db=dbFor(t);registerPosition(db,{wallet,tokenId,enrolledMs:time});
  const args={wallet,tokenId,epoch,asOfMs:cutoff,reconciledSequence:0,sourceRef:'farm'};
  assert.equal(reconcilePosition(db,args).status,'pending');
  importPriceObservation(db,observation(cutoff-1));
  assert.equal(reconcilePosition(db,args).reason,'missing-cutoff-observation');
  importPriceObservation(db,observation(cutoff));
  assert.throws(()=>reconcilePosition(db,{...args,priceNumerator:'99999'}),/match the verified checkpoint/);
  const actual=reconcilePosition(db,args);
  assert.equal(actual.tokenDays,0);
  const row=db.prepare('SELECT stake,numerator,denominator,source_ref FROM earn_position_cutoffs').get();
  assert.equal(row.stake,'10000000');
  assert.equal(row.numerator,'1');
  assert.equal(row.denominator,'1');
  assert.ok(row.source_ref.endsWith(observationAt(db,wallet,tokenId,cutoff).receipt));
});
