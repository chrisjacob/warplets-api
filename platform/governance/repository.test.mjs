import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createGovernancePlanning} from '../application/collection-governance.mjs';
import {createGovernanceService} from '../application/governance-service.mjs';
import {createGovernanceRepository} from './repository.mjs';
import {createGovernanceReadModel} from './read-model.mjs';
import {seedBallot,recordDecision} from './ballots.mjs';
import {encode58} from '../server/base58.mjs';
const open=20001*86400000,close=open+2*86400000,wallet=encode58(Buffer.alloc(32,1)),second=encode58(Buffer.alloc(32,2)),principal={kind:'wallet',wallet},crypto=createNodeCrypto();
function fixture(t,{wrap=driver=>driver}={}){
 const db=openDatabase();t.after(()=>db.close());let now=open+1000;db.function('governance_test_clock',()=>now);
 seedBallot(db,{id:'synthetic-ballot',opensAt:open,currentTrancheOpenedAt:open-86400000,holders:[wallet,second],nextWhitelist:[wallet]});
 const base={...createNodeAtomicDriver(db),leaseNowSql:'governance_test_clock()'},driver=wrap(base,db,value=>now=value),ports={crypto,ids:{next:randomUUID}},repository=createGovernanceRepository(driver,ports),reads=createGovernanceReadModel(driver),service=createGovernanceService({repository,reads,crypto,clock:{nowMs:()=>now}});
 return {db,base,repository,reads,service,setNow:value=>now=value,count:table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,command:(choice,expectedRevisions={})=>createGovernancePlanning({crypto}).castVote({principal,input:{ballotId:'synthetic-ballot',choice},requestKey:'synthetic-ballot',expectedRevisions,nowMs:now})};
}
test('guarded votes serialize same-wallet choices, replay after closing and keep public choices hidden until close',async t=>{
 const f=fixture(t),outcomes=await Promise.allSettled(['7','14'].map(choice=>f.service.castVote(principal,{ballotId:'synthetic-ballot',choice})));
 assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.count('genesis_votes'),1);assert.equal(f.count('app_command_receipts'),1);
 const choice=outcomes.find(row=>row.status==='fulfilled').value.choice;assert.equal((await f.service.readBallot('synthetic-ballot')).counts,null);
 const publicOpen=await f.service.listBallots();assert.equal(publicOpen.items[0].votesCast,1);assert.ok(!JSON.stringify(publicOpen).includes(wallet));
 f.setNow(close+1);assert.deepEqual(await f.service.castVote(principal,{ballotId:'synthetic-ballot',choice}),{choice,replayed:true});assert.equal((await f.service.readBallot('synthetic-ballot')).counts[choice],1);
 await assert.rejects(f.service.castVote({kind:'wallet',wallet:second},{ballotId:'synthetic-ballot',choice:'ASAP'}),error=>error.code==='ballot_closed');
 assert.throws(()=>f.db.prepare('UPDATE genesis_votes SET choice=?').run('ASAP'),/immutable/i);assert.throws(()=>f.db.prepare('DELETE FROM genesis_voters').run(),/immutable/i);
 assert.throws(()=>f.db.prepare('INSERT INTO genesis_voters VALUES(?,?)').run('synthetic-ballot',encode58(Buffer.alloc(32,3))));
});
test('legacy vote adoption preserves original time and new receipt conflicts on altered request body',async t=>{
 const f=fixture(t);f.db.prepare('INSERT INTO genesis_votes VALUES(?,?,?,?)').run('synthetic-ballot',wallet,'30',open+500);f.setNow(close+1);
 assert.deepEqual(await f.service.castVote(principal,{ballotId:'synthetic-ballot',choice:'30'}),{choice:'30',replayed:true});assert.equal(f.count('app_command_receipts'),1);
 assert.equal(f.db.prepare('SELECT voted_ms FROM genesis_votes').get().voted_ms,open+500);
 const receipt=f.db.prepare('SELECT input_json FROM app_command_receipts').get();assert.equal(JSON.parse(receipt.input_json).adoptedLegacy,true);
 await assert.rejects(f.service.castVote(principal,{ballotId:'synthetic-ballot',choice:'7'}),error=>error.code==='idempotency_conflict');
 const replay=await f.repository.castVote(await f.command('30',{source:'999999999'}));assert.equal(replay.kind,'replayed');
});
test('missing vote child aborts receipt and a lost commit acknowledgement resolves the same immutable vote',async t=>{
 let omit=true;const broken=fixture(t,{wrap:base=>({...base,async batch(statements){return base.batch(omit&&statements.some(row=>row.sql.startsWith('INSERT INTO app_command_receipts'))?statements.filter(row=>!row.sql.startsWith('INSERT INTO genesis_votes')):statements);}})});
 await assert.rejects(broken.service.castVote(principal,{ballotId:'synthetic-ballot',choice:'7'}));assert.equal(broken.count('genesis_votes'),0);assert.equal(broken.count('app_command_receipts'),0);omit=false;assert.equal((await broken.service.castVote(principal,{ballotId:'synthetic-ballot',choice:'7'})).replayed,false);
 let lost=true;const uncertain=fixture(t,{wrap:base=>({...base,async batch(statements){const result=await base.batch(statements);if(lost&&statements.some(row=>row.sql.startsWith("UPDATE app_command_receipts SET state='committed'"))){lost=false;throw Error('synthetic lost acknowledgement');}return result;}})});
 assert.deepEqual(await uncertain.service.castVote(principal,{ballotId:'synthetic-ballot',choice:'ASAP'}),{choice:'ASAP',replayed:true});assert.equal(uncertain.count('genesis_votes'),1);assert.equal(uncertain.count('app_command_receipts'),1);
});
test('SQL execution clock closes the final transport interval and immutable electorate prevents revocation races',async t=>{
 let raced=false;const f=fixture(t,{wrap:(base,db,setNow)=>({...base,async batch(statements){if(!raced&&statements.some(row=>row.sql.startsWith('INSERT INTO app_command_receipts'))){raced=true;setNow(close);}return base.batch(statements);}})});
 await assert.rejects(f.service.castVote(principal,{ballotId:'synthetic-ballot',choice:'7'}),error=>error.code==='ballot_closed');assert.equal(f.count('genesis_votes'),0);assert.equal(f.count('app_command_receipts'),0);
 assert.throws(()=>f.db.prepare('UPDATE genesis_ballots SET closes_ms=closes_ms+1').run(),/immutable/i);
});
test('zero turnout reads, immutable decision and incomplete electorate stay truthful',async t=>{
 const f=fixture(t);f.setNow(close);recordDecision(f.db,{id:'synthetic-ballot',choice:'7',decidedAt:close,noticeAt:open,rationale:'Synthetic founder rationale'},close);
 const summary=await f.service.readBallot('synthetic-ballot');assert.equal(summary.votesCast,0);assert.deepEqual(summary.counts,{ASAP:0,7:0,14:0,30:0});assert.equal(summary.decision.rationale,'Synthetic founder rationale');
 assert.throws(()=>f.db.prepare('UPDATE genesis_decisions SET rationale=?').run('Changed'),/immutable/i);
 f.db.prepare('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)').run('synthetic-partial',open,close,open-86400000,'a'.repeat(64),1);
 await assert.rejects(f.service.readBallot('synthetic-partial'),error=>error.code==='electorate_incomplete');
});
test('malformed retained ballot identity is unavailable and invalid direct principals cannot become votes',async t=>{
 const f=fixture(t);f.db.prepare('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)').run('synthetic-invalid',open,open+1000,open,'legacy-invalid-digest',0);
 await assert.rejects(f.service.readBallot('synthetic-invalid'),error=>error.status===503&&error.code==='invalid_ballot_context');
 await assert.rejects(f.service.castVote(principal,{ballotId:'synthetic-invalid',choice:'7'}),error=>error.status===503&&error.code==='invalid_ballot_context');
 await assert.rejects(f.service.castVote({kind:'wallet',wallet:'invalid'},{ballotId:'synthetic-ballot',choice:'7'}),error=>error.status===401);
 assert.equal(f.count('genesis_votes'),0);assert.equal(f.count('app_command_receipts'),0);
});
test('repository captures commands before hashing and bounded retries hold persistent revision races',async t=>{
 const f=fixture(t),command=structuredClone(await f.command('7'));let changed=false;
 const repository=createGovernanceRepository(f.base,{ids:{next:randomUUID},crypto:{...crypto,async sha256(bytes){if(!changed){changed=true;command.input.choice='30';command.principal.wallet=second;command.expectedRevisions.source='999999';}return crypto.sha256(bytes);}}});
 const accepted=await repository.castVote(command);assert.equal(accepted.kind,'committed');assert.equal(accepted.value.choice,'7');assert.equal(f.db.prepare('SELECT wallet FROM genesis_votes').get().wallet,wallet);
 let attempts=0;const racing=fixture(t,{wrap:(base,db)=>({...base,async batch(statements){const result=await base.batch(statements);if(statements.some(s=>s.sql==='SELECT * FROM genesis_ballots WHERE id=?')){attempts++;db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();}return result;}})});
 await assert.rejects(racing.service.castVote(principal,{ballotId:'synthetic-ballot',choice:'7'}),error=>error.code==='governance_concurrent_change'&&error.status===503);assert.equal(attempts,2);assert.equal(racing.count('genesis_votes'),0);assert.equal(racing.count('app_command_receipts'),0);
 attempts=0;await assert.rejects(racing.service.readBallot('synthetic-ballot'),error=>error.code==='governance_read_changed');assert.equal(attempts,2);
});
test('10000-member frozen electorate admits through bounded aggregate facts and a compact three-statement mutation',async t=>{
 const db=openDatabase();t.after(()=>db.close());const holders=[wallet,...Array.from({length:9999},(_,index)=>{const value=Buffer.alloc(32);value.writeUInt32BE(index+100,28);return encode58(value);})];
 seedBallot(db,{id:'large',opensAt:open,currentTrancheOpenedAt:open,holders,nextWhitelist:[wallet]});
 db.function('governance_test_clock',()=>open+1);const measurements=[],reads=[],base=createNodeAtomicDriver(db),driver={...base,leaseNowSql:'governance_test_clock()',async batch(statements){const result=await base.batch(statements);reads.push(...result.map(r=>r.rows.length));return result;}};
 const repository=createGovernanceRepository(driver,{crypto,ids:{next:randomUUID},telemetry:{record(name,value){if(name==='atomic-batch')measurements.push(value);}}});
 const command=await createGovernancePlanning({crypto}).castVote({principal,input:{ballotId:'large',choice:'7'},requestKey:'large',expectedRevisions:{},nowMs:open+1});
 assert.equal((await repository.castVote(command)).kind,'committed');assert.equal(db.prepare('SELECT COUNT(*) n FROM genesis_voters').get().n,10000);
 assert.ok(Math.max(...reads)<=3);assert.equal(measurements.length,1);assert.equal(measurements[0].statements,3);assert.ok(measurements[0].maxParameters<=100);assert.ok(measurements[0].batchBytes<16384);t.diagnostic(JSON.stringify(measurements[0]));
});
