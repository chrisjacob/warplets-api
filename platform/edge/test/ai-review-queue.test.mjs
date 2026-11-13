import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {start,command,seed} from '../../storage/fixtures/atomic-earn.mjs';
import {BUSINESS_TABLES} from '../../recovery/schema.mjs';
const privateTables=['ai_review_jobs','ai_review_captures','ai_review_reports','ai_review_appeals','ai_review_attempts'];

test('workerd/D1 atomically creates one durable review obligation through concurrent admission, replay and rollback',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/atomic-earn-worker.ts',import.meta.url));
 await seed({batch:statements=>db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.values)))},{limit:2});
 const call=async(c,fault)=>{const response=await mf.dispatchFetch('http://localhost/command',{method:'POST',body:JSON.stringify({method:'admitSubmission',command:c,fault})});return {status:response.status,...await response.json()};};
 const c=await command();assert.equal((await call(c,'skip-child')).status,500);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_jobs').first('n'),0);
 const concurrent=await Promise.all([call(c),call(c)]);assert.deepEqual(concurrent.map(x=>x.result.kind).sort(),['committed','replayed']);
 const source=await db.prepare('SELECT * FROM earn_submissions').first(),job=await db.prepare('SELECT * FROM ai_review_jobs').first();
 assert.equal(job.id,'submission:'+source.id);assert.equal(job.submission_id,source.id);assert.equal(job.state,'awaiting-capture');assert.equal(job.kind,'initial');assert.equal(job.attempt,0);assert.equal(job.created_ms,source.submitted_ms);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_jobs').first('n'),1);
 await assert.rejects(db.batch([
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').bind('synthetic-rollback','w2','A',20001,'https://qa.invalid/rollback',start,'read-w2','synthetic-rollback'),
  db.prepare("INSERT INTO earn_fixture_campaigns VALUES('A',?,'1000000')").bind(start),
 ]),/UNIQUE/);
 assert.equal(await db.prepare("SELECT COUNT(*) n FROM earn_submissions WHERE id='synthetic-rollback'").first('n'),0);
 assert.equal(await db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE submission_id='synthetic-rollback'").first('n'),0);
 const lost=await call(await command('w2'),'lost-response');assert.equal(lost.result.kind,'replayed');
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_submissions').first('n'),2);assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_jobs').first('n'),2);

 for(const table of privateTables)assert(BUSINESS_TABLES.includes(table),'Private recovery inventory omits '+table);
 const watermark=()=>db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first('revision');
 const tracked=async(statement)=>{const before=await watermark();await statement.run();assert.equal(await watermark(),before+1);};
 await tracked(db.prepare('INSERT INTO ai_review_captures VALUES(?,?,?,?,?,?)').bind(job.id,'{"synthetic":true}','c'.repeat(64),'synthetic:source','synthetic-reviewer',start));
 await tracked(db.prepare("UPDATE ai_review_jobs SET state='running',lease_token='synthetic-lease',lease_until_ms=?,revision=revision+1 WHERE id=?").bind(start+1000,job.id));
 await tracked(db.prepare('INSERT INTO ai_review_attempts(job_id,attempt,lease_token,started_ms) VALUES(?,?,?,?)').bind(job.id,1,'synthetic-lease',start));
 await tracked(db.prepare('INSERT INTO ai_review_reports VALUES(?,?,?,?,?)').bind('d'.repeat(64),job.id,source.id,'{"synthetic":true}',start));
 const appealJob='appeal:'+'e'.repeat(64);
 await tracked(db.prepare("INSERT INTO ai_review_jobs(id,submission_id,kind,previous_report_id,appeal_id,state,created_ms,updated_ms) VALUES(?,?,'appeal',?,?,'awaiting-capture',?,?)").bind(appealJob,source.id,'d'.repeat(64),'e'.repeat(64),start,start));
 await tracked(db.prepare('INSERT INTO ai_review_appeals VALUES(?,?,?,?,?,?,?,?,?)').bind('e'.repeat(64),source.id,'d'.repeat(64),appealJob,'w1','synthetic-appeal','f'.repeat(64),JSON.stringify({appealId:'e'.repeat(64),payload:{kind:'10x.ai-review-appeal.v1',reportId:'d'.repeat(64),submissionId:source.id}}),start));
 const beforeOversize=await watermark();
 await assert.rejects(db.prepare('INSERT INTO ai_review_captures VALUES(?,?,?,?,?,?)').bind(appealJob,JSON.stringify({synthetic:'\u754c'.repeat(50000)}),'a'.repeat(64),'synthetic:oversize','synthetic-reviewer',start).run(),/CHECK/);
 assert.equal(await watermark(),beforeOversize,'Rejected UTF8 evidence cannot advance the snapshot watermark');
 for(const table of ['ai_review_captures','ai_review_reports','ai_review_appeals'])await assert.rejects(db.prepare('DELETE FROM '+table).run(),/Retain private review evidence/);
 await db.prepare("UPDATE app_recovery_state SET mode='public',status='held' WHERE id=1").run();
 for(const table of privateTables)await assert.rejects(db.prepare('INSERT INTO '+table+' SELECT * FROM '+table+' LIMIT 1').run(),/mutation-disabled/);
});

test('actual application Worker advertises owner feedback and appeals while keeping financial execution disabled',async t=>{
 const {mf}=await localRuntime(t,new URL('../src/worker.ts',import.meta.url));
 const capabilities=await (await mf.dispatchFetch('http://localhost/api/v1/capabilities')).json();
 assert.equal(capabilities.features.some(f=>f.id==='earn-review-feedback'),true);assert.equal(capabilities.production.financialExecution,false);
 const spec=await (await mf.dispatchFetch('http://localhost/api/v1/openapi.json')).json();
 assert.equal(Object.hasOwn(spec.paths,'/earn/submissions/{submissionId}/review'),true);assert.equal(Object.hasOwn(spec.paths,'/earn/submissions/{submissionId}/appeals'),true);
 assert.equal((await mf.dispatchFetch('http://localhost/api/v1/earn/submissions/synthetic/review')).status,401);
 assert.equal((await mf.dispatchFetch('http://localhost/api/v1/earn/submissions/synthetic/appeals',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:'{}'})).status,401);
});
