import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createEarnReadRepository} from './earn-reads.mjs';
import {createNodeEarnRepository} from './node/earn-repository.mjs';
import {buildGoldenScenario} from '../application/fixtures/earn-scenario.mjs';
import {capacityAt,configureWorkload} from '../earn/operations.mjs';
import {listActiveActions,configureAction,recordActionCompletion} from '../earn/components.mjs';
import {changeScope,actionDecision} from '../operations/controls.mjs';
import {readMemberStatus} from '../earn/member-projection.mjs';
import {importBoard} from '../earn/archive.mjs';
import {readWalletClaims,readWalletSubmissions,readLeaderboard} from './node/earn-workflow.mjs';
import {recordSamplePrice} from '../pricing/fixtures.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';
const wallet={kind:'wallet',wallet:'w1'};
const dto=value=>JSON.parse(JSON.stringify(value));
async function golden(t){
 const db=openDatabase();t.after(()=>db.close());
 const scenario=await buildGoldenScenario(db,{beforeFinalize(q){configureWorkload(db,{effectiveEpoch:q.epoch,atMs:q.epoch*DAY_MS-1,staffedMinutes:10,secondsPerReview:6,admissionLimit:100,operator:'fixture',reason:'synthetic staffing'});}});
 return {db,...scenario,repo:createEarnReadRepository(createNodeAtomicDriver(db))};
}
test('portable leaderboard, claims, owner submissions and final member components exactly match Node DTOs',async t=>{
 const {db,repo,epoch,start}=await golden(t),nowMs=start+2*DAY_MS,reference=createNodeEarnRepository(db);
 assert.deepEqual(await repo.readLeaderboard({epoch}),dto(await reference.readLeaderboard({epoch})));
 assert.deepEqual(await repo.readLeaderboard({epoch:epoch+10}),await reference.readLeaderboard({epoch:epoch+10}));
 assert.deepEqual(await repo.readWalletClaims({principal:wallet,nowMs}),await reference.readWalletClaims({principal:wallet,nowMs,after:0}));
 assert.deepEqual(await repo.readWalletSubmissions({principal:wallet,nowMs}),await reference.readWalletSubmissions({principal:wallet,nowMs,after:0}));
 const cap=capacityAt(db,Math.floor(nowMs/DAY_MS),nowMs);
 assert.deepEqual(await repo.readCapacity({nowMs}),{mode:'local-fixture',...cap,accepting:cap.accepting&&actionDecision(db,'earn-admission',nowMs).allowed});
 assert.deepEqual(await repo.readActions({nowMs}),{epoch:Math.floor(nowMs/DAY_MS),mode:'local-fixture',items:listActiveActions(db,Math.floor(nowMs/DAY_MS))});
 assert.deepEqual((await repo.readWalletClaims({principal:{kind:'wallet',wallet:'unrelated'},nowMs})).items,[]);
});
test('authenticated identity is mandatory before SQL and is captured before any asynchronous read',async t=>{
 const {db,repo,start}=await golden(t);let calls=0;
 const denied=createEarnReadRepository({async batch(){calls++;throw Error('should not query');}});
 for(const method of ['readWalletClaims','readWalletSubmissions'])await assert.rejects(denied[method]({principal:{kind:'operator',id:'w1'},nowMs:start}),e=>e.status===401);
 assert.equal(calls,0);
 const principal={kind:'wallet',wallet:'w1'},base=createNodeAtomicDriver(db),mutating=createEarnReadRepository({...base,async batch(s){principal.wallet='w2';return base.batch(s);}});
 const actual=await mutating.readWalletSubmissions({principal,nowMs:start+2*DAY_MS});
 assert.deepEqual(actual,await repo.readWalletSubmissions({principal:wallet,nowMs:start+2*DAY_MS}));
 assert.equal(actual.items[0].id,'submission-w1');
});
test('staffing, pending/accepted stake, action ownership and pause previews preserve reference semantics',async t=>{
 const db=openDatabase();t.after(()=>db.close());const nowMs=200*DAY_MS,epoch=200,repo=createEarnReadRepository(createNodeAtomicDriver(db));
 db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('A',nowMs,'1000000');
 assert.equal((await repo.readCapacity({nowMs})).reason,'staffing-required');
 let page=await repo.readWalletSubmissions({principal:wallet,nowMs});assert.equal(page.memberStatus.admission.status,'unavailable');assert.equal(page.memberStatus.admission.reason,'staffing-required');
 configureWorkload(db,{effectiveEpoch:epoch,atMs:nowMs-1,staffedMinutes:10,secondsPerReview:6,admissionLimit:100,operator:'fixture',reason:'synthetic staffing'});
 configureAction(db,{actionId:'learn',label:'Fixture guide',verifier:'fixture-proof',enabled:true,effectiveEpoch:epoch,atMs:nowMs-1});
 recordActionCompletion(db,{wallet:'w1',actionId:'learn',verifier:'fixture-proof',verifiedMs:nowMs,sourceRef:'synthetic-completion'});
 const compare=async time=>assert.deepEqual((await repo.readWalletSubmissions({principal:wallet,nowMs:time})).memberStatus,readMemberStatus(db,wallet,time));
 await compare(nowMs);
 const entry=recordSamplePrice(db,{wallet:'w1',tokenId:'A',asOfMs:nowMs,stakedUnits:'10000000',validUntilMs:nowMs+100});
 await compare(nowMs);await compare(nowMs+101);
 db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('post','w1','A',epoch,'https://example.test/private',nowMs,entry.receipt,'key');
 db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run('post',8,'private-reviewer','private-note',nowMs,'private-ref');
 page=await repo.readWalletSubmissions({principal:wallet,nowMs});assert.equal(page.items[0].score,null);assert.equal(page.items[0].reason,null);assert.equal(page.memberStatus.admission.items[0].status,'accepted');
 const other=await repo.readWalletSubmissions({principal:{kind:'wallet',wallet:'w2'},nowMs});assert.equal(other.items.length,0);assert.equal(other.memberStatus.actions.items[0].sourceRef,null);
 changeScope(db,{scope:'earn-admission',paused:true,atMs:nowMs+1,actor:'fixture',reason:'synthetic pause',evidenceRef:'fixture',requestKey:'pause'});
 await compare(nowMs+1);assert.equal((await repo.readCapacity({nowMs:nowMs+1})).accepting,false);
});
test('51-row wallet cursors preserve integer awards without leaking another wallet or duplicating pages',async t=>{
 const db=openDatabase();t.after(()=>db.close());const repo=createEarnReadRepository(createNodeAtomicDriver(db)),nowMs=DAY_MS/2;
 db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(0,'[]',1,'synthetic-board','synthetic-source');
 for(let n=0;n<51;n++){
  const token='A'+n;db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run(token,0,'10000000000000000000000');
  db.prepare('INSERT INTO earn_allocations VALUES(?,?,?,?,?,?,?,?)').run(token,1,0,0,0,DAY_MS,'100000000000000000001','0');
  db.prepare('INSERT INTO earn_awards VALUES(?,?,?,?)').run(token,1,'other','1');
  db.prepare('INSERT INTO earn_awards VALUES(?,?,?,?)').run(token,1,'w1','100000000000000000001');
  db.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)').run('read'+n,'w1',token,0,DAY_MS,'10000000','synthetic');
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('post'+n,'w1',token,n+1,'https://example.test/'+n,0,'read'+n,'key'+n);
 }
 const first=await repo.readWalletClaims({principal:wallet,nowMs}),second=await repo.readWalletClaims({principal:wallet,nowMs,after:first.nextCursor});
 assert.equal(first.items.length,50);assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
 assert.deepEqual(first,readWalletClaims(db,{wallet:'w1',nowMs,after:0}));assert.equal(first.items[0].vestedUnits,'50000000000000000000');
 const posts=await repo.readWalletSubmissions({principal:wallet,nowMs}),next=await repo.readWalletSubmissions({principal:wallet,nowMs,after:posts.nextCursor});
 assert.equal(posts.items.length,50);assert.equal(next.items.length,1);
 const {memberStatus,...page}=posts;assert.deepEqual(page,readWalletSubmissions(db,{wallet:'w1',after:0}));assert.equal(memberStatus.admission.reason,'campaign-bound');
});
test('bounds are explicit and a correction between read batches discards mixed data',async t=>{
 const {db,repo,epoch,start}=await golden(t),base=createNodeAtomicDriver(db);let changed=false;
 const racing=createEarnReadRepository({...base,async batch(s){const result=await base.batch(s);if(!changed&&s.some(q=>q.sql.includes('FROM earn_awards'))){changed=true;db.exec("UPDATE earn_awards SET amount='1'");}return result;}});
 assert.equal((await racing.readWalletClaims({principal:wallet,nowMs:start+2*DAY_MS})).reason,'revision_conflict');
 db.prepare('UPDATE earn_boards SET winners=? WHERE epoch=?').run(JSON.stringify(Array.from({length:101},(_,i)=>({wallet:'w'+i}))),epoch);
 assert.equal((await repo.readLeaderboard({epoch})).reason,'board-bound');
 for(let n=0;n<101;n++){db.prepare('INSERT INTO earn_action_catalog VALUES(?,?,?)').run('a'+n,'Fixture '+n,'fixture');db.prepare('INSERT INTO earn_action_changes VALUES(?,?,?,?)').run('a'+n,epoch,1,start);}
 assert.equal((await repo.readActions({nowMs:start})).reason,'action-bound');
 assert.equal((await repo.readWalletSubmissions({principal:{kind:'wallet',wallet:'other'},nowMs:start})).memberStatus.actions.reason,'action-bound');
});
test('portable archive leaderboard and owner claims match verified Node recovery DTOs',async t=>{
 const {bundle,epoch,start}=await golden(t),db=openDatabase();t.after(()=>db.close());importBoard(db,bundle.manifest,bundle.sha256);
 const repo=createEarnReadRepository(createNodeAtomicDriver(db)),nowMs=start+2*DAY_MS;
 assert.deepEqual(await repo.readLeaderboard({epoch}),readLeaderboard(db,epoch));
 assert.deepEqual(await repo.readLeaderboard({epoch:epoch+1}),readLeaderboard(db,epoch+1));
 assert.deepEqual(await repo.readWalletClaims({principal:wallet,nowMs}),readWalletClaims(db,{wallet:'w1',nowMs,after:0}));
});
