import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createCollection,publishCollectionStage} from './store.mjs';
import {governanceOperatorFixture,governanceWallets} from '../governance/operator-test-fixture.mjs';
import {createStagePublicationRepository} from './stage-repository.mjs';
import {createStagePublicationService} from './stage-service.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
const principal={kind:'operator',id:'synthetic-stage-publisher'};
async function setup(t,{kind='genesis',fault=null,large=false}={}){
 const f=await governanceOperatorFixture(t,large?{holders:governanceWallets(10000),nextWhitelist:[]}:{});
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-publication');
 const inventoryId='synthetic-stage-'+kind;createCollection(f.db,{id:inventoryId,kind,...(kind==='genesis'?{tranche:1}:{seasonStart:f.getNow()})});
 const input={inventoryId,stageId:'synthetic-first',type:'whitelist',publishedAt:f.getNow(),opensAt:f.getNow()+172800000,closesAt:f.getNow()+259200000,priceLamports:'100000000',costLamports:'500000',allocation:1000,walletLimit:kind==='genesis'?null:2,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture'};
 const metrics=[];let fired=false;
 const driver={...f.base,async batch(statements){
  if(!fired&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_stages'))){fired=true;
   if(fault?.startsWith('omit-')){const needle={'omit-authority':'INSERT INTO app_collection_authorities','omit-revision':'UPDATE app_collection_authorities','omit-stage':'INSERT INTO app_collection_stages','omit-audit':'INSERT INTO ops_config_audit'}[fault];statements=statements.filter(s=>!s.sql.startsWith(needle));}
   if(fault==='alter-audit')statements=statements.map(s=>s.sql.startsWith('INSERT INTO ops_config_audit')?{...s,values:s.values.map((v,n)=>n===7?'wrong-operator':v)}:s);
   if(fault==='revoke')f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-publication'").run(principal.id);
  }
  metrics.push(measureBatch(statements));const result=await f.base.batch(statements);if(fault==='lost-response'&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_stages')))throw Error('Synthetic acknowledgement loss.');return result;
 }};
 const service=createStagePublicationService({...f.ports,repository:createStagePublicationRepository(driver,f.ports)});
 return {...f,input,metrics,publish:(changes={},key='synthetic-publication')=>service.publishStage(principal,{input:{...input,...changes},requestKey:key})};
}
test('normalized private publication stores compact exact legacy terms and preserves accepted replay after scope revocation',async t=>{
 const f=await setup(t),reference=openDatabase();t.after(()=>reference.close());createCollection(reference,{id:f.input.inventoryId,kind:'genesis',tranche:1});
 const {inventoryId,stageId,eligibilityListId,sourceKind,...terms}=f.input;publishCollectionStage(reference,{inventoryId,stage:{...terms,id:stageId,wallets:f.holders}},f.getNow());
 const expected=JSON.parse(reference.prepare('SELECT state FROM collect_inventories').get().state).stages[0],{wallets:ignored,...expectedTerms}=expected;
 const result=await f.publish();assert.equal(result.kind,'committed',JSON.stringify(result));const stage=f.db.prepare('SELECT * FROM app_collection_stages').get();assert.deepEqual(JSON.parse(stage.terms_json),expectedTerms);assert.equal(result.value.termsDigest,expected.termsDigest);assert.equal(result.value.eligibility.count,f.holders.length);
 assert.equal(f.db.prepare('SELECT revision FROM app_collection_authorities').get().revision,1);assert.throws(()=>publishCollectionStage(f.db,{inventoryId,stage:{...terms,id:'legacy-bypass',wallets:f.holders}},f.getNow()),/Normalized collection authority/);
 f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").run(principal.id);const replay=await f.publish();assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,result.value);assert.deepEqual(replay.receipt,result.receipt);
 assert.equal((await f.publish({costLamports:'500001'})).code,'idempotency_conflict');assert.throws(()=>f.db.prepare('UPDATE app_collection_stages SET opens_ms=opens_ms').run(),/immutable/);
});
test('every omitted authority, revision or publication child aborts the command receipt and all effects',async t=>{
 for(const fault of ['omit-authority','omit-revision','omit-stage','omit-audit','alter-audit']){const f=await setup(t,{fault}),before=f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n;await assert.rejects(f.publish());
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,before);
 }
});
test('current scoped authority is rechecked and unknown commit acknowledgements recover the original publication',async t=>{
 const revoked=await setup(t,{fault:'revoke'});assert.equal((await revoked.publish()).code,'revision_conflict');assert.equal(revoked.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,0);
 const unknown=await setup(t,{fault:'lost-response'}),accepted=await unknown.publish();assert.equal(accepted.kind,'replayed');assert.equal(unknown.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,1);
 const raced=await setup(t),results=await Promise.all([raced.publish(),raced.publish()]);assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);assert.deepEqual(results[0].value,results[1].value);
});
test('full10000-wallet verified list stays a compact stage binding and SQL batch',async t=>{
 const f=await setup(t,{large:true}),result=await f.publish();assert.equal(result.kind,'committed');assert.equal(result.value.eligibility.count,10000);const stage=f.db.prepare('SELECT terms_json FROM app_collection_stages').get();assert.ok(Buffer.byteLength(stage.terms_json)<2048);
 assert.ok(f.metrics.every(m=>m.maxParameters<=100&&m.batchBytes<=32768));assert.doesNotMatch(JSON.stringify(result),new RegExp(f.holders[0]));t.diagnostic(JSON.stringify({wallets:10000,maxBatchBytes:Math.max(...f.metrics.map(m=>m.batchBytes)),maxParameters:Math.max(...f.metrics.map(m=>m.maxParameters)),source:'synthetic-local-operator-fixture'}));
});
test('free publication waits for paid phase schedule and founder/public records require the separate founder scope',async t=>{
 const f=await setup(t,{kind:'season'}),base=f.getNow(),free={stageId:'synthetic-free',type:'free',priceLamports:'0',eligibilityListId:null,walletLimit:null,opensAt:base+5*86400000,closesAt:base+6*86400000};
 assert.equal((await f.publish(free,'free')).reason,'paid_stages_incomplete');assert.equal((await f.publish()).kind,'committed');assert.equal((await f.publish({stageId:'synthetic-expanded',opensAt:base+3*86400000,closesAt:base+4*86400000},'expanded')).kind,'committed');
 const accepted=await f.publish(free,'free');assert.equal(accepted.kind,'committed');assert.deepEqual(accepted.value.eligibility,{kind:'pending',listId:null,count:null});
 const publicStage={stageId:'synthetic-public',type:'public',eligibilityListId:null,founderApproved:true,opensAt:base+6*86400000,closesAt:base+7*86400000};assert.equal((await f.publish(publicStage,'public')).code,'operator_scope_required');
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-founder');assert.equal((await f.publish(publicStage,'public')).kind,'committed');
});
test('populated legacy inventory is explicitly held instead of silently creating a second admission authority',async t=>{
 const f=await setup(t),{inventoryId,stageId,eligibilityListId,sourceKind,...terms}=f.input;publishCollectionStage(f.db,{inventoryId,stage:{...terms,id:stageId,wallets:f.holders}},f.getNow());
 assert.equal((await f.publish()).reason,'stage-populated-reference-adoption-required');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);
});

test('stage preview derives exact sealed terms without writes and fences reviewed revisions',async t=>{
 const f=await setup(t),service=createStagePublicationService({...f.ports,repository:createStagePublicationRepository(f.base,f.ports)});
 const versions=()=>Object.fromEntries(f.db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)]));
 const request={requestKey:'previewed-stage',input:f.input,expectedRevisions:versions()},before=f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n;
 const preview=await service.previewStage(principal,request);assert.equal(preview.kind,'preview');assert.equal(preview.value.financialExecution,false);assert.equal(preview.value.eligibility.listId,f.input.eligibilityListId);
 assert.deepEqual(preview.value.opening,{applicable:false,firstStageId:null,ballotId:null,previousInventoryId:null,previousTranche:null,previousAdmitted:null,previousRemaining:null,decisionStatus:'missing',decisionEarliestMs:null,defaultPostponed:false,inventoryOverrideReason:null,effectiveEarliestMs:null,holds:[],financialExecution:false});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,before);
 f.db.prepare('UPDATE app_operator_scopes SET revision=revision+1 WHERE operator=?').run(principal.id);
 assert.equal((await service.publishStage(principal,request)).code,'revision_conflict');
 const refreshed={...request,expectedRevisions:versions()},next=await service.previewStage(principal,refreshed),accepted=await service.publishStage(principal,refreshed);
 assert.equal(accepted.kind,'committed');assert.equal(accepted.value.termsDigest,next.value.termsDigest);assert.equal(next.value.termsDigest,preview.value.termsDigest);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);
 assert.equal((await service.publishStage(principal,refreshed)).kind,'replayed');
});


test('publication audit binds derived terms and list; competing inventory publications cannot fork its head',async t=>{
 const f=await setup(t),second='synthetic-second-audit-inventory';createCollection(f.db,{id:second,kind:'season',seasonStart:f.getNow()});
 const other={inventoryId:second,stageId:'synthetic-second-stage',walletLimit:2};
 const pair=await Promise.all([f.publish(),f.publish(other,'second-publication')]);
 assert.equal(pair.filter(r=>r.kind==='committed').length,1);assert.equal(pair.filter(r=>r.code==='revision_conflict').length,1);
 const retry=pair[0].kind==='committed'?await f.publish(other,'second-publication'):await f.publish();assert.equal(retry.kind,'committed');
 const rows=f.db.prepare("SELECT * FROM ops_config_audit WHERE category='collection-stage' ORDER BY seq").all();assert.equal(rows.length,2);verifyConfigChain(f.db);
 for(const row of rows){const body=JSON.parse(row.payload),stage=f.db.prepare('SELECT terms_digest,list_id,eligible_count FROM app_collection_stages WHERE inventory_id=? AND stage_id=?').get(body.inventoryId,body.stageId);
  assert.equal(body.termsDigest,stage.terms_digest);assert.equal(body.eligibility.listId,stage.list_id);assert.equal(body.eligibility.count,stage.eligible_count);assert.equal(row.actor,principal.id);}
 assert.equal((await f.publish()).kind,'replayed');assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ops_config_audit WHERE category='collection-stage'").get().n,2);
});


// Explicit synthetic retained reference counters: these tests exercise bounded
// preview selection, not verification of payment or historic mint admissions.
async function laterSetup(t,{admitted=999,override=null,normalizedPrevious=false}={}){
 const f=await setup(t),previousId=f.input.inventoryId,priorOpen=f.input.opensAt;
 if(normalizedPrevious){
  assert.equal((await f.publish()).kind,'committed');
  // Synthetic allocation count on a genuinely published normalized authority;
  // the old reference JSON remains empty and must not win source selection.
  f.db.prepare('UPDATE app_collection_authorities SET admitted=? WHERE inventory_id=?').run(admitted,previousId);
 }else{
  publishCollectionStage(f.db,{inventoryId:previousId,stage:{id:'synthetic-previous-opening',type:'whitelist',publishedAt:f.getNow(),opensAt:priorOpen,closesAt:priorOpen+86400000,priceLamports:'100000000',costLamports:'500000',allocation:1000,wallets:f.holders}},f.getNow());
  const state=JSON.parse(f.db.prepare('SELECT state FROM collect_inventories WHERE id=?').get(previousId).state);
  state.admissions=Array.from({length:admitted},(_,n)=>({operationId:'synthetic-count-only-'+n}));
  f.db.prepare('UPDATE collect_inventories SET state=? WHERE id=?').run(JSON.stringify(state),previousId);
 }
 const inventoryId='synthetic-genesis-two';createCollection(f.db,{id:inventoryId,kind:'genesis',tranche:2});
 const ballotId='synthetic-opening-ballot';f.db.prepare('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)').run(ballotId,priorOpen,priorOpen+172800000,priorOpen,'a'.repeat(64),0);
 const input={...f.input,inventoryId,ballotId,inventoryOverrideReason:override,priceLamports:'200000000'};
 if(override!==null)f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-founder');
 const service=createStagePublicationService({...f.ports,repository:createStagePublicationRepository(f.base,f.ports)});
 return {...f,input,previousId,ballotId,preview:(changes={},extra={})=>service.previewStage(principal,{requestKey:changes.stageId??'later-stage',input:{...input,...changes},...extra}),publishLater:(changes={},extra={})=>service.publishStage(principal,{requestKey:changes.stageId??'later-stage',input:{...input,...changes},...extra}),decision:at=>f.db.prepare('INSERT INTO genesis_decisions VALUES(?,?,?,?,?,?)').run(ballotId,'7',f.getNow(),f.getNow(),at,'Synthetic retained decision fixture.')};
}

test('later-tranche preview reports authoritative local 999/1000 allocations and missing decision without forbidding publication',async t=>{
 for(const admitted of [999,1000]){
  const f=await laterSetup(t,{admitted}),before=f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n;
  const preview=await f.preview();assert.equal(preview.kind,'preview',JSON.stringify(preview));const o=preview.value.opening;
  assert.deepEqual(o,{applicable:true,firstStageId:f.input.stageId,ballotId:f.ballotId,previousInventoryId:f.previousId,previousTranche:1,previousAdmitted:admitted,previousRemaining:1000-admitted,decisionStatus:'missing',decisionEarliestMs:null,defaultPostponed:admitted<1000,inventoryOverrideReason:null,effectiveEarliestMs:null,holds:['stage-not-open','decision-missing',...(admitted<1000?['previous-inventory-remaining']:[])],financialExecution:false});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,before);
  const published=await f.publishLater();assert.equal(published.kind,'committed');assert.equal(published.value.termsDigest,preview.value.termsDigest);
 }
});

test('retained decision boundary and explicit scoped override remove only the previous inventory hold',async t=>{
 const f=await laterSetup(t,{override:'  Explicit synthetic local tranche override.  '}),earliest=f.input.opensAt+86400000;
 f.decision(earliest);
 const first=await f.preview();assert.equal(first.kind,'preview');assert.equal(first.value.opening.defaultPostponed,true);assert.deepEqual(first.value.opening.holds,['stage-not-open','decision-not-due']);assert.equal(first.value.opening.effectiveEarliestMs,earliest);
 f.setNow(earliest-1);assert.deepEqual((await f.preview()).value.opening.holds,['decision-not-due']);
 f.setNow(earliest);assert.deepEqual((await f.preview()).value.opening.holds,[]);
 f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-founder'").run(principal.id);
 assert.equal((await f.preview()).code,'operator_scope_required');assert.equal((await f.publishLater()).code,'operator_scope_required');
 f.db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE operator=? AND scope='collection-founder'").run(principal.id);
 const accepted=await f.publishLater();assert.equal(accepted.kind,'committed');
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);
 const replay=await f.publishLater();assert.equal(replay.kind,'replayed');assert.deepEqual(replay.receipt,accepted.receipt);assert.deepEqual(replay.value,accepted.value);
 assert.equal((await f.publishLater({inventoryOverrideReason:'Changed override.'})).code,'idempotency_conflict');
});

test('subsequent publication shows immutable first-stage policy, rejects attempted amendment and reports latched opening without phantom holds',async t=>{
 const f=await laterSetup(t,{override:'Original retained override.'});assert.equal((await f.publishLater()).kind,'committed');
 const next={stageId:'synthetic-later-stage',ballotId:null,inventoryOverrideReason:null,opensAt:f.input.closesAt,closesAt:f.input.closesAt+86400000};
 assert.equal((await f.preview({...next,ballotId:f.ballotId})).reason,'stage_opening_policy_inapplicable');
 assert.equal((await f.preview({...next,inventoryOverrideReason:'Attempted replacement.'})).reason,'stage_opening_policy_inapplicable');
 const before=await f.preview(next);assert.equal(before.kind,'preview');assert.equal(before.value.opening.firstStageId,f.input.stageId);assert.equal(before.value.opening.ballotId,f.ballotId);assert.equal(before.value.opening.inventoryOverrideReason,'Original retained override.');assert.equal(before.value.opening.applicable,true);
 // Synthetic counter projection models the already-latched first admission.
 f.db.prepare('UPDATE app_collection_authorities SET admitted=1 WHERE inventory_id=?').run(f.input.inventoryId);
 const latched=await f.preview(next);assert.equal(latched.kind,'preview');assert.equal(latched.value.opening.applicable,false);assert.deepEqual(latched.value.opening.holds,[]);assert.equal(latched.value.opening.defaultPostponed,false);assert.equal(latched.value.opening.effectiveEarliestMs,null);assert.equal(latched.value.opening.inventoryOverrideReason,'Original retained override.');
});

test('opening facts reject missing/wrong ballot, fence decision changes, and normalized counters override old reference state',async t=>{
 const f=await laterSetup(t);
 assert.equal((await f.preview({ballotId:null})).reason,'missing_previous_tranche');
 assert.equal((await f.preview({ballotId:'synthetic-wrong-ballot'})).reason,'wrong_ballot');
 const preview=await f.preview(),versions=preview.value.expectedRevisions;
 f.decision(f.input.opensAt);assert.equal((await f.publishLater({}, {expectedRevisions:versions})).code,'revision_conflict');
 const fresh=await f.preview();assert.equal(fresh.value.opening.decisionStatus,'recorded');assert.equal(fresh.value.opening.effectiveEarliestMs,f.input.opensAt);
 const normalized=await laterSetup(t,{admitted:1000,normalizedPrevious:true});
 const out=await normalized.preview();assert.equal(out.kind,'preview',JSON.stringify(out));assert.equal(out.value.opening.previousAdmitted,1000);assert.equal(out.value.opening.previousRemaining,0);
});


test('preview cannot return opening facts from revisions changed across awaited terms hashing',async t=>{
 const f=await laterSetup(t);let changed=false;
 const crypto={...f.ports.crypto,async sha256(bytes){
  const result=await f.ports.crypto.sha256(bytes);
  if(!changed&&new TextDecoder().decode(bytes).startsWith('["'+f.input.inventoryId+'","'+f.input.stageId+'",')){
   changed=true;f.decision(f.input.opensAt);
  }
  return result;
 }};
 const ports={...f.ports,crypto},service=createStagePublicationService({...ports,repository:createStagePublicationRepository(f.base,ports)});
 const result=await service.previewStage(principal,{requestKey:'synthetic-preview-race',input:f.input});
 assert.equal(changed,true);assert.equal(result.code,'revision_conflict');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_stages WHERE inventory_id=?').get(f.input.inventoryId).n,0);
});
