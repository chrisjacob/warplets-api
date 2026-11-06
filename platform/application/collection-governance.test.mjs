import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGovernancePlanning} from './collection-governance.mjs';
import {createCollectionStateCodec} from '../collect/state-codec.mjs';
import {openBallot,castVote,tallyBallot,earliestTrancheOpening,NOTICE_MS} from '../domain/collections/ballot.mjs';
import {DAY_MS} from '../domain/collections/policy.mjs';
import {openDatabase} from '../storage/database.mjs';
import {seedBallot,recordDecision} from '../governance/ballots.mjs';
import {encode58} from '../server/base58.mjs';
const crypto={sha256:async bytes=>createHash('sha256').update(bytes).digest('hex')},planning=createGovernancePlanning({crypto}),codec=createCollectionStateCodec({crypto});
const wallet=n=>{const bytes=Buffer.alloc(32,111);bytes.writeUInt32BE(n,28);return encode58(bytes);};
const opens=2*DAY_MS,closes=opens+NOTICE_MS,operator={kind:'operator',id:'synthetic-governor'},envelope=(input,principal=operator,nowMs=closes)=>({principal,input,nowMs,requestKey:'synthetic-request',expectedRevisions:{source:'0',control:'0'}});
async function publication(source){const electorateDigest=await planning.electorateDigest(source),c=await planning.publishBallot(envelope({ballotId:'synthetic-ballot',opensMs:opens,previousTrancheOpeningMs:0,electorateSourceId:source.sourceId,electorateDigest}));return {command:c,plan:await planning.planPublication(c,source)};}
test('frozen union publication preserves legacy snapshot bytes, deduplicates voters and produces only compact result plus staged pages',async t=>{
 const source={sourceId:'synthetic-electorate',cutoffMs:opens,holders:[wallet(1),wallet(1)],nextWhitelist:[wallet(1),wallet(2)]},before=JSON.stringify(source),{plan}=await publication(source);
 const db=openDatabase();t.after(()=>db.close());const legacy=seedBallot(db,{id:'synthetic-ballot',opensAt:opens,currentTrancheOpenedAt:0,holders:source.holders,nextWhitelist:source.nextWhitelist});
 assert.equal(plan.result.snapshotHash,legacy);assert.equal(plan.result.eligibleCount,2);assert.equal(JSON.stringify(source),before);assert.equal(plan.result.executable,false);assert.ok(Buffer.byteLength(JSON.stringify(plan.result))<1024);
 const manifest=await codec.verifyRecord(plan.electorate.manifest);assert.equal(manifest.count,2);assert.deepEqual((await codec.verifyRecord(plan.electorate.pages[0])).entries,[wallet(1),wallet(2)].sort());
});
test('10000-member union pages are complete and over-limit or mismatched source cannot publish a plan',async()=>{
 const wallets=Array.from({length:10001},(_,n)=>wallet(n)),source={sourceId:'synthetic-max-electorate',cutoffMs:opens,holders:wallets.slice(0,6000),nextWhitelist:wallets.slice(4000,10000)},ready=await publication(source);
 assert.equal(ready.plan.result.eligibleCount,10000);assert.equal(ready.plan.electorate.pages.length,100);assert.ok(ready.plan.electorate.pages.every(page=>page.size<=65536));
 await assert.rejects(planning.planPublication(ready.command,{...source,cutoffMs:opens+1}),/source mismatch/);
 await assert.rejects(publication({...source,nextWhitelist:wallets.slice(4000)}),/10000 distinct/);
 await assert.rejects(publication({...source,holders:[' '+wallet(1)]}),/base58/);
});
test('selected-wallet vote facts match full ballot semantics and original vote replays after close without reopening membership',async()=>{
 const voters=Array.from({length:50},(_,n)=>wallet(n));let full=openBallot({id:'synthetic-ballot',opensAt:opens,currentTrancheOpenedAt:0,holders:voters,nextWhitelist:[]});
 const ballot={id:full.id,opensAt:full.opensAt,closesAt:full.closesAt,currentTrancheOpenedAt:0,snapshotHash:'a'.repeat(64)};
 for(let n=0;n<voters.length;n++){
  const choice=['ASAP','7','14','30'][n%4],c=await planning.castVote(envelope({ballotId:ballot.id,choice},{kind:'wallet',wallet:voters[n]},opens+n)),facts={ballot,membership:{wallet:voters[n],eligible:true,snapshotHash:ballot.snapshotHash},priorVote:null};
  const plan=planning.planVote(c,facts);full=castVote(full,{wallet:voters[n],choice,at:opens+n});assert.deepEqual({wallet:plan.vote.wallet,choice:plan.vote.choice},full.votes.at(-1));assert.equal(plan.voteCountDelta,1);
  const retry={...c,nowMs:closes+1};assert.deepEqual(planning.planVote(retry,{...facts,membership:{...facts.membership,eligible:false,snapshotHash:'b'.repeat(64)},priorVote:plan.vote}),{status:'ready',replayed:true,vote:plan.vote,voteCountDelta:0});
  const changed=await planning.castVote(envelope({ballotId:ballot.id,choice:choice==='ASAP'?'7':'ASAP'},{kind:'wallet',wallet:voters[n]},closes+1));assert.throws(()=>planning.planVote(changed,{...facts,priorVote:plan.vote}),error=>error.code==='wallet_already_voted');
 }
 assert.equal(tallyBallot(full,closes).votesCast,50);
 const outsider=wallet(100),c=await planning.castVote(envelope({ballotId:ballot.id,choice:'ASAP'},{kind:'wallet',wallet:outsider},opens));
 assert.throws(()=>planning.planVote(c,{ballot,membership:{wallet:outsider,eligible:false,snapshotHash:ballot.snapshotHash},priorVote:null}),error=>error.code==='voter_ineligible');
 assert.throws(()=>planning.planVote({...c,nowMs:closes},{ballot,membership:{wallet:outsider,eligible:true,snapshotHash:ballot.snapshotHash},priorVote:null}),error=>error.code==='ballot_closed');
});
test('zero turnout decisions preserve concurrent notice and exact 7/14/30 day rules, immutable rationale and legacy result',async t=>{
 const source={sourceId:'synthetic-empty',cutoffMs:opens,holders:[],nextWhitelist:[]},{plan}=await publication(source),ballot={id:'synthetic-ballot',opensAt:opens,closesAt:closes,currentTrancheOpenedAt:0,snapshotHash:plan.result.snapshotHash};
 assert.equal(plan.result.eligibleCount,0);assert.equal(plan.electorate.pages.length,1);assert.equal((await codec.verifyRecord(plan.electorate.pages[0])).entries.length,0);
 for(const choice of ['ASAP','7','14','30']){
  const db=openDatabase();t.after(()=>db.close());seedBallot(db,{id:ballot.id,opensAt:opens,currentTrancheOpenedAt:0,holders:[],nextWhitelist:[]});
  const c=await planning.recordDecision(envelope({ballotId:ballot.id,choice,decidedMs:closes,noticeMs:opens,rationale:'Synthetic explicit founder decision'})),planned=planning.planDecision(c,{ballot,priorDecision:null});
  assert.equal(planned.decision.earliestMs,earliestTrancheOpening({ballot,founderChoice:choice,decidedAt:closes,noticeAt:opens}));
  const legacy=recordDecision(db,{id:ballot.id,choice,decidedAt:closes,noticeAt:opens,rationale:c.input.rationale},closes);assert.equal(legacy.earliestOpening,new Date(planned.decision.earliestMs).toISOString());
  assert.equal(planning.planDecision(c,{ballot,priorDecision:planned.decision}).replayed,true);
  assert.throws(()=>planning.planDecision({...c,input:{...c.input,rationale:'Changed final rationale'}},{ballot,priorDecision:planned.decision}),/already recorded/);
  assert.throws(()=>planning.planDecision({...c,input:{...c.input,decidedMs:closes-1}},{ballot,priorDecision:null}),error=>error.code==='ballot_still_open');
 }
});
test('command builders bind actor/body and capture mutation before digest awaits; member cannot build operator command',async()=>{
 const args=envelope({ballotId:'synthetic-ballot',choice:'7'},{kind:'wallet',wallet:wallet(1)},opens),original=JSON.stringify(args);
 const slow=createGovernancePlanning({crypto:{sha256:async bytes=>{args.input.choice='30';args.principal.wallet=wallet(2);return crypto.sha256(bytes);}}}),command=await slow.castVote(args);
 assert.equal(command.input.choice,'7');assert.equal(command.principal.wallet,wallet(1));assert.throws(()=>{command.input.choice='ASAP';},TypeError);
 const retry=JSON.parse(original);retry.nowMs+=500;assert.equal((await planning.castVote(retry)).requestDigest,command.requestDigest);
 await assert.rejects(planning.recordDecision(envelope({ballotId:'synthetic-ballot',choice:'ASAP',decidedMs:closes,noticeMs:opens,rationale:'Synthetic'},args.principal)),/principal kind/);
 await assert.rejects(planning.castVote(envelope({ballotId:'synthetic-ballot',choice:'7',wallet:wallet(2)},{kind:'wallet',wallet:wallet(1)})),/Unexpected/);
});
