import test from 'node:test';
import assert from 'node:assert/strict';
import {freeCutFixture,CUT_OPERATOR} from './free-cut-test-fixture.mjs';
import {createCollectionCutService} from './free-cut-service.mjs';
import {createCollectionCutRepository} from './free-cut-repository.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {prepareFreeCutCapacity} from './free-cut-capacity-fixture.mjs';
const count=(f,table)=>f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n;

test('private normalized fixed cut retains actual known Genesis closure and one immutable eligibility binding',async t=>{
 const f=await freeCutFixture(t),source=()=>f.db.prepare("SELECT revision FROM app_revisions WHERE name='source'").get().revision,before=source();await f.stage();assert.equal(source(),before);
 const begin=await f.begin();assert.equal(begin.kind,'committed',JSON.stringify(begin));assert.equal(source(),before);const id=begin.value.attemptId;
 assert.equal((await f.seal(id)).reason,'cut-page-closure');const p=await f.page(id);assert.equal(p.kind,'committed',JSON.stringify(p));assert.equal(p.value.trackedCount,2);assert.equal(source(),before);
 const accepted=await f.seal(id);assert.equal(accepted.kind,'committed',JSON.stringify(accepted));assert.equal(source(),before+1);assert.equal(accepted.value.eligibleWallets,2);assert.equal(accepted.value.atMs,f.cutMs);assert.equal(accepted.value.commitmentKind,'paged-fixed-cut-v1');assert.equal(count(f,'collect_snapshots'),0);assert.equal(count(f,'tx_intents'),0);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(CUT_OPERATOR.id);f.setNow(f.cutMs+10*86400000);const replay=await f.seal(id);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,accepted.value);assert.deepEqual(replay.receipt,accepted.receipt);
 for(const table of ['app_collection_cut_records','app_collection_cut_attempts','app_collection_cut_pages','app_collection_free_cuts'])assert.throws(()=>f.db.prepare('DELETE FROM '+table).run(),/immutable/);
 t.diagnostic(JSON.stringify({maxStatements:Math.max(...f.measurements.map(m=>m.statements)),maxBatchBytes:Math.max(...f.measurements.map(m=>m.batchBytes)),maxParameters:Math.max(...f.measurements.map(m=>m.maxParameters)),holdings:2,eligibleWallets:2,syntheticProvenance:true,financialExecution:false}));
});

test('a source mutation invalidates all prior page checks and a new key can create a new attempt',async t=>{
 const f=await freeCutFixture(t);await f.stage();const first=await f.begin(),id=first.value.attemptId;assert.equal((await f.page(id)).kind,'committed');
 f.db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();assert.equal((await f.seal(id)).code,'revision_conflict');assert.equal((await f.begin()).kind,'replayed');const next=await f.begin('synthetic-next-attempt');assert.equal(next.kind,'committed',JSON.stringify(next));assert.notEqual(next.value.attemptId,id);assert.equal((await f.seal(next.value.attemptId)).reason,'cut-page-closure');assert.equal(count(f,'app_collection_free_cuts'),0);
});

test('omitting any fixed-cut child rolls back its receipt and leaves no apparent approval',async t=>{
 const f=await freeCutFixture(t);let omitted='';const faulty={...f.base,async batch(statements){return f.base.batch(statements.filter(s=>!omitted||!s.sql.startsWith('INSERT INTO '+omitted+'(')));}},service=createCollectionCutService({...f.ports,repository:createCollectionCutRepository(faulty,f.ports)});
 const before=count(f,'app_command_receipts');omitted='app_collection_cut_records';await assert.rejects(service.stageRecord(CUT_OPERATOR,{requestKey:f.bundle.root.id,record:f.bundle.root}),/Missing atomic/);assert.equal(count(f,'app_command_receipts'),before);omitted='';await f.stage();
 omitted='app_collection_cut_attempts';await assert.rejects(service.beginCut(CUT_OPERATOR,{requestKey:'bad-begin',rootId:f.bundle.root.id}),/Missing atomic/);omitted='';const begin=await f.begin(),attemptId=begin.value.attemptId;
 omitted='app_collection_cut_pages';await assert.rejects(service.validatePage(CUT_OPERATOR,{requestKey:'bad-page',attemptId,pageIndex:0}),/Missing atomic/);omitted='';assert.equal((await f.page(attemptId)).kind,'committed');
 omitted='app_collection_free_cuts';await assert.rejects(service.sealCut(CUT_OPERATOR,{requestKey:'bad-seal',attemptId}),/Missing atomic/);assert.equal(count(f,'app_collection_free_cuts'),0);assert.equal(count(f,'app_collection_cut_pages'),1);
});


test('owner projection excludes unrelated JSON and malformed or oversized retained evidence holds',async t=>{
 for(const variant of ['padding','oversized','malformed','wrong-time','oversized-asset']){
  let maxResultBytes=0;const f=await freeCutFixture(t,{wrap:base=>({...base,async batch(statements){const results=await base.batch(statements);maxResultBytes=Math.max(maxResultBytes,new TextEncoder().encode(JSON.stringify(results)).length);return results;}})}),owner=f.db.prepare("SELECT rowid,body FROM vault_observations WHERE kind='bind' ORDER BY rowid LIMIT 1").get(),body=JSON.parse(owner.body);
  if(variant==='padding')body.unrelated='x'.repeat(7000);
  if(variant==='oversized')body.unrelated='x'.repeat(9000);
  if(variant==='wrong-time')body.at=new Date(f.cutMs+1000).toISOString();
  f.db.prepare('UPDATE vault_observations SET body=? WHERE rowid=?').run(variant==='malformed'?'not-json':JSON.stringify(body),owner.rowid);
  if(variant==='oversized-asset'){const a=f.db.prepare('SELECT id,asset FROM collect_assets ORDER BY id LIMIT 1').get(),nft=JSON.parse(a.asset);nft.unrelated='x'.repeat(17000);f.db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run(JSON.stringify(nft),a.id);}
  await f.stage();const begin=await f.begin();assert.equal(begin.kind,'committed',JSON.stringify(begin));maxResultBytes=0;const page=await f.page(begin.value.attemptId);if(variant==='padding')assert.equal(page.kind,'committed',JSON.stringify(page));else{assert.equal(page.kind,'pending',JSON.stringify(page));assert.equal(count(f,'app_collection_cut_pages'),0);}
  assert.ok(maxResultBytes<10000,variant+' projected bytes='+maxResultBytes);assert.equal(count(f,'app_collection_free_cuts'),0);
 }
});

test('cut controls remain fail closed while accepted record retries survive pause',async t=>{
 const f=await freeCutFixture(t);await f.stage();f.db.prepare("INSERT INTO ops_scope_log(scope,revision,paused,at_ms,actor,reason,evidence_ref,request_key) VALUES('collection-mint','synthetic-cut-pause',1,?,'synthetic-cut-operator','synthetic pause','synthetic-pause-evidence','synthetic-cut-pause')").run(f.cutMs);
 assert.equal((await f.begin()).reason,'operator-pause');const record=f.bundle.root,replay=await f.service.stageRecord(CUT_OPERATOR,{requestKey:record.id,record});assert.equal(replay.kind,'replayed');assert.equal(count(f,'app_collection_cut_attempts'),0);
});


test('begin freezes its source only after every immutable input page is staged',async t=>{
 const f=await freeCutFixture(t),root=f.bundle.root;assert.equal((await f.service.stageRecord(CUT_OPERATOR,{requestKey:root.id,record:root})).kind,'committed');assert.equal((await f.begin()).reason,'cut-input-pages-missing');assert.equal(count(f,'app_collection_cut_attempts'),0);await f.stage();assert.equal((await f.begin()).kind,'committed');
});


test('ten thousand holdings close through100 real page commands with100 known Genesis observations',async t=>{
 const f=await prepareFreeCutCapacity(t);assert.equal(count(f,'app_collection_cut_pages'),100);assert.equal(count(f,'app_collection_free_cuts'),1);assert.equal(count(f,'collect_assets'),100);assert.equal(count(f,'tx_intents'),0);assert.ok(f.commandMetrics.every(m=>m.statements<1000&&m.maxBatchBytes<=262144&&m.readBytes<=1048576));assert.ok(f.sealMetrics.readBytes<=1048576&&f.sealMetrics.maxBatchBytes<=262144);t.diagnostic(JSON.stringify({holdings:10000,knownGenesis:100,externalSyntheticHoldings:9900,commands:100,maxPageStatements:Math.max(...f.commandMetrics.map(m=>m.statements)),maxPageReadBytes:Math.max(...f.commandMetrics.map(m=>m.readBytes)),maxPageBatchBytes:Math.max(...f.commandMetrics.map(m=>m.maxBatchBytes)),finalSeal:f.sealMetrics}));
});


test('mandatory SQL closure rejects a repository read that omits every known Genesis',async t=>{
 const f=await freeCutFixture(t);await f.stage();const begin=await f.begin(),attemptId=begin.value.attemptId;
 const faulty={...f.base,async batch(statements){const result=await f.base.batch(statements);return result.map((r,n)=>statements[n].sql.startsWith('WITH tracked AS')||statements[n].sql.startsWith('SELECT a.id,i.kind,a.bind_ms')?{...r,rows:[]}:r);}},service=createCollectionCutService({...f.ports,repository:createCollectionCutRepository(faulty,f.ports)});
 await assert.rejects(service.validatePage(CUT_OPERATOR,{requestKey:'synthetic-missing-known',attemptId,pageIndex:0}),/Missing complete fixed-cut holdings/);assert.equal(count(f,'app_collection_cut_pages'),0);assert.equal(count(f,'app_collection_free_cuts'),0);
});

test('concurrent page validation and final sealing retain one original receipt',async t=>{
 const f=await freeCutFixture(t);await f.stage();const begin=await f.begin(),id=begin.value.attemptId;
 for(const calls of [[()=>f.page(id),()=>f.page(id)],[()=>f.seal(id),()=>f.seal(id)]]){const outcomes=await Promise.all(calls.map(call=>call()));assert.deepEqual(outcomes.map(o=>o.kind).sort(),['committed','replayed']);assert.deepEqual(outcomes[0].value,outcomes[1].value);assert.deepEqual(outcomes[0].receipt,outcomes[1].receipt);}
 assert.equal(count(f,'app_collection_cut_pages'),1);assert.equal(count(f,'app_collection_free_cuts'),1);
});
