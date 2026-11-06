import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freeCutFixture,CUT_OPERATOR} from './free-cut-test-fixture.mjs';
import {createCollectionCutService,buildCollectionCutCommand,STAGE_COLLECTION_CUT_RECORD as STAGE,BEGIN_COLLECTION_FREE_CUT as BEGIN,VALIDATE_COLLECTION_CUT_PAGE as PAGE,SEAL_COLLECTION_FREE_CUT as SEAL} from './free-cut-service.mjs';
import {createCollectionCutRepository} from './free-cut-repository.mjs';
import {prepareCollectionCutRecord} from './free-cut-codec.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
const auditRows=db=>db.prepare('SELECT * FROM ops_config_audit ORDER BY seq').all();
const snapshot=db=>canonicalJson(Object.fromEntries(['app_collection_cut_records','app_collection_cut_attempts','app_collection_cut_pages','app_collection_free_cuts','app_command_receipts','ops_config_audit','app_revisions'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
async function prepared(t,kind,wrap=base=>base){
 const f=await freeCutFixture(t),repository=createCollectionCutRepository(wrap(f.base),f.ports),service=createCollectionCutService({...f.ports,repository});let input,record;
 if(kind===STAGE){record=f.bundle.root;input={id:record.id};}else{await f.stage();if(kind===BEGIN)input={rootId:f.bundle.root.id};else{const b=await f.begin();input={attemptId:b.value.attemptId,...(kind===PAGE?{pageIndex:0}:{})};if(kind===SEAL)await f.page(input.attemptId);}}
 const request={requestKey:'synthetic-audit-'+kind,...input},command=await buildCollectionCutCommand(kind,CUT_OPERATOR,request,f.ports.crypto);
 const call=()=>kind===STAGE?service.stageRecord(CUT_OPERATOR,{requestKey:request.requestKey,record}):kind===BEGIN?service.beginCut(CUT_OPERATOR,request):kind===PAGE?service.validatePage(CUT_OPERATOR,request):service.sealCut(CUT_OPERATOR,request);
 return {...f,repository,command,record,call};
}

test('all four fixed-cut commands atomically retain the original ordered config audit preimage',async t=>{
 for(const kind of [STAGE,BEGIN,PAGE,SEAL]){
  const f=await prepared(t,kind),before=auditRows(f.db).length,accepted=await f.call();assert.equal(accepted.kind,'committed');const row=auditRows(f.db).at(-1),receipt=f.db.prepare('SELECT * FROM app_command_receipts WHERE operation_id=?').get(accepted.receipt.operationId),payload={operationKind:kind,requestDigest:f.command.requestDigest,resultRef:receipt.result_ref,resultDigest:receipt.output_digest};
  assert.equal(row.category,'collection-free-cut');assert.equal(row.entity,f.command.businessIdentity);assert.equal(row.change_key,f.command.requestKey);assert.equal(row.recorded_ms,f.cutMs);assert.equal(row.actor,CUT_OPERATOR.id);assert.equal(row.evidence_ref,f.command.input.id??f.command.input.rootId??f.command.input.attemptId);assert.equal(row.payload,orderedJson(payload));
  assert.equal(payload.resultDigest,await f.ports.crypto.sha256(utf8(canonicalJson(accepted.value))));assert.equal(row.event_hash,await f.ports.crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',row.seq,row.previous_hash,row.category,row.entity,row.change_key,row.recorded_ms,row.actor,row.evidence_ref,payload]))));assert.equal(JSON.parse(receipt.input_json).audit.eventHash,row.event_hash);assert.equal(verifyConfigChain(f.db).events,before+1);
 }
});

test('omitted or altered audit aborts every fixed-cut child and receipt without changing source revision',async t=>{
 for(const kind of [STAGE,BEGIN,PAGE,SEAL])for(const fault of ['omit','actor','payload']){
  let injected=false;const f=await prepared(t,kind,base=>({...base,async batch(statements){return base.batch(statements.flatMap(s=>{if(!s.sql.startsWith('INSERT INTO ops_config_audit'))return [s];injected=true;if(fault==='omit')return [];const values=[...s.values];if(fault==='actor')values[7]='synthetic-other-operator';else values[9]=orderedJson({...JSON.parse(values[9]),resultDigest:'f'.repeat(64)});return [{...s,values}];}));}})),before=snapshot(f.db);
  await assert.rejects(f.call(),/Missing exact collection cut audit/);assert.equal(injected,true);assert.equal(snapshot(f.db),before);
  const clean=createCollectionCutRepository(f.base,f.ports),result=kind===STAGE?await clean.stageRecord(f.command,f.record):kind===BEGIN?await clean.beginCut(f.command):kind===PAGE?await clean.validatePage(f.command):await clean.sealCut(f.command);assert.equal(result.kind,'committed');verifyConfigChain(f.db);
 }
});

test('independent record commands contend on the audit head and retry produces one continuous chain',async t=>{
 const f=await freeCutFixture(t);let captures=0,release;const gate=new Promise(resolve=>{release=resolve;}),driver={...f.base,async batch(statements){const result=await f.base.batch(statements);if(captures<2&&statements.some(s=>s.sql==='SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1')){captures++;if(captures===2)release();await gate;}return result;}},service=createCollectionCutService({...f.ports,repository:createCollectionCutRepository(driver,f.ports)}),records=[f.bundle.pages[0],f.bundle.root],before=auditRows(f.db).length;
 const run=record=>service.stageRecord(CUT_OPERATOR,{requestKey:record.id,record}),results=await Promise.all(records.map(run));assert.deepEqual(results.map(r=>r.kind).sort(),['committed','conflict']);const loser=results.findIndex(r=>r.kind==='conflict');assert.equal(results[loser].code,'revision_conflict');assert.equal((await run(records[loser])).kind,'committed');assert.equal(verifyConfigChain(f.db).events,before+2);const rows=auditRows(f.db);assert.equal(rows.at(-1).previous_hash,rows.at(-2).event_hash);
});

test('lost responses and revoked-scope replay retain exact original audits for all fixed-cut kinds',async t=>{
 for(const kind of [STAGE,BEGIN,PAGE,SEAL]){
  let injected=false;const f=await prepared(t,kind,base=>({...base,async batch(statements){const result=await base.batch(statements);if(!injected&&statements.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit'))){injected=true;throw Error('Synthetic cut lost acknowledgement');}return result;}})),first=await f.call();assert.equal(first.kind,'replayed');assert.equal(injected,true);f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(CUT_OPERATOR.id);f.setNow(f.cutMs+86400000);const before=snapshot(f.db),replay=await f.call();assert.deepEqual(replay,first);assert.equal(snapshot(f.db),before);verifyConfigChain(f.db);
 }
});

test('preview is read-only, derives immutable opening context, and reviewed revisions fence each command',async t=>{
 for(const kind of [STAGE,BEGIN,PAGE,SEAL]){
  const f=await prepared(t,kind),before=snapshot(f.db),preview=await f.repository.previewCommand(f.command,f.record);assert.equal(preview.kind,'preview');assert.equal(snapshot(f.db),before);assert.equal(preview.value.financialExecution,false);
  if(kind===STAGE)assert.equal(preview.value.context,null);else assert.deepEqual(preview.value.context,{inventoryId:f.inventoryId,stageId:f.stageId,cutMs:f.cutMs,termsDigest:f.publication.value.termsDigest,eligibilityListId:f.groups[0].manifest.id,pageCount:f.bundle.pages.length});
  const reviewed=await buildCollectionCutCommand(kind,CUT_OPERATOR,{requestKey:f.command.requestKey,...f.command.input,expectedRevisions:preview.value.expectedRevisions},f.ports.crypto);assert.equal(reviewed.requestDigest,f.command.requestDigest);
  f.db.prepare('UPDATE app_operator_scopes SET revision=revision+1 WHERE operator=?').run(CUT_OPERATOR.id);const after=snapshot(f.db),result=kind===STAGE?await f.repository.stageRecord(reviewed,f.record):kind===BEGIN?await f.repository.beginCut(reviewed):kind===PAGE?await f.repository.validatePage(reviewed):await f.repository.sealCut(reviewed);assert.equal(result.code,'revision_conflict');assert.equal(snapshot(f.db),after);
 }
});

test('pre059 record receipt replays without adding an audit or changing the historical result',async t=>{
 const f=await prepared(t,STAGE),c=f.command,verified=await prepareCollectionCutRecord(f.record,f.ports.crypto),result={id:verified.id,format:verified.format,size:verified.size,source:'local-fixture',executable:false},before=auditRows(f.db).length;
 // Synthetic upgrade fixture: retain every original mandatory child guard,
 // disabling only the additive059 audit guard for this old-form receipt.
 f.db.exec('DROP TRIGGER app_collection_cut_audit_mandatory');
 const old=await createAtomicReceipts(f.base,f.ports).execute({...c,nowMs:f.cutMs},{businessKey:c.businessIdentity,input:c.input,result,resultRef:verified.id,version:revisions(f.db.prepare('SELECT * FROM app_revisions').all()),child:(gate,p)=>sql(`INSERT INTO app_collection_cut_records(id,format,size,body_json,operation_id) SELECT ?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,verified.id,verified.format,verified.size,verified.bodyJson,...p,...p)});assert.equal(old.kind,'committed');f.db.exec(readFileSync(new URL('../storage/059-free-cut-audit.sql',import.meta.url),'utf8'));
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='app_collection_cut_audit_mandatory'").get().n,1);f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(CUT_OPERATOR.id);f.setNow(f.cutMs+86400000);const snap=snapshot(f.db),replay=await f.call();assert.equal(replay.kind,'replayed');assert.deepEqual(replay.receipt,old.receipt);assert.deepEqual(replay.value,old.value);assert.equal(snapshot(f.db),snap);assert.equal(auditRows(f.db).length,before);
});
