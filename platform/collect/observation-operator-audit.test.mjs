import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
import {dispatchCollectionObservation,observationInput,OBSERVATION_TEST_OPERATOR as principal} from './observation-test-harness.mjs';
import {buildCollectionObservationCommand} from './observation-service.mjs';
import {createCollectionObservationRepository} from './observation-repository.mjs';
const snapshot=db=>canonicalJson(Object.fromEntries(['collect_assets','vault_assets','collect_observations','vault_observations','app_collection_observation_bindings','app_collection_operation_conflicts','app_command_receipts','ops_config_audit','app_revisions'].map(n=>[n,db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()])));
async function fixture(t,{kind='transfer',wrap=b=>b}={}){
 const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),crypto=createNodeCrypto(),store=memoryArtifacts();let now=f.nowMs+10000,sequence=0;db.function('synthetic_observation_audit_clock',()=>now);
 const base={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_observation_audit_clock()'},ports={crypto,artifacts:store,ids:{next:randomUUID},clock:{nowMs:()=>now}};
 for(const scope of ['evidence-ingest','collection-evidence'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,scope);
 async function command(level=1,eventKind=kind){const assetId=f.ids(level,eventKind==='reveal'?'material':'target');if(eventKind==='reveal')db.prepare('UPDATE collect_assets SET reveal_ms=NULL WHERE id=?').run(assetId);
  const event={id:'synthetic-event-'+(++sequence),kind:eventKind,observedMs:f.nowMs,from:eventKind==='transfer'?f.wallet:null,to:eventKind==='transfer'?f.other:null},e=await dispatchCollectionObservation({driver:base,crypto,store,request:{method:'evidence',inventoryId:f.inventoryId,assetId,events:[event],recordId:event.id,nowMs:now,idPrefix:'synthetic-observation-evidence-'+sequence}});assert.equal(e.result.kind,'committed',JSON.stringify(e));assert.equal(e.result.value.decision.status,'verified');const input=observationInput(e.result.value,{requestKey:'synthetic-observe-'+sequence,expectedAssetVersion:0});return buildCollectionObservationCommand(principal,input,crypto);
 }
 const c=await command(),repository=createCollectionObservationRepository(wrap(base,db,()=>now,v=>{now=v;}),ports);return {db,f,base,ports,store,c,repository,command,setNow:v=>{now=v;}};
}

test('observation preview independently verifies evidence without writes and audit preserves the historical digest',async t=>{
 for(const kind of ['transfer','reveal']){const f=await fixture(t,{kind}),before=snapshot(f.db),p=await f.repository.previewObservation(f.c);assert.equal(p.kind,'preview',JSON.stringify(p));assert.equal(p.value.financialExecution,false);assert.equal(snapshot(f.db),before);
  const reviewed=await buildCollectionObservationCommand(principal,{requestKey:f.c.requestKey,...f.c.input,expectedRevisions:p.value.expectedRevisions},f.ports.crypto);assert.equal(reviewed.requestDigest,f.c.requestDigest);const accepted=await f.repository.observe(reviewed);assert.equal(accepted.kind,'committed',JSON.stringify(accepted));const {expectedRevisions,financialExecution,...value}=p.value;assert.deepEqual(accepted.value,value);
  const row=f.db.prepare('SELECT * FROM ops_config_audit ORDER BY seq DESC LIMIT 1').get(),r=f.db.prepare('SELECT * FROM app_command_receipts WHERE operation_id=?').get(accepted.receipt.operationId),payload={operationKind:f.c.operationKind,requestDigest:f.c.requestDigest,resultRef:'evidence:'+f.c.input.evidenceReceiptId,resultDigest:await f.ports.crypto.sha256(utf8(canonicalJson(accepted.value)))};
  assert.equal(row.category,'collection-observation');assert.equal(row.entity,f.c.input.assetId);assert.equal(row.change_key,payload.resultRef);assert.equal(row.actor,principal.id);assert.equal(row.evidence_ref,f.c.input.evidenceReceiptId);assert.equal(row.recorded_ms,f.f.nowMs+10000);assert.equal(row.payload,orderedJson(payload));assert.equal(r.request_digest,f.c.requestDigest);assert.equal(JSON.parse(r.input_json).audit.eventHash,row.event_hash);
  assert.equal(row.event_hash,await f.ports.crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',row.seq,row.previous_hash,row.category,row.entity,row.change_key,row.recorded_ms,row.actor,row.evidence_ref,payload]))));assert.equal(verifyConfigChain(f.db).events,1);
 }
});

test('missing artifacts, revoked scope and stale reviewed observations never produce preview effects',async t=>{
 const f=await fixture(t),p=await f.repository.previewObservation(f.c),reviewed=await buildCollectionObservationCommand(principal,{requestKey:f.c.requestKey,...f.c.input,expectedRevisions:p.value.expectedRevisions},f.ports.crypto);f.db.prepare('UPDATE app_operator_scopes SET revision=revision+1 WHERE operator=?').run(principal.id);let before=snapshot(f.db);assert.equal((await f.repository.previewObservation(reviewed)).code,'revision_conflict');assert.equal((await f.repository.observe(reviewed)).code,'revision_conflict');assert.equal(snapshot(f.db),before);
 f.store.objects.clear();before=snapshot(f.db);assert.equal((await f.repository.previewObservation(f.c)).reason,'observation-artifact-missing');assert.equal(snapshot(f.db),before);f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-evidence'").run(principal.id);before=snapshot(f.db);assert.equal((await f.repository.previewObservation(f.c)).code,'operator_scope_required');assert.equal(snapshot(f.db),before);
});

test('missing or altered audit rolls back both transfer and reveal effects and receipt',async t=>{
 for(const kind of ['transfer','reveal'])for(const fault of ['omit','actor','payload']){let injected=false;const f=await fixture(t,{kind,wrap:base=>({...base,async batch(ss){return base.batch(ss.flatMap(s=>{if(!s.sql.startsWith('INSERT INTO ops_config_audit'))return [s];injected=true;if(fault==='omit')return [];const values=[...s.values];if(fault==='actor')values[7]='synthetic-wrong-actor';else values[9]=orderedJson({...JSON.parse(values[9]),resultDigest:'0'.repeat(64)});return [{...s,values}];}));}})}),before=snapshot(f.db);await assert.rejects(f.repository.observe(f.c),/Missing exact collection observation audit/);assert.equal(injected,true);assert.equal(snapshot(f.db),before);const accepted=await createCollectionObservationRepository(f.base,f.ports).observe(f.c);assert.equal(accepted.kind,'committed');verifyConfigChain(f.db);}
});

test('independent observations contend on shared audit head and retry cannot fork',async t=>{
 const f=await fixture(t),second=await f.command(2);let captures=0,release;const gate=new Promise(r=>{release=r;}),driver={...f.base,async batch(ss){const rows=await f.base.batch(ss);if(captures<2&&ss.some(s=>s.sql==='SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1')){captures++;if(captures===2)release();await gate;}return rows;}},repository=createCollectionObservationRepository(driver,f.ports),commands=[f.c,second],results=await Promise.all(commands.map(c=>repository.observe(c)));assert.deepEqual(results.map(r=>r.kind).sort(),['committed','conflict']);assert.equal((await repository.observe(commands[results.findIndex(r=>r.kind==='conflict')])).kind,'committed');assert.equal(verifyConfigChain(f.db).events,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_observation_bindings').get().n,2);
});

test('lost observation acknowledgement replays without audit duplication after scope revocation and artifact loss',async t=>{
 let lost=false;const f=await fixture(t,{wrap:base=>({...base,async batch(ss){const rows=await base.batch(ss);if(!lost&&ss.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit'))){lost=true;throw Error('Synthetic lost committed observation acknowledgement');}return rows;}})}),accepted=await f.repository.observe(f.c);assert.equal(accepted.kind,'replayed');f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);f.store.objects.clear();f.setNow(f.f.nowMs+86400000);const before=snapshot(f.db),replay=await f.repository.observe(f.c);assert.deepEqual(replay,accepted);assert.equal(snapshot(f.db),before);assert.equal(verifyConfigChain(f.db).events,1);
});

test('historical plain accepted observation receipt replays with no audit backfill',async t=>{
 const f=await fixture(t);f.db.exec('DROP TRIGGER app_collection_observation_audit_mandatory');
 // Disposable upgrade fixture: emulate only the old plain receipt envelope
 // and lack of additive audit; every original041 effect assertion remains.
 const driver={...f.base,async batch(ss){return f.base.batch(ss.filter(s=>!s.sql.startsWith('INSERT INTO ops_config_audit')).map(s=>{if(!s.sql.startsWith('INSERT INTO app_command_receipts'))return s;const values=[...s.values],{audit,...input}=JSON.parse(values[8]);values[8]=canonicalJson(input);return {...s,values};}));}},old=await createCollectionObservationRepository(driver,f.ports).observe(f.c);assert.equal(old.kind,'committed');f.db.exec(readFileSync(new URL('../storage/062-collection-observation-audit.sql',import.meta.url),'utf8'));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='app_collection_observation_audit_mandatory'").get().n,1);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();f.store.objects.clear();const before=snapshot(f.db),replay=await f.repository.observe(f.c);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,old.value);assert.deepEqual(replay.receipt,old.receipt);assert.equal(snapshot(f.db),before);assert.equal(verifyConfigChain(f.db).events,0);
});

test('stalled observation clock is rejected atomically and actual execution time bounds remain unchanged',async t=>{
 let stalled=false;const metrics=[],f=await fixture(t,{wrap:(base,db,now,setNow)=>({...base,async batch(ss){metrics.push(measureBatch(ss));if(!stalled&&ss.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit'))){stalled=true;setNow(now()+30001);}return base.batch(ss);}})}),before=snapshot(f.db);assert.equal((await f.repository.observe(f.c)).code,'revision_conflict');assert.equal(stalled,true);assert.equal(snapshot(f.db),before);assert.equal((await f.repository.observe(f.c)).kind,'committed');assert.ok(Math.max(...metrics.map(m=>m.batchBytes))<=262144);assert.ok(Math.max(...metrics.map(m=>m.maxParameters))<=100);t.diagnostic(JSON.stringify({maxBatchBytes:Math.max(...metrics.map(m=>m.batchBytes)),maxStatements:Math.max(...metrics.map(m=>m.statements)),maxParameters:Math.max(...metrics.map(m=>m.maxParameters))}));
});
