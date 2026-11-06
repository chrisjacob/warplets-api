import test from 'node:test';
import assert from 'node:assert/strict';
import {v2RestoreSource,v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {BUSINESS_TABLES} from './schema.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const clone=value=>JSON.parse(canonicalJson(value));
const bytes=value=>utf8(canonicalJson(value)).length;
const legacy=parents=>Object.fromEntries(parents.map((row,index)=>[BUSINESS_TABLES[index],row.map(parent=>BUSINESS_TABLES[parent])]));
function save(target,checkpoint){target.db.prepare("UPDATE app_recovery_runs SET checkpoint_json=?,state='restoring',report_json=NULL WHERE id=?").run(JSON.stringify(checkpoint),target.input.pinnedDigest);target.db.prepare("UPDATE app_recovery_state SET status='restoring' WHERE active_restore_id=?").run(target.input.pinnedDigest);}
const step=(target,c)=>target.service.step({...target.input,expectedRevision:c.revision});

test('indexed metadata parents resume legacy checkpoints and preserve exact deterministic import order',async t=>{
 const f=await v2RestoreSource(t,{jobs:false}),target=v2RestoreTarget(t,f);let result=await target.call('start'),partial=null,last=null,maxCheckpoint=0;
 while(result.phase==='metadata'){
  last=target.checkpoint();maxCheckpoint=Math.max(maxCheckpoint,bytes(last));
  if(!partial&&last.tables.length>=10){partial=clone(last);const old=clone(last);old.parents=legacy(old.parents);save(target,old);result=await target.call('step');assert.equal(result.kind,'progress');assert.ok(Array.isArray(target.checkpoint().parents));assert.equal(target.checkpoint().tables.length>=old.tables.length,true);continue;}
  result=await target.call('step');assert.ok(['progress','replayed'].includes(result.kind),JSON.stringify(result));
 }
 assert.equal(result.phase,'objects');assert.ok(partial);assert.equal(last.tables.length,BUSINESS_TABLES.length);assert.ok(Array.isArray(last.parents));assert.equal(last.parents.length,BUSINESS_TABLES.length);
 const expected=target.checkpoint().tableOrder,old=clone(last);old.parents=legacy(old.parents);save(target,old);result=await step(target,old);assert.equal(result.phase,'objects');assert.deepEqual(target.checkpoint().tableOrder,expected);assert.equal(target.checkpoint().parents,null);
 const edges=legacy(last.parents),remaining=new Map(Object.entries(edges).map(([name,parents])=>[name,new Set(parents)]));remaining.get('app_epoch_freezes').add('earn_submissions');remaining.get('earn_admission_counts').add('earn_submissions');const ordered=[];while(remaining.size){const ready=[...remaining].filter(([,deps])=>[...deps].every(name=>ordered.includes(name))).map(([name])=>name).sort();assert.ok(ready.length);for(const name of ready){ordered.push(name);remaining.delete(name);}}
 assert.deepEqual(expected,ordered);assert.equal(new Set(expected).size,BUSINESS_TABLES.length);assert.ok(bytes(last)<131072);assert.ok(bytes(last.parents)<bytes(edges));
 // Synthetic checkpoint corruption stays inside the private test target; it
 // must be held before any business-row import or object-phase advancement.
 const invalid=[['negative',c=>{c.parents[0]=[-1];}],['fraction',c=>{c.parents[0]=[1.5];}],['overflow',c=>{c.parents[0]=[BUSINESS_TABLES.length];}],['unknown-name',c=>{c.parents=legacy(c.parents);c.parents[BUSINESS_TABLES[0]]=['unknown-table'];}],['extra-name',c=>{c.parents=legacy(c.parents);c.parents.unknown=[];}],['missing-name',c=>{c.parents=legacy(c.parents);delete c.parents[BUSINESS_TABLES[0]];}],['self',c=>{c.parents[0]=[0];}],['duplicate',c=>{c.parents[0]=[1,1];}],['wrong-length',c=>{c.parents.pop();}],['cycle',c=>{c.parents[0]=[1];c.parents[1]=[0];}],['legacy-cycle',c=>{c.parents=legacy(c.parents);c.parents[BUSINESS_TABLES[0]]=[BUSINESS_TABLES[1]];c.parents[BUSINESS_TABLES[1]]=[BUSINESS_TABLES[0]];}]];
 for(const [name,mutate] of invalid){const c=clone(last);mutate(c);save(target,c);const held=await step(target,c);assert.equal(held.kind,'held',name+': '+JSON.stringify(held));assert.equal(target.checkpoint().phase,'metadata');assert.equal(target.db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,0);}
 // Explicitly exercise a partial old map again after malformed-state cases.
 const oldPartial=clone(partial);oldPartial.parents=legacy(oldPartial.parents);save(target,oldPartial);const resumed=await step(target,oldPartial);assert.equal(resumed.kind,'progress');assert.ok(Array.isArray(target.checkpoint().parents));
 t.diagnostic(JSON.stringify({tables:BUSINESS_TABLES.length,indexedParentBytes:bytes(last.parents),legacyParentBytes:bytes(edges),savingsBytes:bytes(edges)-bytes(last.parents),maxMetadataCheckpointBytes:maxCheckpoint,legacyMidMetadataResume:true,legacyCompleteMetadataResume:true,rejected:invalid.map(([name])=>name),limitsUnchanged:true}));
});
