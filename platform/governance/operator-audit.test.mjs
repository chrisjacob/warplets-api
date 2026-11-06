import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {governanceOperatorFixture,GOVERNANCE_OPERATOR,GOVERNANCE_OPEN} from './operator-test-fixture.mjs';
import {seedBallot,recordDecision} from './ballots.mjs';
import {createGovernanceOperatorRepository} from './operator-repository.mjs';
import {prepareGovernanceOperatorCommand,PUBLISH_BALLOT,RECORD_DECISION} from './operator-service.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
const DAY=86400000;
const audits=db=>db.prepare('SELECT * FROM ops_config_audit ORDER BY seq').all();
const governanceAudits=db=>audits(db).filter(row=>row.category.startsWith('governance-'));
const sourceCount=db=>{const n=audits(db).filter(row=>!row.category.startsWith('governance-')).length;assert.equal(n,12,'Exact genuine061 source/index audit baseline');return n;};
const counts=db=>['genesis_ballots','genesis_voters','genesis_decisions','app_governance_publications','app_command_receipts','ops_config_audit'].map(table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n);
const decisionInput=f=>({ballotId:f.input.ballotId,choice:'7',decidedMs:GOVERNANCE_OPEN+2*DAY,noticeMs:GOVERNANCE_OPEN,rationale:'Synthetic founder rationale.'});
const command=(f,kind,input,key,expectedRevisions={})=>prepareGovernanceOperatorCommand(kind,{principal:GOVERNANCE_OPERATOR,input,requestKey:key,expectedRevisions,nowMs:f.getNow()},f.ports.crypto);
async function legacy(f){seedBallot(f.db,{id:f.input.ballotId,opensAt:GOVERNANCE_OPEN,currentTrancheOpenedAt:GOVERNANCE_OPEN-DAY,holders:f.holders,nextWhitelist:f.nextWhitelist});f.setNow(GOVERNANCE_OPEN+2*DAY);recordDecision(f.db,{id:f.input.ballotId,choice:'7',decidedAt:f.getNow(),noticeAt:GOVERNANCE_OPEN,rationale:'Synthetic founder rationale.'},f.getNow());f.setNow(f.getNow()+DAY);}
async function checkHash(f,row,payload){
 assert.equal(row.payload,orderedJson(payload));
 assert.equal(row.event_hash,await f.ports.crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',row.seq,row.previous_hash,row.category,row.entity,row.change_key,row.recorded_ms,row.actor,row.evidence_ref,payload]))));
 assert.equal(row.actor,GOVERNANCE_OPERATOR.id);assert.equal(verifyConfigChain(f.db).events,audits(f.db).length);
}

test('publication and decision retain exact ordered audit preimages and historical request digests',async t=>{
 const f=await governanceOperatorFixture(t),publication=await command(f,PUBLISH_BALLOT,f.input,'publish'),accepted=await f.repository.publishBallot(publication);assert.equal(accepted.kind,'committed');
 const row=governanceAudits(f.db)[0];assert.equal(row.category,'governance-publication');assert.equal(row.evidence_ref,f.input.electorateSourceId);assert.equal(row.recorded_ms,f.getNow());
 await checkHash(f,row,{requestDigest:publication.requestDigest,snapshotHash:f.expectedHash,eligibleCount:f.union.length,electorateDigest:f.input.electorateDigest,holdersListId:f.input.holdersListId,nextWhitelistListId:f.input.nextWhitelistListId,unionListId:f.input.unionListId,sourceKind:f.input.sourceKind});
 f.setNow(GOVERNANCE_OPEN+2*DAY);const c=await command(f,RECORD_DECISION,decisionInput(f),'decision'),d=await f.repository.recordDecision(c);assert.equal(d.kind,'committed');
 const second=governanceAudits(f.db)[1];assert.equal(second.previous_hash,row.event_hash);assert.equal(second.category,'governance-decision');assert.equal(second.evidence_ref,f.expectedHash);
 await checkHash(f,second,{...d.value,requestDigest:c.requestDigest,ballotSnapshotHash:f.expectedHash,adoptedLegacy:false});
 for(const kind of [PUBLISH_BALLOT,RECORD_DECISION]){const receipt=f.db.prepare('SELECT * FROM app_command_receipts WHERE operation_kind=?').get(kind);assert.equal(JSON.parse(receipt.input_json).audit.eventHash,audits(f.db).find(a=>a.change_key===receipt.request_key).event_hash);}
});

test('omitted or altered audit rolls back each governance command, including adoption without changing original decision',async t=>{
 for(const lane of ['publication','decision','adoption'])for(const fault of ['omit','actor','payload']){
  let active=false,injected=false;const f=await governanceOperatorFixture(t,{wrap:base=>({...base,async batch(statements){return base.batch(statements.flatMap(s=>{if(!active||!s.sql.startsWith('INSERT INTO ops_config_audit'))return [s];injected=true;if(fault==='omit')return [];const values=[...s.values];if(fault==='actor')values[7]='synthetic-wrong-operator';else values[9]=orderedJson({...JSON.parse(values[9]),requestDigest:'f'.repeat(64)});return [{...s,values}];}));}})});
  if(lane==='adoption')await legacy(f);else if(lane==='decision'){await f.publish();f.setNow(GOVERNANCE_OPEN+2*DAY);}
  const before=counts(f.db),original=canonicalJson(f.db.prepare('SELECT * FROM genesis_decisions').all());active=true;
  await assert.rejects(lane==='publication'?f.publish():f.decision(),/Missing exact governance .* audit/);assert.equal(injected,true);assert.deepEqual(counts(f.db),before);assert.equal(canonicalJson(f.db.prepare('SELECT * FROM genesis_decisions').all()),original);
  active=false;assert.equal((await(lane==='publication'?f.publish():f.decision())).kind,'committed');assert.equal(verifyConfigChain(f.db).events,before[5]+1);
 }
});

test('independent publications contend on one audit head and fresh retry cannot fork it',async t=>{
 const f=await governanceOperatorFixture(t);let captures=0,release;const barrier=new Promise(resolve=>{release=resolve;}),driver={...f.base,async batch(statements){const result=await f.base.batch(statements);if(statements.some(s=>s.sql==='SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1')&&captures<2){captures++;if(captures===2)release();await barrier;}return result;}},repo=createGovernanceOperatorRepository(driver,f.ports);
 const commands=await Promise.all(['one','two'].map(n=>command(f,PUBLISH_BALLOT,{...f.input,ballotId:'synthetic-'+n},n))),results=await Promise.all(commands.map(c=>repo.publishBallot(c)));
 assert.deepEqual(results.map(r=>r.kind).sort(),['committed','conflict']);const loser=results.findIndex(r=>r.kind==='conflict');assert.equal(results[loser].code,'revision_conflict');assert.equal((await repo.publishBallot(commands[loser])).kind,'committed');assert.equal(verifyConfigChain(f.db).events,sourceCount(f.db)+2);assert.equal(governanceAudits(f.db)[1].previous_hash,governanceAudits(f.db)[0].event_hash);
});

test('read-only previews bind explicit reviewed versions and accepted lost acknowledgement replays without a second event',async t=>{
 let lost=false;const f=await governanceOperatorFixture(t,{wrap:base=>({...base,async batch(statements){const result=await base.batch(statements);if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit')&&String(s.values[3]).startsWith('governance-'))){lost=true;throw Error('Synthetic lost acknowledgement');}return result;}})});
 const before=counts(f.db),c=await command(f,PUBLISH_BALLOT,f.input,'publish'),preview=await f.repository.previewBallot(c);assert.equal(preview.kind,'preview');assert.equal(preview.value.snapshotHash,f.expectedHash);assert.equal(preview.value.advisory,true);assert.equal(preview.value.financialExecution,false);assert.deepEqual(counts(f.db),before);
 const reviewed=await command(f,PUBLISH_BALLOT,f.input,'publish',preview.value.expectedRevisions);f.db.prepare("UPDATE app_operator_scopes SET revision=revision+1 WHERE scope='governance-publication'").run();assert.equal((await f.repository.publishBallot(reviewed)).code,'revision_conflict');assert.deepEqual(counts(f.db),before);
 assert.equal((await f.publish()).kind,'replayed');assert.equal(lost,true);assert.equal(verifyConfigChain(f.db).events,sourceCount(f.db)+1);
 f.setNow(GOVERNANCE_OPEN+2*DAY);const dc=await command(f,RECORD_DECISION,decisionInput(f),'decision'),dbefore=counts(f.db),dp=await f.repository.previewDecision(dc);assert.equal(dp.kind,'preview');assert.equal(dp.value.earliestMs,GOVERNANCE_OPEN+6*DAY);assert.equal(dp.value.ballotSnapshotHash,f.expectedHash);assert.deepEqual(counts(f.db),dbefore);
 f.db.prepare("UPDATE app_operator_scopes SET revision=revision+1 WHERE scope='governance-decision'").run();assert.equal((await f.repository.recordDecision(await command(f,RECORD_DECISION,decisionInput(f),'decision',dp.value.expectedRevisions))).code,'revision_conflict');
 lost=false;const accepted=await f.decision();assert.equal(accepted.kind,'replayed');const snapshot=canonicalJson(audits(f.db));f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();assert.equal((await f.decision()).kind,'replayed');assert.equal(canonicalJson(audits(f.db)),snapshot);assert.equal(verifyConfigChain(f.db).events,sourceCount(f.db)+2);
});

test('legacy decision adoption records current audit time and preserves historical row and command identity',async t=>{
 const f=await governanceOperatorFixture(t);await legacy(f);const original=canonicalJson(f.db.prepare('SELECT * FROM genesis_decisions').all()),c=await command(f,RECORD_DECISION,decisionInput(f),'decision'),accepted=await f.repository.recordDecision(c);assert.equal(accepted.kind,'committed');assert.equal(canonicalJson(f.db.prepare('SELECT * FROM genesis_decisions').all()),original);
 const row=governanceAudits(f.db)[0];assert.equal(row.category,'governance-decision-adoption');assert.equal(row.recorded_ms,GOVERNANCE_OPEN+3*DAY);assert.equal(JSON.parse(row.payload).decidedMs,GOVERNANCE_OPEN+2*DAY);await checkHash(f,row,{...accepted.value,requestDigest:c.requestDigest,ballotSnapshotHash:f.expectedHash,adoptedLegacy:true});assert.equal((await f.decision()).kind,'replayed');assert.equal(audits(f.db).length,sourceCount(f.db)+1);
});

test('pre058 decision receipt replays with no retroactive audit or altered result',async t=>{
 const f=await governanceOperatorFixture(t);await legacy(f);const c=await command(f,RECORD_DECISION,decisionInput(f),'old-decision'),d=f.db.prepare('SELECT ballot_id AS ballotId,choice,decided_ms AS decidedMs,notice_ms AS noticeMs,earliest_ms AS earliestMs,rationale FROM genesis_decisions').get();
 // Synthetic upgrade fixture: disable only the additive audit guard while the
 // existing decision mandatory effects validate the genuine historical row.
 f.db.exec('DROP TRIGGER app_governance_decision_audit_mandatory');
 const old=await createAtomicReceipts(f.base,f.ports).execute(c,{businessKey:c.businessIdentity,input:{...c.input,earliestMs:d.earliestMs,ballotSnapshotHash:f.expectedHash,adoptedLegacy:true},result:d,resultRef:d.ballotId,version:revisions(f.db.prepare('SELECT * FROM app_revisions ORDER BY name').all()),child:(gate,v)=>sql(`SELECT 1 WHERE ${gate}`,...v)});assert.equal(old.kind,'committed');
 const ddl=readFileSync(new URL('../storage/058-governance-audit.sql',import.meta.url),'utf8');f.db.exec(ddl.slice(ddl.indexOf('CREATE TRIGGER app_governance_decision_audit_mandatory')));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='app_governance_decision_audit_mandatory'").get().n,1);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();const replay=await f.repository.recordDecision({...c,nowMs:f.getNow()+DAY});assert.equal(replay.kind,'replayed');assert.deepEqual(replay.receipt,old.receipt);assert.deepEqual(replay.value,old.value);assert.equal(audits(f.db).length,sourceCount(f.db));
});
