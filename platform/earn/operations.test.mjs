import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS } from '../domain/earn/index.mjs';
import { openDatabase } from '../storage/database.mjs';
import { recordSamplePrice } from '../pricing/fixtures.mjs';
import { addCampaign, recordReview, submitContent } from './workflow.mjs';
import { capacityAt, configureWorkload, moderatorQueue, workloadMetrics } from './operations.mjs';

const epoch=22_000,time=epoch*DAY_MS+120000,tokenId='ATT';
function setup(t) {
  const db=openDatabase();t.after(()=>db.close());
  addCampaign(db,{tokenId,activationMs:time,originalUnits:'10000'});return db;
}
function attempt(db,wallet,requestKey=wallet,nowMs=time) {
  recordSamplePrice(db,{wallet,tokenId,asOfMs:nowMs,stakedUnits:'10000000'});
  return submitContent(db,{wallet,tokenId,requestKey,nowMs,url:'https://example.org/'+wallet});
}
function configure(db,overrides={}) {
  return configureWorkload(db,{effectiveEpoch:epoch,atMs:time-1,staffedMinutes:60,secondsPerReview:180,admissionLimit:100,
    operator:'curator',reason:'staffed pilot',...overrides});
}
test('capacity uses staffed review time, permits prospective changes and honors existing admissions/replays',t=>{
  const db=setup(t);
  assert.equal(configure(db).limit,20);
  const first=attempt(db,'a');
  assert.equal(capacityAt(db,epoch,time).remaining,19);
  configure(db,{atMs:time+1,staffedMinutes:0,reason:'operator unavailable'});
  assert.equal(capacityAt(db,epoch,time+2).admitted,1);
  assert.equal(capacityAt(db,epoch,time+2).remaining,0);
  assert.equal(attempt(db,'a','a',time+2).submission.id,first.submission.id);
  assert.throws(()=>attempt(db,'b','b',time+2),e=>e.code==='board_capacity');
  configure(db,{effectiveEpoch:epoch+1,atMs:time+2,staffedMinutes:6});
  assert.equal(capacityAt(db,epoch+1,time+DAY_MS).limit,2);
});
test('queue cursor freezes admission boundary and privacy-safe metrics exclude private text and wallet identities',t=>{
  const db=setup(t);
  const p1=attempt(db,'wallet-private-one'),p2=attempt(db,'wallet-private-two');
  const first=moderatorQueue(db,{epoch,limit:1});
  assert.deepEqual(first.items.map(x=>x.id),[p1.submission.id]);
  attempt(db,'wallet-private-three');
  const next=moderatorQueue(db,{epoch,limit:1,cursor:first.nextCursor});
  assert.deepEqual(next.items.map(x=>x.id),[p2.submission.id]);assert.equal(next.nextCursor,null);
  assert.throws(()=>moderatorQueue(db,{epoch:epoch+1,cursor:first.nextCursor}),/cursor/);
  recordReview(db,{submissionId:p1.submission.id,score:0,sourceRef:'private-source',reason:'private reason',
    reviewedMs:time+500,moderator:'private-person'});
  const metrics=workloadMetrics(db,{epoch,nowMs:time+1000});
  assert.equal(metrics.awaitingReview,2);assert.equal(metrics.rejected,1);assert.equal(metrics.oldestAwaitingMs,1000);
  assert.doesNotMatch(JSON.stringify(metrics),/private|https:|example\.org/);
  assert.deepEqual(moderatorQueue(db,{epoch,state:'reviewed'}).items.map(x=>x.id),[p1.submission.id]);
});
