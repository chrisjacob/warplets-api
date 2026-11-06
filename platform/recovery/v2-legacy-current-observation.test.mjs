import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedObservationFixture} from './v2-legacy-current-observation.fixtures.mjs';
import {createRetainedCollectionObservationVerifier} from './v2-legacy-current-observation.mjs';
import {canonicalJson} from '../security/canonical.mjs';
const verifier=(f,ports={})=>createRetainedCollectionObservationVerifier({driver:f.driver,crypto:f.crypto,artifacts:f.artifacts,...ports});
test('accepted reveal and transfer replay exact historical rows after scope revocation and head removal',async t=>{
 const f=await retainedObservationFixture(t);f.db.exec('UPDATE app_operator_scopes SET enabled=0; DELETE FROM app_evidence_heads');let previous=null;
 for(let n=0;n<f.steps.length;n++){const input=f.input(n,{afterSourceRevision:previous,retainedBytes:3*89088}),r=await verifier(f).replay(input);assert.equal(r.kind,'verified',JSON.stringify(r));assert.deepEqual(r.asset,{...f.steps[n].after.asset});assert.deepEqual(r.vault,{...f.steps[n].after.vault});assert.deepEqual(r.ownerEvidence,{...f.steps[n].after.ownerEvidence});assert.equal(r.conflict,null);assert.equal(r.readiness,false);assert.ok(r.metrics.sql<=64&&r.metrics.objectReads===1&&r.metrics.workingBytes<=1048576);previous=r.sourceRevision;t.diagnostic(JSON.stringify(r.metrics));}
});
test('accepted transfer during a reservation replays its permanent hold without granting readiness',async t=>{const f=await retainedObservationFixture(t,{pending:true}),r=await verifier(f).replay(f.input());assert.equal(r.kind,'verified',JSON.stringify(r));assert.equal(r.conflict.status,'held');assert.equal(JSON.parse(r.asset.asset).pending,f.steps[0].before.operation.id);assert.equal(r.readiness,false);});
test('missing bytes, corrupted effects, wrong baseline/order and after-hash target mutation hold',async t=>{
 const f=await retainedObservationFixture(t),input=f.input(),good=await verifier(f).replay(input);assert.equal(good.kind,'verified',JSON.stringify(good));
 const digits=good.sourceRevision.length;assert.ok(digits>=2);const prior='9'.repeat(digits-1),next='1'+'0'.repeat(digits);assert.equal((await verifier(f).replay({...input,afterSourceRevision:prior})).kind,'verified');
 for(const value of [good.sourceRevision,next,'9007199254740991','01'])assert.equal((await verifier(f).replay({...input,afterSourceRevision:value})).kind,'held');
 const bad=structuredClone(input);bad.baseline.asset.owner=f.f.other;assert.equal((await verifier(f).replay(bad)).kind,'held');
 const missing=await verifier(f,{artifacts:{getVerified:async()=>({status:'missing'})}}).replay(input);assert.equal(missing.kind,'held');
 const corrupt=await verifier(f,{artifacts:{getVerified:async identity=>({status:'verified',identity,bytes:new TextEncoder().encode('{}')})}}).replay(input);assert.equal(corrupt.kind,'held');
 let changed=false;const crypto={...f.crypto,async sha256(bytes){const digest=await f.crypto.sha256(bytes);if(!changed){changed=true;f.db.exec('UPDATE app_recovery_watermark SET revision=revision+1');}return digest;}};assert.equal((await verifier(f,{crypto}).replay(input)).reason,'observation-target-pin-changed');
 assert.equal((await verifier(f).replay(f.input(0,{retainedBytes:1048576}))).reason,'observation-working-bound');
});

test('corrupt retained command, effect, event, duplicate revision and omitted permanent hold fail closed',async t=>{
 const f=await retainedObservationFixture(t,{pending:true});for(const fault of ['request','effect','duplicate','event','vault','conflict']){let hit=false;const driver={...f.driver,async batch(statements){const result=await f.driver.batch(statements);return result.map((r,n)=>{const sql=statements[n].sql,rows=JSON.parse(JSON.stringify(r.rows));if(sql.startsWith('SELECT b.*')&&['request','effect'].includes(fault)){hit=true;if(fault==='request')rows[0].receipt_request_digest='0'.repeat(64);else{const e=JSON.parse(rows[0].effect_json);e.vaultOwner=f.f.wallet;rows[0].effect_json=JSON.stringify(e,Object.keys(e).sort());}}if(fault==='duplicate'&&sql.startsWith('SELECT COUNT(*) n FROM app_collection_observation_bindings')){hit=true;rows[0].n=2;}if(fault==='event'&&sql.startsWith('SELECT * FROM collect_observations')){hit=true;rows[0].digest='f'.repeat(64);}if(fault==='vault'&&sql.startsWith('SELECT event_id,asset_id')){hit=true;rows[0].body='{}';}if(fault==='conflict'&&sql.startsWith('SELECT * FROM app_collection_operation_conflicts')){hit=true;rows.length=0;}return {...r,rows};});}};const result=await verifier(f,{driver}).replay(f.input());assert.equal(hit,true,fault);assert.equal(result.kind,'held',fault+JSON.stringify(result));}
});
test('caller mutation during hashing cannot change captured baseline and private restoring targets remain valid',async t=>{
 const f=await retainedObservationFixture(t),input=structuredClone(f.input());let changed=false;const crypto={...f.crypto,async sha256(bytes){if(!changed){changed=true;input.baseline.asset.owner=f.f.other;input.pin.generation='mutated';}return f.crypto.sha256(bytes);}};assert.equal((await verifier(f,{crypto}).replay(input)).kind,'verified');assert.equal(changed,true);
 f.db.exec("UPDATE app_recovery_state SET status='restoring'");assert.equal((await verifier(f).replay(f.input())).kind,'verified');
});

test('audited observation receipt metadata, exact audit row and immediate predecessor are independently authenticated',async t=>{
 const f=await retainedObservationFixture(t),input=f.input(1,{retainedBytes:3*89088}),good=await verifier(f).replay(input);assert.equal(good.kind,'verified',JSON.stringify(good));
 const receipt=f.db.prepare('SELECT r.input_json FROM app_collection_observation_bindings b JOIN app_command_receipts r ON r.operation_id=b.command_operation_id WHERE b.source_id=?').get(input.sourceId),audit=JSON.parse(receipt.input_json).audit;assert.ok(audit.seq>1);
 for(const fault of ['extra-metadata','metadata-time','metadata-hash','metadata-payload','missing-audit','actor','entity','row-payload','missing-predecessor','predecessor-hash']){
  let hit=false;const driver={...f.driver,async batch(statements){const rows=await f.driver.batch(statements);return rows.map((result,n)=>{const query=statements[n].sql,values=structuredClone(result.rows);
   if(query.startsWith('SELECT b.*')&&fault.startsWith('metadata')||query.startsWith('SELECT b.*')&&fault==='extra-metadata'){hit=true;const envelope=JSON.parse(values[0].receipt_input_json);if(fault==='extra-metadata')envelope.audit.extra=true;if(fault==='metadata-time')envelope.audit.recordedMs++;if(fault==='metadata-hash')envelope.audit.eventHash='0'.repeat(64);if(fault==='metadata-payload')envelope.audit.payload=JSON.stringify({...JSON.parse(envelope.audit.payload),resultDigest:'0'.repeat(64)});values[0].receipt_input_json=canonicalJson(envelope);}
   if(query.includes('FROM ops_config_audit WHERE seq IN')&&['missing-audit','actor','entity','row-payload','missing-predecessor','predecessor-hash'].includes(fault)){hit=true;const current=values.find(r=>r.seq===audit.seq),previous=values.find(r=>r.seq===audit.seq-1);if(fault==='missing-audit')values.splice(values.indexOf(current),1);if(fault==='actor')current.actor='synthetic-other';if(fault==='entity')current.entity='synthetic-other-asset';if(fault==='row-payload')current.payload='{}';if(fault==='missing-predecessor')values.splice(values.indexOf(previous),1);if(fault==='predecessor-hash')previous.event_hash='0'.repeat(64);}
   return {...result,rows:values};});}};
  const result=await verifier(f,{driver}).replay(input);assert.equal(hit,true,fault);assert.equal(result.kind,'held',fault+JSON.stringify(result));assert.ok(result.metrics.sql<=64&&result.metrics.workingBytes<=1048576,fault);
 }
});

test('historical plain observation envelope retains recovery semantics without audit lookup or backfill',async t=>{
 const f=await retainedObservationFixture(t),before=f.db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n;
 // Read-only compatibility projection of an original pre062 receipt. Actual
 // old-form command adoption/replay is separately covered by repository tests.
 let auditReads=0;const driver={...f.driver,async batch(statements){auditReads+=statements.filter(s=>s.sql.includes('FROM ops_config_audit')).length;const results=await f.driver.batch(statements);return results.map((result,n)=>{if(!statements[n].sql.startsWith('SELECT b.*'))return result;return {...result,rows:result.rows.map(row=>{const {audit,...input}=JSON.parse(row.receipt_input_json);return {...row,receipt_input_json:canonicalJson(input)};})};});}};
 const recovered=await verifier(f,{driver}).replay(f.input());assert.equal(recovered.kind,'verified',JSON.stringify(recovered));assert.deepEqual(recovered.asset,{...f.steps[0].after.asset});assert.equal(auditReads,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,before);
});
