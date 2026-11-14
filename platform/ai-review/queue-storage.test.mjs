import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,transaction} from '../storage/database.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {RECOVERY_V2_LIMITS} from '../recovery/v2-codec.mjs';
import {planRecoveryV2Rows,materializeRecoveryV2Rows} from '../recovery/v2-planning.mjs';
import {seedSyntheticReviewQueueFixture} from './queue-fixture.mjs';
import {createNodeReviewQueueService} from './queue-service.mjs';
import {assertReviewRowRecoverable} from './queue-storage.mjs';
import {evaluateSubmission} from './review.mjs';
import {syntheticProvider} from './fixture.mjs';

const byteLength=value=>utf8(canonicalJson(value)).length;
const prefix='SYNTHETIC ',fill=character=>prefix+character.repeat(20000-prefix.length-1)+'Z';
const controls=count=>prefix+'\u0001'.repeat(count)+'A'.repeat(20000-prefix.length-count);
async function setup(t){
 const db=openDatabase();t.after(()=>db.close());
 const f=await seedSyntheticReviewQueueFixture(db,{nowMs:1794600000000,suffix:'00000000-0000-4000-8000-000000000000'}),time=f.nowMs+1;
 db.function('synthetic_storage_clock',()=>time);
 return {...f,db,time,service:createNodeReviewQueueService(db,{clock:{nowMs:()=>time},leaseNowSql:'synthetic_storage_clock()'})};
}
function descriptor(db,name){
 const fields=db.prepare('SELECT name,pk FROM pragma_table_info(?) ORDER BY cid').all(name);
 return {name,columns:fields.map(field=>field.name),primaryKey:fields.filter(field=>field.pk).sort((a,b)=>a.pk-b.pk).map(field=>field.name),hasRowid:true};
}
function recovered(db,name,id){
 const table=descriptor(db,name),key=name==='ai_review_captures'?'job_id':'report_id',column=name==='ai_review_captures'?'job_json':'report_json';
 const stored=db.prepare(`SELECT rowid,* FROM ${name} WHERE ${key}=?`).get(id),row=[stored.rowid,...table.columns.map(column=>stored[column])];
 const measured=transaction(db,()=>assertReviewRowRecoverable(db,name,id));
 let firstPageBytes;
 for(const boundary of [{index:0},{index:RECOVERY_V2_LIMITS.objects-1,after:[Number.MIN_SAFE_INTEGER]}]){
  const plan=planRecoveryV2Rows(table,boundary),query=db.prepare(plan.statement.sql).all(...plan.statement.values);
  const page=materializeRecoveryV2Rows(plan,query);
  assert.deepEqual(page.value.rows,[row]);assert.equal(JSON.stringify(JSON.parse(stored[column])),JSON.stringify(JSON.parse(page.value.rows[0][table.columns.indexOf(column)+1])));
  assert.ok(byteLength(page.value)<=RECOVERY_V2_LIMITS.pageBytes);
  if(boundary.index===0)firstPageBytes=byteLength(page.value);
  else{
   const reserved=[Number.MIN_SAFE_INTEGER+1,...row.slice(1)],reservedPage=materializeRecoveryV2Rows(plan,[{row_json:canonicalJson(reserved),cursor_json:canonicalJson([reserved[0]]),row_bytes:byteLength(reserved),excluded:0}]);
   assert.equal(byteLength(reservedPage.value),measured.maxPageBytes);
  }
 }
 return {storedJsonBytes:utf8(stored[column]).length,firstPageBytes,...measured};
}

for(const [name,content,projectContext] of [
 ['normal maximum text',fill('A'),'B'.repeat(8000)],
 ['multibyte maximum text',fill('\u754c'),'\u754c'.repeat(8000)],
 ['escaped maximum text',fill('"'),'\\'.repeat(8000)],
 ['near-bound control characters',controls(16127),'B'.repeat(8000)],
])test('recoverable capture and report: '+name,async t=>{
 const f=await setup(t),job={...f.job,content,projectContext};assert.equal(job.content.length,20000);assert.equal(job.projectContext.length,8000);
 assert.equal(f.service.capture(f.operator,{...f,job}).outcome,'created');
 assert.equal(f.db.prepare('SELECT job_json FROM ai_review_captures').get().job_json,canonicalJson(job));
 const result=await f.service.runOne(f.operator,{jobId:f.jobId});assert.equal(result.outcome,'completed');
 const capture=recovered(f.db,'ai_review_captures',f.jobId),report=recovered(f.db,'ai_review_reports',result.reportId);
 if(name.startsWith('near-bound'))assert.equal(report.maxPageBytes,131072);
 const view=f.service.walletStatus(f.principal,f.submissionId),serialized=canonicalJson(view);
 assert.equal(serialized.includes(content),false);assert.equal(serialized.includes(projectContext),false);assert.equal(view.finalReview,null);assert.match(view.feedback.label,/SIMULATION/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,0);
 t.diagnostic(JSON.stringify({case:name,capture,report}));
});

for(const count of [17049,18000])test('oversized escaped capture rolls back its row, job and watermark without truncating input: '+count,async t=>{
 const f=await setup(t),job={...f.job,content:controls(count),projectContext:'B'.repeat(8000)},before=canonicalJson(job);
 assert.ok(byteLength(job)<131072);
 const jobBefore=f.db.prepare('SELECT * FROM ai_review_jobs').get(),watermark=f.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').get().revision;
 assert.throws(()=>f.service.capture(f.operator,{...f,job}),error=>error.status===413&&error.code==='input_too_large'&&!error.message.includes(job.content));
 assert.equal(canonicalJson(job),before);assert.deepEqual(f.db.prepare('SELECT * FROM ai_review_jobs').get(),jobBefore);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_captures').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_attempts').get().n,0);
 assert.equal(f.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').get().revision,watermark);
 assert.equal(f.service.walletStatus(f.principal,f.submissionId).status,'awaiting-capture');assert.equal((await f.service.runOne(f.operator)).outcome,'idle');
 // An operator can provide a new, complete bounded capture after rejection.
 assert.equal(f.service.capture(f.operator,{...f,job:f.job}).outcome,'created');
});

for(const count of [16128,17000])test('report-only overflow retains recoverable source, rolls back immutable report and records dispatched uncertainty once: '+count,async t=>{
 const f=await setup(t),job={...f.job,content:controls(count),projectContext:'B'.repeat(8000)};
 assert.equal(f.service.capture(f.operator,{...f,job}).outcome,'created');const capture=recovered(f.db,'ai_review_captures',f.jobId);
 const report=await evaluateSubmission({job,provider:syntheticProvider,nowMs:f.time}),json=canonicalJson(report),table=descriptor(f.db,'ai_review_reports');
 const prospective={report_id:report.reportId,job_id:f.jobId,submission_id:f.submissionId,report_json:json,created_ms:f.time};
 const row=[1,...table.columns.map(column=>prospective[column])],plan=planRecoveryV2Rows(table,{index:0});
 const continued=planRecoveryV2Rows(table,{index:RECOVERY_V2_LIMITS.objects-1,after:[Number.MIN_SAFE_INTEGER]}),reservedRow=[Number.MIN_SAFE_INTEGER+1,...row.slice(1)];
 assert.ok(utf8(json).length<131072);assert.ok(byteLength(reservedRow)>continued.budget);
 assert.equal(byteLength(row)<=plan.budget,count===16128);
 let calls=0;const provider={...syntheticProvider,evaluate(request){calls++;return syntheticProvider.evaluate(request);}};
 assert.deepEqual(await f.service.runOne(f.operator,{jobId:f.jobId,provider}),{outcome:'unknown',jobId:f.jobId});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_reports').get().n,0);
 assert.equal(f.db.prepare('SELECT job_json FROM ai_review_captures').get().job_json,canonicalJson(job));
 const attempt=f.db.prepare('SELECT * FROM ai_review_attempts').get(),queue=f.db.prepare('SELECT * FROM ai_review_jobs').get();
 assert.equal(attempt.outcome,'unknown');assert.equal(attempt.dispatched_ms,f.time);assert.equal(attempt.ended_ms,f.time);
 assert.equal(queue.state,'unknown');assert.equal(queue.dispatched_ms,f.time);assert.equal(queue.lease_token,null);assert.equal(queue.lease_until_ms,null);
 assert.equal((await f.service.runOne(f.operator,{jobId:f.jobId,provider})).outcome,'idle');assert.equal(calls,1);
 const view=f.service.walletStatus(f.principal,f.submissionId);assert.equal(view.status,'unknown');assert.equal(view.feedback,null);assert.equal(view.finalReview,null);assert.equal(view.appeal.eligible,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,0);
 t.diagnostic(JSON.stringify({case:'report-only overflow '+count,capture,rejectedReport:{storedJsonBytes:utf8(json).length,actualRowBytes:byteLength(row),firstPageBytes:byteLength({...plan.header,rows:[row]}),maxPageBytes:byteLength({...continued.header,rows:[reservedRow]}),pageLimit:plan.limit}}));
});

test('preflight requires the owning transaction and only known evidence tables',async t=>{
 const f=await setup(t);
 assert.throws(()=>assertReviewRowRecoverable(f.db,'ai_review_captures',f.jobId),/write transaction/);
 assert.throws(()=>transaction(f.db,()=>assertReviewRowRecoverable(f.db,'earn_submissions',f.submissionId)),/Unsupported review storage table/);
 assert.throws(()=>transaction(f.db,()=>assertReviewRowRecoverable(f.db,'ai_review_captures',f.jobId)),/inserted row/);
});
