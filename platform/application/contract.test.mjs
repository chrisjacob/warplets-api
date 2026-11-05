import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../storage/database.mjs';
import { createNodeEarnService } from './node-context.mjs';
import { createApplicationContext, deferredPort } from './context.mjs';
import { createEarnService } from '../earn/service.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
import { buildGoldenScenario } from './fixtures/earn-scenario.mjs';
import { addCampaign, recordStakeRead } from '../earn/workflow.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/earn-golden.json',import.meta.url),'utf8'));
test('Node service and synchronous reference repository reproduce the pre-extraction golden fixture',async t=>{
  const db=openDatabase();t.after(()=>db.close());
  const {source,nonDeterministicCapture,...expected}=fixture;
  assert.deepEqual(await buildGoldenScenario(db),expected);
  const service=createNodeEarnService(db,{nowMs:fixture.start+4*DAY_MS});
  assert.deepEqual((await service.readLeaderboard(fixture.epoch)).items.map(x=>x.submissionId),['submission-w1','submission-w2','submission-w3']);
  const claims=await service.readWalletClaims({kind:'wallet',wallet:'w2'});
  assert.equal(claims.executionEnabled,false);assert.equal(claims.items[0].vestedUnits,'1000');
  const member=await service.readWalletSubmissions({kind:'wallet',wallet:'w2'});
  assert.equal(member.items.length,1);assert.equal(member.memberStatus.asOf,new Date(fixture.start+4*DAY_MS).toISOString());
  assert.equal(member.memberStatus.latestFinalComponents.snapshotDigest,fixture.bundle.manifest.board.snapshotId);
  assert.equal(member.memberStatus.currentCutoff.status,'pending');
  assert.equal((await service.readWalletSubmissions({kind:'wallet',wallet:'unrelated'})).memberStatus.latestFinalComponents,null);
});
test('repository failure cannot return success; original request replays at a later clock',async t=>{
  const db=openDatabase();t.after(()=>db.close());const nowMs=fixture.start;
  addCampaign(db,{tokenId:'A',activationMs:nowMs,originalUnits:'1000000'});
  recordStakeRead(db,{wallet:'w1',tokenId:'A',observedMs:nowMs,expiresMs:nowMs,microUsd:'10000000',sourceRef:'synthetic'});
  const service=createNodeEarnService(db,{nowMs,ids:{next:()=> 'stable-submission'}});
  const principal={kind:'wallet',wallet:'w1'},input={tokenId:'A',url:'https://example.test/post',requestKey:'key'};
  db.exec("CREATE TEMP TRIGGER fail_admission BEFORE INSERT ON earn_submissions BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  await assert.rejects(service.submitContent(principal,input),/interrupted/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_submissions').get().n,0);
  db.exec('DROP TRIGGER fail_admission');
  const accepted=await service.submitContent(principal,input);assert.equal(accepted.replay,false);
  const replay=await createNodeEarnService(db,{nowMs:nowMs+2*DAY_MS}).submitContent(principal,input);
  assert.deepEqual(replay,{...accepted,replay:true});
  await assert.rejects(service.submitContent(principal,{...input,url:'https://example.test/changed'}),error=>error.code==='idempotency_conflict');
});
test('context is immutable, service binds principal and awaits rejected async repository commands',async()=>{
  const failure=Error('adapter unavailable');let seen;
  const input={clock:{nowMs:()=>fixture.start},ids:{next:()=> 'local'},crypto:createNodeCrypto(),
    repositories:{earn:{async admitSubmission(command){seen=command;await Promise.resolve();throw failure;}}},
    evidence:deferredPort(),artifacts:deferredPort(),jobs:deferredPort(),telemetry:{record(){}},
    executionPolicy:{mode:'local-validation',financialExecution:false}};
  const context=createApplicationContext(input),service=createEarnService(context);
  input.executionPolicy.financialExecution=true;input.repositories.earn.admitSubmission=async()=>({replay:false});
  await assert.rejects(service.submitContent({kind:'wallet',wallet:'owner'},{tokenId:'A',url:'https://EXAMPLE.test',requestKey:'k',wallet:'other'}),error=>error===failure);
  assert.equal(seen.principal.wallet,'owner');assert.equal(seen.input.url,'https://example.test/');
  assert.equal(seen.operationKind,'earn.admit-submission.v1');assert.match(seen.requestDigest,/^[a-f0-9]{64}$/);
  assert.deepEqual(seen.expectedRevisions,{});assert.equal(Object.isFrozen(context.executionPolicy),true);
  assert.throws(()=>createApplicationContext(input),/financial execution/);
});

// Local fixture covering the asynchronous gap between load and atomic commit.
async function preparedBoard(t) {
  const db=openDatabase();t.after(()=>db.close());
  const epoch=fixture.epoch,start=epoch*DAY_MS,cutoff=start+DAY_MS-1;
  addCampaign(db,{tokenId:'A',activationMs:start,originalUnits:'1000000'});
  for(const observedMs of [start,cutoff])recordStakeRead(db,{wallet:'w1',tokenId:'A',observedMs,expiresMs:observedMs,microUsd:'10000000',sourceRef:'synthetic'});
  const service=createNodeEarnService(db,{nowMs:start,ids:{next:()=> 'post'}});
  await service.submitContent({kind:'wallet',wallet:'w1'},{tokenId:'A',url:'https://example.test/post',requestKey:'key'});
  const review={submissionId:'post',score:7,reason:'Synthetic',sourceRef:'synthetic-review'};
  await service.recordFinalReview({kind:'operator',id:'synthetic-operator'},review);
  recordOwnership(db,{wallet:'w1',epoch,asOfMs:cutoff,assets:[],sourceRef:'synthetic-owner'});
  return {db,epoch,start,cutoff,review,query:{epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'synthetic-source'}};
}
import { recordOwnership } from '../earn/components.mjs';
import { createNodeEarnRepository } from '../storage/node/earn-repository.mjs';
import { computeBoard, computeAllocation } from '../earn/settlement.mjs';
test('portable final moderation preserves accepted retry time, rejects changed decisions and rolls back failure',async t=>{
  const {db,start,review}=await preparedBoard(t);
  const service=createNodeEarnService(db,{nowMs:start+DAY_MS});
  const principal={kind:'operator',id:'synthetic-operator'};
  assert.deepEqual(await service.recordFinalReview(principal,review),{recorded:true,replayed:true});
  assert.equal(db.prepare('SELECT reviewed_ms FROM earn_reviews').get().reviewed_ms,start);
  await assert.rejects(service.recordFinalReview(principal,{...review,score:8}),e=>e.code==='final_review');
  await assert.rejects(service.recordFinalReview({kind:'wallet',wallet:'w1'},review),e=>e.code==='operator_required');
  db.exec('DELETE FROM earn_reviews');
  db.exec("CREATE TEMP TRIGGER fail_review BEFORE INSERT ON earn_reviews BEGIN SELECT RAISE(ABORT,'review interrupted'); END");
  await assert.rejects(service.recordFinalReview(principal,review),/review interrupted/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_reviews').get().n,0);
});
test('captured board revisions reject intervening evidence and forged output; interrupted commit is atomic',async t=>{
  const {db,epoch,cutoff,query}=await preparedBoard(t),repository=createNodeEarnRepository(db);
  const loaded=await repository.loadBoardInput(query),plan=computeBoard(loaded.input);
  recordOwnership(db,{wallet:'w1',epoch,asOfMs:cutoff,assets:[],sourceRef:'synthetic-owner-new'});
  assert.deepEqual(await repository.commitBoard({query,versions:loaded.versions,plan}),{kind:'conflict',code:'revision_conflict'});
  const fresh=await repository.loadBoardInput(query),ready=computeBoard(fresh.input);
  await assert.rejects(repository.commitBoard({query,versions:fresh.versions,plan:{...ready,winners:[]}}),/differs/);
  db.exec("CREATE TEMP TRIGGER fail_decision BEFORE INSERT ON earn_decisions BEGIN SELECT RAISE(ABORT,'decision interrupted'); END");
  await assert.rejects(repository.commitBoard({query,versions:fresh.versions,plan:ready}),/decision interrupted/);
  for(const table of ['earn_boards','earn_decisions','earn_member_facts','earn_streaks'])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);
  db.exec('DROP TRIGGER fail_decision');
  const success=await repository.commitBoard({query,versions:fresh.versions,plan:ready});
  assert.equal(success.kind,'committed');assert.equal(success.value.status,'final');
  const replay=await repository.commitBoard({query,versions:fresh.versions,plan:ready});
  assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,success.value);
});
test('allocation repository rolls back the whole award set and replays exactly',async t=>{
  const {db,query,cutoff}=await preparedBoard(t),repository=createNodeEarnRepository(db);
  const service=createNodeEarnService(db,{nowMs:cutoff+1});
  await service.finalizeBoard(query);
  const aq={tokenId:'A',day:2,nowMs:cutoff+1};
  const loaded=await repository.loadAllocationInput(aq),plan=computeAllocation(loaded.input);
  db.exec("CREATE TEMP TRIGGER fail_award BEFORE INSERT ON earn_awards BEGIN SELECT RAISE(ABORT,'award interrupted'); END");
  await assert.rejects(repository.commitAllocation({query:aq,versions:loaded.versions,plan}),/award interrupted/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_allocations').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_awards').get().n,0);
  db.exec('DROP TRIGGER fail_award');
  const success=await service.recordAllocation(aq);
  assert.equal(success.status,'recorded');
  assert.deepEqual(await service.recordAllocation(aq),success);
});
