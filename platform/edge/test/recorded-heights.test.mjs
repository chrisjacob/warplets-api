import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {recordedHeightFixture} from '../../storage/recorded-attempt-expiries.fixtures.mjs';
test('actual local D1 retained height expires exactly one unsigned attempt with guarded evidence and replay',async t=>{
 const node=await recordedHeightFixture(t),edge=await localRuntime(t,new URL('./fixtures/recorded-height-worker.ts',import.meta.url));
 for(const [table,rows]of Object.entries(node.initialLegacy))for(const row of rows){const keys=Object.keys(row);await edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();}
 await edge.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(node.principal.id,'evidence-ingest').run();
 const fixture={source:node.source,records:node.records.map(r=>({...r,bytes:[...r.bytes]}))},log=[];const call=async body=>{const response=await edge.mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify({fixture,principal:node.principal,nowMs:node.now,...body})});assert.equal(response.status,200);const value=await response.json();log.push(value.metrics);return value;};
 const registered=await call({method:'register'});assert.equal(registered.result?.kind,'committed',JSON.stringify(registered));let head=null;
 const ingest=async recordId=>{const r=await call({method:'ingest',input:{sourceId:node.source.sourceId,sourceRevision:'v1',recordId,requestedCutoffMs:null,supersedes:head}});assert.equal(r.result?.kind,'committed',JSON.stringify(r));head=r.result.value.receiptDigest;assert.equal(head,await node.ingest(recordId));return head;};
 const counts=async()=>({...await edge.db.prepare("SELECT (SELECT COUNT(*) FROM app_recorded_attempt_expiries) bindings,(SELECT COUNT(*) FROM tx_receipts) events,(SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='transactions.expire-recorded-attempt.v1') receipts,(SELECT revision FROM tx_intents LIMIT 1) revision,(SELECT state FROM tx_intents LIMIT 1) state").first()});
 const before=await counts(),boundary=node.request(await ingest('boundary'),'boundary');assert.deepEqual((await call({method:'expire',input:boundary})).result,await node.service.expire(node.principal,boundary));assert.deepEqual(await counts(),before);
 const digest=await ingest('expired'),input=node.request(digest);
 for(const fault of ['omit-binding','omit-intent','omit-attempt','alter-height','clock','scope','head']){const r=await call({method:'expire',input,fault});if(['clock','scope','head'].includes(fault))assert.equal(r.result.kind,'conflict');else assert.ok(r.error,JSON.stringify(r));assert.equal(r.faultInjected,1);assert.deepEqual(await counts(),before);
  if(fault==='scope')await edge.db.prepare('UPDATE app_operator_scopes SET enabled=1 WHERE operator=?').bind(node.principal.id).run();
  if(fault==='head')await edge.db.prepare('INSERT INTO app_evidence_heads(stream_key,receipt_digest) VALUES(?,?)').bind(JSON.stringify([node.source.sourceId,node.source.subject.kind,node.source.subject.id,null]),digest).run();
 }
 // Explicit negative current-state faults; unsigned baseline is restored before
 // positive import. These mutations do not claim a real observed submission.
 for(const state of ['submitted','unknown','confirmed','failed','finalized']){await edge.db.prepare('UPDATE tx_intents SET state=?').bind(state).run();await edge.db.prepare('UPDATE tx_attempts SET state=?,signature=?').bind(state,node.legacy.signature).run();assert.equal((await call({method:'expire',input})).result.code,'attempt_expiry_conflict');assert.equal((await counts()).bindings,0);}
 await edge.db.prepare("UPDATE tx_intents SET state='awaiting_signature'").run();await edge.db.prepare("UPDATE tx_attempts SET state='awaiting_signature',signature=NULL").run();
 const nodeResult=await node.service.expire(node.principal,input),races=await Promise.all([call({method:'expire',input}),call({method:'expire',input})]);assert.deepEqual(races.map(r=>r.result.kind).sort(),['committed','replayed']);for(const r of races)assert.deepEqual(r.result.value,nodeResult.value);assert.equal((await counts()).state,'attempt_expired');assert.equal((await counts()).events,0);assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM tx_attempts').first('n'),1);
 await assert.rejects(edge.db.prepare("UPDATE tx_attempts SET state='awaiting_signature'").run());await assert.rejects(edge.db.prepare("UPDATE tx_attempts SET signature='fake'").run());
 await edge.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').bind(node.principal.id).run();const accepted=await counts(),replay=await call({method:'expire',input,nowMs:node.now+9999999});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,nodeResult.value);assert.deepEqual(await counts(),accepted);
 const metrics={calls:log.length,sqlStatements:Math.max(...log.map(x=>x.sqlStatements)),batchBytes:Math.max(...log.map(x=>x.maxBatchBytes)),parameters:Math.max(...log.map(x=>x.maxParameters)),objectReads:Math.max(...log.map(x=>x.objectReads))};assert.ok(metrics.sqlStatements<=30);assert.ok(metrics.batchBytes<=262144);assert.ok(metrics.parameters<=100);t.diagnostic(JSON.stringify(metrics));
});
