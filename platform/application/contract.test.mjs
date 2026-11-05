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
  assert.equal((await service.readWalletSubmissions({kind:'wallet',wallet:'w2'})).items.length,1);
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
