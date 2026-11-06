import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {measureBatch,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
import {configureAction,listActiveActions} from './components.mjs';
import {CONFIGURE_ACTION,buildActionPolicyCommand} from './action-policy-service.mjs';
import {createActionPolicyRepository} from './action-policy-repository.mjs';
const DAY=86400000,START=20001*DAY+123,PRINCIPAL={kind:'operator',id:'synthetic-action-policy-operator'};
function fixture(t,{wrap=base=>base,cryptoPort=createNodeCrypto(),sqlClock=true}={}){
 const db=openDatabase();t.after(()=>db.close());let now=START;db.function('synthetic_action_policy_clock',()=>now);db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(PRINCIPAL.id,'earn-action-policy');const measures=[],base={...createNodeAtomicDriver(db),...(sqlClock?{leaseNowSql:'synthetic_action_policy_clock()'}:{})},driver=wrap({...base,async batch(statements){measures.push(measureBatch(statements));return base.batch(statements);}},db,value=>now=value),ports={crypto:cryptoPort,ids:{next:randomUUID},clock:{nowMs:()=>now}},repository=createActionPolicyRepository(driver,ports);
 const input={actionId:'synthetic-follow',label:'Synthetic project follow',verifier:'synthetic-follow-verifier',effectiveEpoch:20002,enabled:true,evidenceRef:'synthetic:action-policy'};
 const command=(changes={},requestKey='synthetic-configure',options={})=>buildActionPolicyCommand({principal:PRINCIPAL,requestKey,input:{...input,...changes},nowMs:now,expectedRevisions:revisions(db.prepare('SELECT * FROM app_revisions').all()),...options},cryptoPort);
 return {db,base,driver,ports,repository,input,command,measures,setNow:value=>now=value,getNow:()=>now};
}
const snapshot=db=>canonicalJson(Object.fromEntries(['earn_action_catalog','earn_action_changes','ops_config_audit','app_command_receipts','app_revisions'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
const auditRows=db=>db.prepare('SELECT * FROM ops_config_audit ORDER BY seq').all();

test('future action policy preview and commit preserve legacy definition, ordered audit and future rotation',async t=>{
 const f=fixture(t),c=await f.command(),before=snapshot(f.db),preview=await f.repository.previewAction(c);assert.equal(preview.kind,'preview');assert.deepEqual(preview.value,{actionId:f.input.actionId,effectiveEpoch:20002,enabled:true,source:'local-fixture',executable:false,label:f.input.label,verifier:f.input.verifier,expectedRevisions:c.expectedRevisions,financialExecution:false});assert.equal(snapshot(f.db),before);
 f.setNow(START+500);const accepted=await f.repository.configureAction(c);assert.equal(accepted.kind,'committed');assert.deepEqual(accepted.value,{actionId:f.input.actionId,effectiveEpoch:20002,enabled:true,source:'local-fixture',executable:false});assert.equal(f.db.prepare('SELECT recorded_ms FROM earn_action_changes').get().recorded_ms,START+500);
 assert.deepEqual(listActiveActions(f.db,20001),[]);assert.equal(listActiveActions(f.db,20002).length,1);
 const row=auditRows(f.db)[0],payload={label:f.input.label,verifier:f.input.verifier,enabled:true,effectiveEpoch:20002};assert.equal(row.payload,orderedJson(payload));assert.equal(row.category,'action-policy');assert.equal(row.entity,f.input.actionId);assert.equal(row.change_key,'20002');assert.equal(row.actor,PRINCIPAL.id);assert.equal(row.evidence_ref,f.input.evidenceRef);assert.equal(row.recorded_ms,START+500);assert.equal(row.event_hash,await f.ports.crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',1,null,'action-policy',f.input.actionId,'20002',START+500,PRINCIPAL.id,f.input.evidenceRef,payload]))));assert.equal(verifyConfigChain(f.db).events,1);
 const stored=f.db.prepare('SELECT * FROM app_command_receipts WHERE operation_kind=?').get(CONFIGURE_ACTION);assert.equal(stored.result_ref,c.businessIdentity);assert.equal(stored.created_ms,START+500);assert.equal(stored.request_digest,c.requestDigest);assert.equal(JSON.parse(stored.input_json).audit.eventHash,row.event_hash);
 const disable=await f.repository.configureAction(await f.command({effectiveEpoch:20003,enabled:false},'synthetic-disable'));assert.equal(disable.kind,'committed');assert.equal(listActiveActions(f.db,20002).length,1);assert.equal(listActiveActions(f.db,20003).length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_action_catalog').get().n,1);assert.equal(verifyConfigChain(f.db).events,2);
 assert.throws(()=>f.db.prepare('UPDATE earn_action_catalog SET label=?').run('changed'),/immutable/);assert.throws(()=>f.db.prepare('DELETE FROM earn_action_catalog').run(),/immutable/);assert.throws(()=>f.db.prepare('UPDATE earn_action_changes SET enabled=0').run(),/immutable/);assert.throws(()=>f.db.prepare('DELETE FROM earn_action_changes').run(),/immutable/);
 assert.ok(f.measures.every(m=>m.batchBytes<=262144&&m.maxParameters<=100));t.diagnostic(JSON.stringify({maxStatements:Math.max(...f.measures.map(m=>m.statements)),maxBatchBytes:Math.max(...f.measures.map(m=>m.batchBytes)),maxParameters:Math.max(...f.measures.map(m=>m.maxParameters))}));
});

test('omitted or altered policy/audit children roll back catalog, policy, receipt and revision changes',async t=>{
 for(const fault of ['omit-catalog','omit-policy','omit-audit','alter-policy','alter-audit']){
  let injected=false;const f=fixture(t,{wrap:base=>({...base,async batch(statements){const selected=statements.flatMap(s=>{const target=fault.endsWith('catalog')?'earn_action_catalog':fault.endsWith('policy')?'earn_action_changes':'ops_config_audit';if(!s.sql.startsWith('INSERT INTO '+target))return [s];injected=true;if(fault.startsWith('omit'))return [];const values=[...s.values];if(fault==='alter-policy')values[2]=0;else values[7]='synthetic-wrong-operator';return [{...s,values}];});return base.batch(selected);}})}),before=snapshot(f.db),c=await f.command();
  await assert.rejects(f.repository.configureAction(c),/Missing exact action policy|FOREIGN KEY constraint failed/);assert.equal(injected,true);assert.equal(snapshot(f.db),before);assert.equal((await createActionPolicyRepository(f.base,f.ports).configureAction(c)).kind,'committed');
 }
});

test('accepted lost acknowledgement replays exactly after revocation and effective epoch while changed body conflicts',async t=>{
 let lost=false;const f=fixture(t,{wrap:base=>({...base,async batch(statements){const result=await base.batch(statements);if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO earn_action_changes'))){lost=true;throw Error('Synthetic action-policy lost acknowledgement');}return result;}})}),c=await f.command(),first=await f.repository.configureAction(c);assert.equal(first.kind,'replayed');assert.equal(lost,true);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1').run();f.setNow(20004*DAY);const before=snapshot(f.db),replay=await f.repository.configureAction({...c,nowMs:f.getNow()});assert.deepEqual(replay,first);assert.equal(snapshot(f.db),before);assert.equal(verifyConfigChain(f.db).events,1);
 assert.equal((await f.repository.configureAction(await f.command({enabled:false}))).code,'idempotency_conflict');assert.equal(snapshot(f.db),before);assert.equal((await f.repository.configureAction(await f.command({actionId:'synthetic-fresh',effectiveEpoch:20005},'fresh'))).code,'operator_scope_required');
});

test('definition and scheduled policy are immutable and unreceipted legacy rows never gain invented adoption receipts',async t=>{
 const f=fixture(t);configureAction(f.db,{...f.input,atMs:START,actor:PRINCIPAL.id});const before=snapshot(f.db);
 assert.equal((await f.repository.configureAction(await f.command())).code,'action_policy_already_exists');assert.equal((await f.repository.configureAction(await f.command({enabled:false}))).code,'policy_conflict');assert.equal(snapshot(f.db),before);
 for(const change of [{label:'Changed label',effectiveEpoch:20003},{verifier:'Changed verifier',effectiveEpoch:20003}])assert.equal((await f.repository.configureAction(await f.command(change))).code,'action_conflict');
 assert.equal((await f.repository.configureAction(await f.command({effectiveEpoch:20003,enabled:false}))).kind,'committed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,1);
 const future=fixture(t);future.db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(20003,'[]',20004*DAY,'f'.repeat(64),'synthetic-finalized-board');assert.equal((await future.repository.configureAction(await future.command())).code,'board_closed');assert.equal(future.db.prepare('SELECT COUNT(*) n FROM earn_action_catalog').get().n,0);
});

test('current clock, stale preview and SQL commit fence reject backdated/current policy and midnight or stale preparation',async t=>{
 const f=fixture(t);for(const effectiveEpoch of [20000,20001])assert.equal((await f.repository.configureAction(await f.command({effectiveEpoch}))).code,'action_not_future');
 const c=await f.command(),preview=await f.repository.previewAction(c);assert.equal(preview.kind,'preview');f.db.prepare('UPDATE app_operator_scopes SET revision=revision+1').run();assert.equal((await f.repository.configureAction(c)).code,'revision_conflict');
 const captured=await f.command();f.setNow(20002*DAY);assert.equal((await f.repository.configureAction(captured)).code,'action_not_future');
 for(const lane of ['midnight','expired','backwards','revoke','finalized']){
  let injected=false;const g=fixture(t,{wrap:(base,db,setNow)=>({...base,async batch(statements){if(!injected&&statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'))){injected=true;if(lane==='midnight')setNow(20002*DAY);if(lane==='expired')setNow(START+30001);if(lane==='backwards')setNow(START-1);if(lane==='revoke')db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1').run();if(lane==='finalized')db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(20002,'[]',20003*DAY,'a'.repeat(64),'synthetic-racing-board');}return base.batch(statements);}})});
  if(lane==='midnight')g.setNow(20002*DAY-1);const result=await g.repository.configureAction(await g.command());assert.equal(result.code,'revision_conflict',lane);assert.equal(injected,true);for(const table of ['earn_action_catalog','earn_action_changes','ops_config_audit','app_command_receipts'])assert.equal(g.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,lane+table);
 }
 const invalid=fixture(t);invalid.setNow(NaN);assert.equal((await invalid.repository.configureAction(await buildActionPolicyCommand({principal:PRINCIPAL,requestKey:'invalid-clock',input:invalid.input,nowMs:START,expectedRevisions:revisions(invalid.db.prepare('SELECT * FROM app_revisions').all())},invalid.ports.crypto))).reason,'action-policy-clock-unavailable');
});

test('independent concurrent policy commands retry with fresh reviewed revisions and cannot fork audit head',async t=>{
 let captures=0,release;const barrier=new Promise(resolve=>{release=resolve;}),f=fixture(t,{wrap:base=>({...base,async batch(statements){const result=await base.batch(statements);if(captures<2&&statements.some(s=>s.sql==='SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1')){captures++;if(captures===2)release();await barrier;}return result;}})});
 const commands=await Promise.all(['one','two'].map(actionId=>f.command({actionId:'synthetic-'+actionId},actionId))),results=await Promise.all(commands.map(c=>f.repository.configureAction(c)));assert.deepEqual(results.map(r=>r.kind).sort(),['committed','conflict']);const loser=results.findIndex(r=>r.kind==='conflict');assert.equal(results[loser].code,'revision_conflict');const retry=await f.command(commands[loser].input,commands[loser].requestKey);assert.equal(retry.requestDigest,commands[loser].requestDigest);assert.equal((await f.repository.configureAction(retry)).kind,'committed');assert.equal(verifyConfigChain(f.db).events,2);assert.equal(auditRows(f.db)[1].previous_hash,auditRows(f.db)[0].event_hash);
});

test('repository reconstructs immutable command before async hashing and rejects forged fields',async t=>{
 let release,started,armed=false;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;}),base=createNodeCrypto(),cryptoPort={...base,async sha256(bytes){if(armed){started();await gate;}return base.sha256(bytes);}},f=fixture(t,{cryptoPort}),c=await f.command(),original=structuredClone(c);
 armed=true;const mutable=structuredClone(c),pending=f.repository.configureAction(mutable);await entered;mutable.input.label='Changed during hash';mutable.expectedRevisions.source='99';mutable.principal.id='changed';release();const accepted=await pending;assert.equal(accepted.kind,'committed');assert.equal(f.db.prepare('SELECT label FROM earn_action_catalog').get().label,original.input.label);
 for(const patch of [{requestDigest:'f'.repeat(64)},{businessIdentity:'different'},{operationKind:'ops.change-scope.v1'},{extra:true}])await assert.rejects(f.repository.configureAction({...original,...patch}),/Invalid action-policy command/);
});

test('default production millisecond SQL clock accepts a non-whole-second fresh future policy',async t=>{
 const f=fixture(t,{sqlClock:false});let now;do{now=Date.now();}while(now%1000===0);f.setNow(now);const c=await f.command({effectiveEpoch:Math.floor(now/DAY)+1});assert.notEqual(c.nowMs%1000,0);const result=await f.repository.configureAction(c);assert.equal(result.kind,'committed',JSON.stringify(result));assert.equal(f.db.prepare('SELECT recorded_ms FROM earn_action_changes').get().recorded_ms,now);
});
