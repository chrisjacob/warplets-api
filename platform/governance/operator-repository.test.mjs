import test from 'node:test';
import assert from 'node:assert/strict';
import {governanceOperatorFixture,governanceWallets,GOVERNANCE_OPERATOR,GOVERNANCE_OPEN} from './operator-test-fixture.mjs';
import {seedBallot,recordDecision} from './ballots.mjs';
import {createGovernanceReadModel} from './read-model.mjs';
import {prepareGovernanceOperatorCommand,PUBLISH_BALLOT} from './operator-service.mjs';
const DAY=86400000;
test('guarded publication binds exact frozen group union and legacy snapshot bytes without public operator authority',async t=>{
 const f=await governanceOperatorFixture(t),results=await Promise.all([f.publish(),f.publish()]);assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);
 const result=results[0].value;assert.equal(result.snapshotHash,f.expectedHash);assert.equal(result.eligibleCount,4);assert.equal(result.executable,false);assert.equal(result.sourceKind,'synthetic-local-operator-fixture');
 assert.deepEqual(f.db.prepare('SELECT wallet FROM genesis_voters ORDER BY wallet').all().map(row=>row.wallet),f.union);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_governance_publications').get().n,1);
 const read=await createGovernanceReadModel(f.base).readBallot({id:f.input.ballotId,nowMs:GOVERNANCE_OPEN+1});assert.equal(read.kind,'ready');assert.equal(read.value.counts,null);assert.equal(read.value.votesCast,0);
 f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='governance-publication'").run();assert.equal((await f.publish()).kind,'replayed');assert.equal((await f.publish({electorateSourceId:'changed'})).code,'idempotency_conflict');
 assert.throws(()=>f.db.prepare('UPDATE app_governance_publications SET source_id=?').run('changed'),/immutable/);assert.throws(()=>f.db.prepare('DELETE FROM app_governance_publications').run(),/Retain frozen/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM collect_inventories').get().n,0);
 await assert.rejects(f.service.publishBallot({kind:'wallet',wallet:f.union[0]},{input:f.input,requestKey:'member'}));
});
test('missing index, wrong seal/union/source digest and changed indexed bytes cannot become an electorate',async t=>{
 const absent=await governanceOperatorFixture(t,{index:false});assert.equal((await absent.publish()).reason,'electorate-index-missing');assert.equal(absent.db.prepare('SELECT COUNT(*) n FROM genesis_ballots').get().n,0);
 const wrong=await governanceOperatorFixture(t,{union:governanceWallets(2)});assert.equal((await wrong.publish()).code,'electorate_union_conflict');
 const f=await governanceOperatorFixture(t);assert.equal((await f.publish({holdersListId:'f'.repeat(64)})).reason,'electorate-seal-missing');assert.equal((await f.publish({electorateDigest:'a'.repeat(64)})).code,'electorate_digest_conflict');await assert.rejects(f.publish({cutoffMs:GOVERNANCE_OPEN+1}));
 let tamper=true;const changed=await governanceOperatorFixture(t,{wrap:base=>({...base,async batch(statements){const results=await base.batch(statements);for(let i=0;i<statements.length;i++)if(tamper&&statements[i].sql.includes('FROM app_collection_eligibility_pages WHERE'))for(const row of results[i].rows)row.entries_json='[]';return results;}})});
 assert.equal((await changed.publish()).reason,'electorate-index-conflict');tamper=false;assert.equal((await changed.publish()).kind,'committed');
});
test('missing publication children roll back, lost acknowledgement replays, and current operator grants fence writes',async t=>{
 for(const child of ['genesis_ballots','app_governance_publications','genesis_voters']){
  let omit=true;const f=await governanceOperatorFixture(t,{wrap:base=>({...base,async batch(statements){return base.batch(omit?statements.filter(s=>!s.sql.startsWith('INSERT INTO '+child+'(')):statements);}})});
  const before=f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n;await assert.rejects(f.publish());assert.equal(f.db.prepare('SELECT COUNT(*) n FROM genesis_ballots').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM genesis_voters').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,before);omit=false;assert.equal((await f.publish()).kind,'committed');
 }
 let lost=true;const f=await governanceOperatorFixture(t,{wrap:base=>({...base,async batch(statements){const result=await base.batch(statements);if(lost&&statements.some(s=>s.sql.startsWith('INSERT INTO app_governance_publications'))){lost=false;throw Error('Synthetic publication acknowledgement loss.');}return result;}})});assert.equal((await f.publish()).kind,'replayed');
 let revoke=true;const denied=await governanceOperatorFixture(t,{wrap:(base,db)=>({...base,async batch(statements){if(revoke&&statements.some(s=>s.sql.startsWith('INSERT INTO app_governance_publications'))){revoke=false;db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='governance-publication'").run();}return base.batch(statements);}})});assert.equal((await denied.publish()).code,'revision_conflict');assert.equal(denied.db.prepare('SELECT COUNT(*) n FROM genesis_ballots').get().n,0);
});
test('10000-member union is exact and publishes through six compact SQL statements including audit without voter arrays in the receipt',async t=>{
 const wallets=governanceWallets(10000),f=await governanceOperatorFixture(t,{holders:wallets.slice(0,6000),nextWhitelist:wallets.slice(4000)});const accepted=await f.publish();assert.equal(accepted.kind,'committed');assert.equal(accepted.value.eligibleCount,10000);assert.equal(accepted.value.snapshotHash,f.expectedHash);
 assert.deepEqual(f.db.prepare('SELECT wallet FROM genesis_voters ORDER BY wallet').all().map(row=>row.wallet),wallets);
 const receipt=f.db.prepare("SELECT input_json,result_json FROM app_command_receipts WHERE operation_kind='governance.publish-ballot.v1'").get();assert.ok(receipt.input_json.length<2000);assert.ok(!receipt.input_json.includes(wallets[0]));
 assert.ok(Math.max(...f.measurements.map(m=>m.maxParameters))<=100);assert.ok(Math.max(...f.measurements.map(m=>m.batchBytes))<32768);const mutation=f.measurements.find(m=>m.statements===6);assert.ok(mutation);t.diagnostic(JSON.stringify({wallets:10000,preparationAndCommitStatements:f.measurements.reduce((sum,m)=>sum+m.statements,0),mutation,receiptBytes:Buffer.byteLength(receipt.input_json)+Buffer.byteLength(receipt.result_json)}));
});
test('empty electorate, exact zero-turnout founder notice rules, immutable adoption and after-revocation replay',async t=>{
 for(const choice of ['ASAP','7','14','30']){
  const f=await governanceOperatorFixture(t,{holders:[],nextWhitelist:[]});assert.equal((await f.publish()).kind,'committed');assert.equal((await f.decision({choice})).code,'invalid_decision');f.setNow(GOVERNANCE_OPEN+2*DAY);
  const result=await f.decision({choice});assert.equal(result.kind,'committed');assert.equal(result.value.earliestMs,Math.max(GOVERNANCE_OPEN+2*DAY,GOVERNANCE_OPEN-DAY+(choice==='ASAP'?0:Number(choice)*DAY)));assert.equal((await f.decision({choice},'different-key')).code,'decision_already_recorded');
  f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='governance-decision'").run();assert.equal((await f.decision({choice})).kind,'replayed');assert.equal((await f.decision({choice,rationale:'Changed rationale'})).code,'idempotency_conflict');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM genesis_votes').get().n,0);
 }
 const legacy=await governanceOperatorFixture(t);seedBallot(legacy.db,{id:legacy.input.ballotId,opensAt:GOVERNANCE_OPEN,currentTrancheOpenedAt:GOVERNANCE_OPEN-DAY,holders:legacy.holders,nextWhitelist:legacy.nextWhitelist});assert.equal((await legacy.publish()).code,'ballot_already_published');legacy.setNow(GOVERNANCE_OPEN+2*DAY);
 recordDecision(legacy.db,{id:legacy.input.ballotId,choice:'7',decidedAt:GOVERNANCE_OPEN+2*DAY,noticeAt:GOVERNANCE_OPEN,rationale:'Synthetic founder rationale.'},legacy.getNow());const prior=legacy.db.prepare('SELECT * FROM genesis_decisions').get(),adopted=await legacy.decision();assert.equal(adopted.kind,'committed');assert.deepEqual(legacy.db.prepare('SELECT * FROM genesis_decisions').get(),prior);assert.equal(JSON.parse(legacy.db.prepare("SELECT input_json FROM app_command_receipts WHERE operation_kind='governance.record-decision.v1'").get().input_json).adoptedLegacy,true);
});
test('partial legacy electorate, missing decision child, decision authority and SQL-time races remain held',async t=>{
 const partial=await governanceOperatorFixture(t);partial.db.prepare('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)').run(partial.input.ballotId,GOVERNANCE_OPEN,GOVERNANCE_OPEN+2*DAY,GOVERNANCE_OPEN-DAY,'a'.repeat(64),1);partial.setNow(GOVERNANCE_OPEN+2*DAY);assert.equal((await partial.decision()).reason,'electorate-incomplete');
 let omit=true;const missing=await governanceOperatorFixture(t,{wrap:base=>({...base,async batch(statements){return base.batch(omit?statements.filter(s=>!s.sql.startsWith('INSERT INTO genesis_decisions')):statements);}})});await missing.publish();missing.setNow(GOVERNANCE_OPEN+2*DAY);await assert.rejects(missing.decision());assert.equal(missing.db.prepare('SELECT COUNT(*) n FROM genesis_decisions').get().n,0);omit=false;assert.equal((await missing.decision()).kind,'committed');
 let raced=false;const clock=await governanceOperatorFixture(t,{wrap:(base,db,setNow)=>({...base,async batch(statements){if(!raced&&statements.some(s=>s.sql.startsWith('INSERT INTO genesis_decisions'))){raced=true;setNow(GOVERNANCE_OPEN+2*DAY-1);}return base.batch(statements);}})});await clock.publish();clock.setNow(GOVERNANCE_OPEN+2*DAY);assert.equal((await clock.decision()).code,'revision_conflict');assert.equal(clock.db.prepare('SELECT COUNT(*) n FROM genesis_decisions').get().n,0);
});
test('expanded publication bindings are captured before digest awaits and cannot be substituted at the repository boundary',async t=>{
 const f=await governanceOperatorFixture(t),args={principal:structuredClone(GOVERNANCE_OPERATOR),input:structuredClone(f.input),requestKey:'capture',expectedRevisions:{},nowMs:f.getNow()},crypto={...f.ports.crypto,async sha256(bytes){args.input.unionListId='f'.repeat(64);args.principal.id='changed';return f.ports.crypto.sha256(bytes);}};
 const command=await prepareGovernanceOperatorCommand(PUBLISH_BALLOT,args,crypto);assert.equal(command.input.unionListId,f.input.unionListId);assert.equal(command.principal.id,GOVERNANCE_OPERATOR.id);assert.equal((await f.repository.publishBallot(command)).kind,'committed');
 const forged=structuredClone(command);forged.input.holdersListId='f'.repeat(64);await assert.rejects(f.repository.publishBallot(forged),/Invalid governance operator command/);
});
