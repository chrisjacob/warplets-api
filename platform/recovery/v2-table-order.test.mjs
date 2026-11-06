import {parseRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryTableOrderIndices,recoveryTableOrderPosition} from './v2-table-order.mjs';
import {BUSINESS_TABLES} from './schema.mjs';
import {v2RestoreSource,v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {fullAdoptionSource,fullAdoptionTarget,assertFullAdoptionReady,expectedBusinessTables} from './v2-adoption-full.fixtures.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const bytes=value=>utf8(canonicalJson(value)).length;
const clone=value=>JSON.parse(canonicalJson(value));
const expanded=target=>parseRecoveryV2Checkpoint(canonicalJson(target.checkpoint()));
const numbers=BUSINESS_TABLES.map((_,index)=>index);
// Malformed descriptors must reach the runtime guard, not a test encoder guard.
function storageMutation(c){return Array.isArray(c.tables)?{...c,tables:null,tablesPackedV1:c.tables.map(t=>['name','columns','primaryKey','hasRowid','rowCount','pages','tableDigest'].map(k=>t[k]))}:c;}
function save(target,c){target.db.prepare("UPDATE app_recovery_runs SET checkpoint_json=?,state='restoring',report_json=NULL WHERE id=?").run(JSON.stringify(storageMutation(c)),target.input.pinnedDigest);target.db.prepare("UPDATE app_recovery_state SET status='restoring' WHERE active_restore_id=?").run(target.input.pinnedDigest);}

test('table-order indices preserve exact order including zero and reject incomplete or mixed inventories',()=>{
 const names=[...BUSINESS_TABLES];assert.deepEqual(recoveryTableOrderIndices(names,names),numbers);assert.deepEqual(recoveryTableOrderIndices([...names].reverse(),names),[...numbers].reverse());
 assert.deepEqual(recoveryTableOrderPosition(numbers,names,0),{indices:numbers,name:names[0]});assert.equal(recoveryTableOrderPosition(numbers,names,names.length).name,null);
 for(const value of [null,[],numbers.slice(1),[...numbers,0],numbers.map((n,i)=>i===1?0:n),numbers.map((n,i)=>i===0?-1:n),numbers.map((n,i)=>i===0?0.5:n),numbers.map((n,i)=>i===0?numbers.length:n),numbers.map((n,i)=>i===0?names[0]:n),names.map((n,i)=>i===0?'unknown-table':n)])assert.throws(()=>recoveryTableOrderIndices(value,names),TypeError);
 for(const inventory of [names.slice(1),[...names].reverse(),names.map((n,i)=>i===1?names[0]:n)])assert.throws(()=>recoveryTableOrderIndices(numbers,inventory),TypeError);
 for(const index of [-1,0.5,numbers.length+1,null,'0',undefined,NaN])assert.throws(()=>recoveryTableOrderPosition(numbers,names,index),TypeError);
 assert.ok(bytes(numbers)<bytes(names));
});

test('real restore refuses invalid table orders and cursors without importing or advancing to fences',async t=>{
 const f=await v2RestoreSource(t,{jobs:false}),target=v2RestoreTarget(t,f);assert.equal((await target.drive({stopPhase:'tables'})).phase,'tables');const original=expanded(target),watermark=target.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').get().revision;
 assert.ok(original.tableOrder.every(Number.isSafeInteger));assert.equal(original.tableIndex,0);
 const cases=[['missing',c=>{c.tableOrder.pop();}],['duplicate',c=>{c.tableOrder[0]=c.tableOrder[1];}],['negative-entry',c=>{c.tableOrder[0]=-1;}],['mixed',c=>{c.tableOrder[0]=BUSINESS_TABLES[c.tableOrder[0]];}],['unknown-legacy',c=>{c.tableOrder=c.tableOrder.map(i=>BUSINESS_TABLES[i]);c.tableOrder[0]='unknown';}],['fractional-index',c=>{c.tableIndex=0.5;}],['negative-index',c=>{c.tableIndex=-1;}],['past-end-index',c=>{c.tableIndex=c.tableOrder.length+1;}],['null-index',c=>{c.tableIndex=null;}],['missing-descriptor',c=>{c.tables.pop();}],['duplicate-descriptor',c=>{c.tables[0]=c.tables[1];}],['wrong-count',c=>{c.root.tables.count--;}],['oversize-next-checkpoint',c=>{c.syntheticPadding='x'.repeat(131072);}]];
 for(const [name,mutate] of cases){const c=clone(original);mutate(c);save(target,c);
  const result=await target.service.step({...target.input,expectedRevision:c.revision});assert.equal(result.kind,'held',name+': '+JSON.stringify(result));
  assert.equal(target.checkpoint().phase,'tables');assert.notEqual(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');assert.equal(target.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').get().revision,watermark);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,0);
 }
 // Resume legacy name order only from a genuine within-bound checkpoint.
 // The larger modern-pending source below has no such118-table representation.
 save(target,original);let mid=target.checkpoint();
 for(let n=0;n<100&&mid.tableIndex<3;n++){assert.equal((await target.call('step')).kind,'progress');mid=target.checkpoint();}
 assert.equal(mid.phase,'tables');assert.ok(mid.tableIndex>=3&&mid.tableIndex<BUSINESS_TABLES.length);assert.equal(mid.activePage,null);
 const old=clone(mid);old.tableOrder=old.tableOrder.map(index=>BUSINESS_TABLES[index]);const legacyCheckpointBytes=bytes(old);assert.ok(legacyCheckpointBytes<=131072);save(target,old);
 const watermarkBeforeConversion=target.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').get().revision;
 const converted=await target.call('step');assert.equal(converted.kind,'progress');const next=target.checkpoint();
 assert.deepEqual(next.tableOrder,original.tableOrder);assert.equal(next.tableIndex,mid.tableIndex);assert.equal(next.pageIndex,mid.pageIndex);assert.equal(next.importedRows,mid.importedRows);assert.equal(next.phase,'tables');
 assert.equal(target.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').get().revision,watermarkBeforeConversion);
 const saved=clone(next);assert.equal((await target.service.step({...target.input,expectedRevision:mid.revision})).kind,'replayed');assert.deepEqual(target.checkpoint(),saved);
 const fenced=await target.drive({stopPhase:'fences',resume:true});assert.equal(fenced.phase,'fences');assert.equal(target.checkpoint().tableIndex,BUSINESS_TABLES.length);assert.equal(target.checkpoint().tableOrder,null);
 const ready=await target.drive({resume:true});assert.equal(ready.kind,'restored',JSON.stringify(ready));const state=target.db.prepare('SELECT * FROM app_recovery_state WHERE id=1').get();assert.equal(state.status,'ready');
 for(const table of expectedBusinessTables(f,state.generation))assert.deepEqual(target.db.prepare(table.query).all().map(r=>JSON.parse(r.value)),table.rows,table.name);
 t.diagnostic(JSON.stringify({tables:BUSINESS_TABLES.length,indexedOrderBytes:bytes(original.tableOrder),legacyOrderBytes:bytes(old.tableOrder),savedBytes:bytes(old.tableOrder)-bytes(original.tableOrder),legacyCheckpointBytes,legacyResumeTableIndex:mid.tableIndex,legacyMidImportResume:true,legacyFullReady:true,invalidCases:cases.map(([name])=>name),transitionOnlyAtExactLength:true,limitsUnchanged:true}));
});

test('normal modern-pending recovery reaches ready within indexed checkpoint bounds',async t=>{
 const f=await fullAdoptionSource(t,'modern-pending'),target=fullAdoptionTarget(t,f),peaks={};let result=await target.call('start'),calls=1,order=null,minLegacyCandidateBytes=Infinity;
 while(result.kind!=='restored'&&calls++<10000){
  assert.ok(['started','progress','replayed'].includes(result.kind),JSON.stringify(result));const c=JSON.parse(target.checkpoint()),size=bytes(c);peaks[c.phase]=Math.max(peaks[c.phase]??0,size);
  if(c.phase==='objects'&&!order){order=[...c.tableOrder];assert.ok(order.every(Number.isSafeInteger));}
  // Measure, but never fabricate an oversized historical checkpoint. Legacy
  // conversion/full readiness is independently exercised on the source above.
  if(c.phase==='tables'&&c.tableIndex>=3&&c.tableIndex<c.tableOrder.length&&c.pageIndex===0&&c.activePage===null&&c.importedRows===0){const old=clone(c);old.tableOrder=old.tableOrder.map(index=>BUSINESS_TABLES[index]);minLegacyCandidateBytes=Math.min(minLegacyCandidateBytes,bytes(old));}
  result=await target.call();
 }
 const exact=await assertFullAdoptionReady(target,f,result);assert.ok(Number.isFinite(minLegacyCandidateBytes));assert.ok(target.measurements.every(m=>m.sql+m.objectReads+m.objectWrites<=64&&m.maxBatchBytes<=262144));
 t.diagnostic(JSON.stringify({profile:'modern-pending',normalReady:true,syntheticPrerequisiteProof:false,minLegacyCandidateBytes,legacyRepresentationFits:minLegacyCandidateBytes<=131072,...exact,calls,phaseCheckpointPeaks:peaks,maxIndexedCheckpointBytes:Math.max(...Object.values(peaks)),orderSavingsBytes:bytes(order.map(i=>BUSINESS_TABLES[i]))-bytes(order),maxOperations:Math.max(...target.measurements.map(m=>m.sql+m.objectReads+m.objectWrites)),limitsUnchanged:true}));
});
