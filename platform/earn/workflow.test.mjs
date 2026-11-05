import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../storage/database.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { handleEarn } from './http.mjs';
import { addCampaign, finalizeBoard, readLeaderboard, recordAllocation, recordMemberFacts, recordReview, recordStakeRead, submitContent } from './workflow.mjs';

const epoch=20_000;
const start=epoch*DAY_MS;
const cutoff=start+DAY_MS-1;
const alice='alice-wallet';
const bob='bob-wallet';
const token='ATT';
const origin='http://localhost';
const tokenFor=wallet=>'test-session-'+wallet;
function session(db,wallet) {
  const hash=createHash('sha256').update(tokenFor(wallet)).digest('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash,wallet,origin,start+5*DAY_MS);
}
function setup(db) {
  addCampaign(db,{tokenId:token,activationMs:start,originalUnits:'1000000'});
  for (const wallet of [alice,bob]) session(db,wallet);
}
function read(db,wallet,time=start,microUsd='10000000',tokenId=token) {
  return recordStakeRead(db,{wallet,tokenId,observedMs:time,expiresMs:time+2000,microUsd,sourceRef:'test-position-'+time});
}
function facts(db,wallet,day=epoch) {
  recordMemberFacts(db,{wallet,epoch:day,intervals:[],completions:[],highestEligibleLevel:1,purchaseTokenDays:0,sourceRef:'owner-facts'});
}
function submit(db,wallet=alice,url='https://example.org/alice',key='submission-key') {
  return submitContent(db,{wallet,tokenId:token,url,requestKey:key,nowMs:start+1000}).submission;
}
function decide(db,post,score=9,time=start+10_000) {
  return recordReview(db,{submissionId:post.id,score,reason:'Original contribution',moderator:'operator',sourceRef:'review-proof',reviewedMs:time});
}
function finish(db,day=epoch,t=start+DAY_MS) {
  return finalizeBoard(db,{epoch:day,nowMs:t,sourceComplete:true,sourceRef:'local-snapshot'});
}
function api(db,path,now,options={}) {
  return handleEarn(db,new Request(origin+'/api/v1/earn'+path,options),'test-peer',now);
}
function writeOptions(wallet,body,key='web-key') {
  return {method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':key,
    cookie:'tenx_local_session='+tokenFor(wallet)},body:JSON.stringify(body)};
}

test('HTTP entry enforces wallet identity, origin, scoped idempotency and current stake', async t=>{
  const db=openDatabase(); t.after(()=>db.close()); setup(db);
  const body={tokenId:token,url:'https://example.org/article'};
  const post=(options,time=start+1)=>api(db,'/submissions',time,options);
  const unauth=writeOptions(alice,body);delete unauth.headers.cookie;
  assert.equal((await post(unauth)).status,401);
  const csrf=writeOptions(alice,body);csrf.headers.origin='https://attacker.test';
  assert.equal((await post(csrf)).status,403);
  assert.equal((await post(writeOptions(alice,{...body,wallet:bob}))).status,400);
  assert.equal((await post(writeOptions(alice,body))).status,503);
  read(db,alice,start-1000,'9999999');
  assert.equal((await post(writeOptions(alice,body))).status,422);
  read(db,alice);read(db,bob);
  const created=await post(writeOptions(alice,body));
  assert.equal(created.status,201);
  const result=await created.json();
  const replayAtNextEpoch=await post(writeOptions(alice,body),start+DAY_MS);
  assert.equal(replayAtNextEpoch.status,200);
  assert.equal((await replayAtNextEpoch.json()).id,result.id);
  assert.equal((await post(writeOptions(alice,{...body,url:'https://example.org/different'}))).status,409);
  assert.equal((await post(writeOptions(alice,body,'different-key'))).status,409);
  assert.equal((await post(writeOptions(bob,body))).status,201);
  const privateData=await (await api(db,'/me',start+2,{headers:{cookie:'tenx_local_session='+tokenFor(alice)}})).json();
  assert.deepEqual(privateData.items.map(x=>x.id),[result.id]);
});

test('rejects unsafe submissions and future/expired campaigns; a missing board is pending', async t=>{
  const db=openDatabase(); t.after(()=>db.close()); setup(db);
  read(db,alice);
  for (const url of ['http://example.org','https://127.0.0.1/a','https://user:pass@example.org/a','ftp://example.org/a']) {
    assert.equal((await api(db,'/submissions',start,writeOptions(alice,{tokenId:token,url}))).status,400);
  }
  assert.throws(()=>submitContent(db,{wallet:alice,tokenId:token,requestKey:'k',url:'https://example.org/a',nowMs:start-1}),/active local/);
  assert.throws(()=>submitContent(db,{wallet:alice,tokenId:token,requestKey:'k',url:'https://example.org/a',nowMs:start+10*DAY_MS}),/active local/);
  const pending=await (await api(db,'/epochs/2024-10-04/leaderboard',start)).json();
  assert.equal(pending.status,'pending');assert.deepEqual(pending.items,[]);
  assert.equal((await api(db,'/epochs/2024-02-30/leaderboard',start)).status,400);
});

test('offline board, decisions and allocations survive restart and repeated settlement', async t=>{
  const folder=mkdtempSync(join(tmpdir(),'tenx-earn-'));
  const path=join(folder,'local.sqlite');
  let db=openDatabase(path);
  t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  setup(db);read(db,alice);read(db,bob);
  const post=submit(db);const post2=submit(db,bob);
  assert.equal(finish(db,epoch,start+1).reason,'board-open');
  const bootstrap=finish(db,epoch-1,start);
  assert.equal(bootstrap.status,'final');
  assert.deepEqual(bootstrap.items,[]);
  const bootstrapPlan=recordAllocation(db,{tokenId:token,day:1,nowMs:start});
  assert.equal(bootstrapPlan.allocation.burn,'10000');
  assert.equal(finish(db).reason,'moderation');
  decide(db,post);decide(db,post2,5);
  assert.equal(finish(db).reason,'stake-evidence');
  read(db,alice,cutoff);
  read(db,bob,cutoff,'9999999');
  assert.equal(finish(db).reason,'participant-evidence');
  assert.equal(recordAllocation(db,{tokenId:token,day:2,nowMs:start+DAY_MS}).status,'pending');
  facts(db,alice);
  const published=finish(db);
  assert.equal(published.items.length,1);
  assert.equal(published.items[0].wallet,alice);
  assert.equal(published.items[0].pointsTenths,36); // 9 × (3 NFT tenths + one streak tenth)
  assert.throws(()=>decide(db,post,8),/final/);
  const plan=recordAllocation(db,{tokenId:token,day:2,nowMs:start+DAY_MS});
  assert.equal(plan.allocation.burn,'9000');
  addCampaign(db,{tokenId:'OTHER',activationMs:start+DAY_MS+60000,originalUnits:'100000'});
  assert.equal(recordAllocation(db,{tokenId:'OTHER',day:1,nowMs:start+DAY_MS+60000}).status,'recorded');
  db.close();db=openDatabase(path);
  assert.equal(finish(db).snapshotId,published.snapshotId);
  assert.deepEqual(recordAllocation(db,{tokenId:token,day:2,nowMs:start+2*DAY_MS}).allocation,plan.allocation);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_awards').get().n,2);
  const claims=async wallet=>(await api(db,'/claims',start+4*DAY_MS,{headers:{cookie:'tenx_local_session='+tokenFor(wallet)}})).json();
  const aliceClaims=await claims(alice);
  assert.deepEqual(aliceClaims.items.map(x=>x.vestedUnits),['1000','100']);
  assert.equal(aliceClaims.executionEnabled,false);
  assert.deepEqual((await claims(bob)).items,[]);
  const board=readLeaderboard(db,epoch);
  assert.equal(board.allocations.length,2);
  assert.equal(board.snapshotId,published.snapshotId);
});

test('recorded decisions and allocations roll back together on an interrupted write',t=>{
  const db=openDatabase(); t.after(()=>db.close()); setup(db);
  read(db,alice);const post=submit(db);decide(db,post);read(db,alice,cutoff);facts(db,alice);
  db.exec("CREATE TEMP TRIGGER fail_decision BEFORE INSERT ON earn_decisions BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  assert.throws(()=>finish(db),/interrupted/);
  assert.equal(readLeaderboard(db,epoch).status,'pending');
  db.exec('DROP TRIGGER fail_decision');finish(db);
  db.exec("CREATE TEMP TRIGGER fail_award BEFORE INSERT ON earn_awards BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  assert.throws(()=>recordAllocation(db,{tokenId:token,day:2,nowMs:start+DAY_MS}),/interrupted/);
  assert.equal(readLeaderboard(db,epoch).allocations.length,0);
  db.exec('DROP TRIGGER fail_award');
  assert.equal(recordAllocation(db,{tokenId:token,day:2,nowMs:start+DAY_MS}).status,'recorded');
});

test('late moderation earns streak only in the approval window', t=>{
  const db=openDatabase(); t.after(()=>db.close()); setup(db);
  read(db,alice);const post=submit(db);
  const next=start+DAY_MS;
  const lateTime=next+6000;
  decide(db,post,8,lateTime);facts(db,alice);read(db,alice,cutoff);
  assert.equal(finish(db,epoch,next).reason,'moderation');
  assert.equal(finish(db,epoch,lateTime).items[0].multiplierTenths,3);
  const following=finish(db,epoch+1,start+2*DAY_MS);
  assert.deepEqual(following.items,[]);
  const streak=db.prepare('SELECT days,last_approval_ms FROM earn_streaks WHERE epoch=? AND wallet=?').get(epoch+1,alice);
  assert.deepEqual({...streak},{days:1,last_approval_ms:lateTime});
});
