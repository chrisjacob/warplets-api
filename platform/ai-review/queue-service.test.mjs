import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,transaction} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicEarnRepository} from '../storage/atomic-earn.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {seed,start,command} from '../storage/fixtures/atomic-earn.mjs';
import {createNodeReviewQueueService} from './queue-service.mjs';
import {syntheticProvider,exampleJob} from './fixture.mjs';

const operator={kind:'operator',id:'synthetic-ai-operator'},wallet={kind:'wallet',wallet:'w1'};
async function setup(t){
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);await seed(driver,{limit:10});
 let time=start+100;db.function('review_fixture_clock',()=>time);db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(operator.id,'ai-review');
 const service=createNodeReviewQueueService(db,{clock:{nowMs:()=>time},leaseNowSql:'review_fixture_clock()'});
 const add=(id='synthetic-post',owner='w1',url='https://qa.invalid/'+id)=>{
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run(id,owner,'A',20001,url,start,'read-'+owner,id);
  return {...exampleJob,submissionId:id,tokenId:'A',url,capturedAt:new Date(time).toISOString()};
 };
 const capture=(job,jobId='submission:'+job.submissionId)=>service.capture(operator,{jobId,job,evidenceRef:'synthetic:trusted-source'});
 return {db,driver,service,add,capture,advance:ms=>time+=ms};
}

test('admission obligation is atomic, unique across command replay and rolls back with its source',async t=>{
 const f=await setup(t),repository=createAtomicEarnRepository(f.driver,{crypto:createNodeCrypto(),ids:{next:randomUUID}}),c=await command();
 const first=await repository.admitSubmission(c),again=await repository.admitSubmission(c);
 assert.equal(first.kind,'committed');assert.equal(again.kind,'replayed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_jobs').get().n,1);
 assert.throws(()=>transaction(f.db,()=>{f.add('rolled-back','w2');throw Error('rollback');}));
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE submission_id='rolled-back'").get().n,0);
});

test('trusted capture, simulated feedback and immutable records never finalize scores or awards',async t=>{
 const f=await setup(t),job=f.add();assert.equal(f.service.walletStatus(wallet,job.submissionId).status,'awaiting-capture');
 assert.equal(f.capture(job).outcome,'created');assert.equal(f.capture(job).outcome,'replayed');
 assert.throws(()=>f.capture({...job,content:job.content+' changed'}),e=>e.code==='capture_conflict');
 const result=await f.service.runOne(operator);assert.equal(result.outcome,'completed');
 const view=f.service.walletStatus(wallet,job.submissionId);assert.equal(view.status,'completed');assert.match(view.feedback.label,/SIMULATION/);assert.equal(view.feedback.criteria.length,4);assert.equal(view.appeal.eligible,true);assert.equal(view.paidCallsEnabled,false);
 assert.equal(JSON.stringify(view).includes(job.content),false);assert.equal(JSON.stringify(view).includes('systemPrompt'),false);assert.equal(view.finalReview,null);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,0);
 assert.throws(()=>f.db.prepare("UPDATE ai_review_reports SET report_json='{}'").run(),/Retain private/);
 assert.throws(()=>f.db.prepare("UPDATE ai_review_jobs SET state='ready',revision=revision+1").run(),/Retain terminal/);
 assert.equal((await f.service.runOne(operator)).outcome,'idle');
});

test('ownership, active scope and exact source binding cannot be supplied by creator input',async t=>{
 const f=await setup(t),job=f.add();
 for(const id of [job.submissionId,'missing'])assert.throws(()=>f.service.walletStatus({kind:'wallet',wallet:'w2'},id),e=>e.status===404&&e.code==='submission_not_found');
 assert.throws(()=>f.service.capture({...operator,id:'ungranted',scopes:['ai-review']},{jobId:'submission:'+job.submissionId,job,evidenceRef:'source'}),e=>e.code==='operator_scope_required');
 for(const altered of [{...job,url:'https://other.invalid/post'},{...job,tokenId:'different'},{...job,capturedAt:new Date(start-1).toISOString()},{...job,capturedAt:new Date(start+10000).toISOString()}])assert.throws(()=>f.capture(altered),e=>e.code==='capture_mismatch');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_captures').get().n,0);
});

test('real source capture is held and every nonsynthetic provider is rejected before dispatch',async t=>{
 const f=await setup(t),real=f.add('real-post','w1','https://example.com/post');let calls=0;
 assert.equal(f.capture({...real,content:'Real user-supplied material.'}).state,'held');
 assert.equal((await f.service.runOne(operator)).outcome,'idle');
 await assert.rejects(f.service.runOne(operator,{provider:{...syntheticProvider,kind:'model',provenance:'declared-local-adapter',evaluate(){calls++;}}}),e=>e.code==='paid_provider_disabled');
 assert.equal(calls,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_attempts').get().n,0);assert.equal(f.service.walletStatus(wallet,real.submissionId).feedback,null);
});

test('appeals are owner-bound, idempotent, latest-report-only and maintain complete lineage',async t=>{
 const f=await setup(t),job=f.add();f.capture(job);const original=await f.service.runOne(operator);f.advance(10);
 const input={submissionId:job.submissionId,reportId:original.reportId,reason:'Please reconsider the supporting example.',requestKey:'appeal-one'};
 assert.throws(()=>f.service.appeal({kind:'wallet',wallet:'w2'},input),e=>e.status===404);
 const created=f.service.appeal(wallet,input);assert.equal(created.outcome,'created');assert.equal(created.review.status,'awaiting-capture');assert.equal(created.review.feedback.reportId,original.reportId);assert.equal(created.review.appeal.eligible,false);assert.equal(created.review.feedback.appealAvailable,false);
 assert.equal(f.service.appeal(wallet,input).outcome,'replayed');
 assert.throws(()=>f.service.appeal(wallet,{...input,reason:'Different reason'}),e=>e.code==='idempotency_conflict');
 assert.throws(()=>f.service.appeal(wallet,{...input,requestKey:'another-key'}),e=>e.status===409);
 const appealId=created.review.appeal.latest.appealId;f.capture(job,'appeal:'+appealId);const revised=await f.service.runOne(operator);
 assert.equal(revised.outcome,'completed');assert.notEqual(revised.reportId,original.reportId);
 const report=JSON.parse(f.db.prepare('SELECT report_json FROM ai_review_reports WHERE report_id=?').get(revised.reportId).report_json);
 assert.deepEqual(report.payload.lineage,{previousReportId:original.reportId,appealId});
 const view=f.service.walletStatus(wallet,job.submissionId);assert.equal(view.feedback.reportId,revised.reportId);assert.equal(view.appeal.latest.status,'reviewed');
 assert.throws(()=>f.service.appeal(wallet,{...input,requestKey:'stale-report'}),e=>e.code==='review_changed');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_reports').get().n,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);
});

test('concurrent runs dispatch once; expired dispatched work becomes unknown and cannot accept a late result',async t=>{
 const f=await setup(t),job=f.add();f.capture(job);let release,calls=0;
 const provider={...syntheticProvider,async evaluate(request){calls++;await new Promise(resolve=>release=resolve);return syntheticProvider.evaluate(request);}};
 const pending=f.service.runOne(operator,{provider,leaseMs:1000,timeoutMs:900});await Promise.resolve();await Promise.resolve();
 assert.equal((await f.service.runOne(operator,{provider})).outcome,'idle');assert.equal(calls,1);
 f.advance(1001);assert.equal((await f.service.runOne(operator,{provider})).outcome,'idle');release();
 assert.equal((await pending).outcome,'unknown');assert.equal(f.service.walletStatus(wallet,job.submissionId).status,'unknown');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_reports').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_attempts').get().n,1);assert.equal(calls,1);
});

test('provider exception has a safe durable unknown outcome and is never retried',async t=>{
 const f=await setup(t),job=f.add();f.capture(job);let calls=0;
 const result=await f.service.runOne(operator,{provider:{...syntheticProvider,evaluate(){calls++;throw Error('secret API key and raw response');}}});
 assert.equal(result.outcome,'unknown');assert.equal((await f.service.runOne(operator)).outcome,'idle');assert.equal(calls,1);
 assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM ai_review_jobs').get()).includes('secret'),false);
 assert.equal(f.db.prepare('SELECT outcome FROM ai_review_attempts').get().outcome,'unknown');
});

test('revocation during evaluation fences the result; final human moderation stays authoritative',async t=>{
 const f=await setup(t),job=f.add();f.capture(job);
 const result=await f.service.runOne(operator,{provider:{...syntheticProvider,evaluate(request){f.db.prepare("UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator=? AND scope='ai-review'").run(operator.id);return syntheticProvider.evaluate(request);}}});
 assert.equal(result.outcome,'unknown');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_reports').get().n,0);
 f.db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(job.submissionId,4,'synthetic-moderator','Final human decision',start+101,'synthetic:review');
 const view=f.service.walletStatus(wallet,job.submissionId);assert.equal(view.finalReview.score,4);assert.equal(view.appeal.reason,'final-review-recorded');
});

test('final review rejects new appeals while exact accepted appeal replay remains available',async t=>{
 const f=await setup(t),job=f.add();f.capture(job);const report=await f.service.runOne(operator);
 const input={submissionId:job.submissionId,reportId:report.reportId,reason:'Reconsider this example.',requestKey:'appeal'};f.service.appeal(wallet,input);
 f.db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(job.submissionId,8,'synthetic-moderator','Final human decision',start+101,'synthetic:review');
 assert.equal(f.service.appeal(wallet,input).outcome,'replayed');
 assert.throws(()=>f.service.appeal(wallet,{...input,requestKey:'new-appeal'}),e=>e.code==='final-review-recorded');
 const closed=f.service.walletStatus(wallet,job.submissionId);assert.equal(closed.finalReview.score,8);assert.equal(closed.feedback.appealAvailable,false);
});

test('closed boards reject new capture and appeal without changing recorded suggestions',async t=>{
 const f=await setup(t),first=f.add();f.capture(first);const report=await f.service.runOne(operator);const other=f.add('other-post','w2');
 f.db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(20001,'[]',start+200,'synthetic-hash','synthetic:board');
 assert.throws(()=>f.capture(other),e=>e.code==='review_closed');
 assert.throws(()=>f.service.appeal(wallet,{submissionId:first.submissionId,reportId:report.reportId,reason:'Please reconsider.',requestKey:'closed'}),e=>e.code==='board-closed');
 assert.equal(f.service.walletStatus(wallet,first.submissionId).feedback.reportId,report.reportId);
});

test('Unicode capture limits use complete UTF8 bytes and reject oversized input without partial persistence',async t=>{
 const f=await setup(t),job=f.add(),unicode={...job,content:'SYNTHETIC '+ '\u754c'.repeat(19990),projectContext:'\u754c'.repeat(8000)};
 f.capture(unicode);const row=f.db.prepare('SELECT job_json FROM ai_review_captures').get();assert(Buffer.byteLength(row.job_json)>80000);assert(Buffer.byteLength(row.job_json)<=131072);assert.equal(JSON.parse(row.job_json).content,unicode.content);
 const result=await f.service.runOne(operator);assert.equal(result.outcome,'completed');
 const other=f.add('oversized','w2');assert.throws(()=>f.capture({...other,content:'SYNTHETIC '+ '\u754c'.repeat(20000)}),/exceeds bounds/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_captures').get().n,1);
 assert.throws(()=>f.service.appeal(wallet,{submissionId:job.submissionId,reportId:result.reportId,reason:'Please reconsider.',requestKey:'x'.repeat(129)}),e=>e.code==='invalid_appeal');
});

test('invalid captured job fails before invocation without inventing a zero score',async t=>{
 const f=await setup(t),job=f.add();let calls=0;
 // Simulate incomplete restored evidence: the runner must fail closed before dispatch.
 f.db.prepare("UPDATE ai_review_jobs SET state='ready',revision=revision+1 WHERE submission_id=?").run(job.submissionId);
 assert.equal((await f.service.runOne(operator,{provider:{...syntheticProvider,evaluate(){calls++;}}})).outcome,'failed');
 const view=f.service.walletStatus(wallet,job.submissionId);assert.equal(view.status,'failed');assert.equal(view.feedback,null);assert.equal(view.finalReview,null);assert.equal(calls,0);
});

test('SQL execution-time expiry after a successful lease read rolls back report and attempt completion',async t=>{
 const f=await setup(t),job=f.add();f.capture(job);let finishing=false,reads=0;
 f.db.function('review_fixture_clock',()=>finishing&&++reads>1?start+100000:start+100);
 const result=await f.service.runOne(operator,{provider:{...syntheticProvider,evaluate(request){finishing=true;return syntheticProvider.evaluate(request);}}});
 assert.equal(result.outcome,'unknown');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_reports').get().n,0);assert.equal(f.db.prepare('SELECT outcome FROM ai_review_attempts').get().outcome,'unknown');
});

test('dispatch refuses an outer transaction that could roll back its durable intent',async t=>{
 const f=await setup(t),job=f.add();f.capture(job);let pending;
 transaction(f.db,()=>{pending=f.service.runOne(operator);});
 await assert.rejects(pending,/independently committed/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_attempts').get().n,0);
});
