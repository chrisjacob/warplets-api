import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createReviewFeedbackService} from './portable-queue-service.mjs';
import {createNodeReviewQueueService} from './queue-service.mjs';
import {seedSyntheticReviewQueueFixture} from './queue-fixture.mjs';
import {evaluateSubmission} from './review.mjs';
import {syntheticProvider} from './fixture.mjs';
async function setup(t,{complete=true}={}){
 const db=openDatabase();t.after(()=>db.close());const f=await seedSyntheticReviewQueueFixture(db);let now=f.nowMs+1;
 db.function('portable_review_now',()=>now);const clock={nowMs:()=>now},node=createNodeReviewQueueService(db,{clock,leaseNowSql:'portable_review_now()'}),driver=createNodeAtomicDriver(db),crypto=createNodeCrypto();
 if(complete){node.capture(f.operator,f);assert.equal((await node.runOne(f.operator)).outcome,'completed');}
 const service=createReviewFeedbackService({driver,crypto,clock});
 const input=()=>({submissionId:f.submissionId,reportId:db.prepare('SELECT report_id FROM ai_review_reports WHERE submission_id=?').get(f.submissionId).report_id,reason:'Please reconsider the supporting example.',requestKey:'portable-appeal'});
 return {...f,db,node,driver,crypto,clock,service,input,advance:ms=>now+=ms};
}

test('portable owner views match Node pending/completed/appealed/final DTOs without private evidence',async t=>{
 const f=await setup(t,{complete:false});assert.deepEqual(await f.service.walletStatus(f.principal,f.submissionId),f.node.walletStatus(f.principal,f.submissionId));
 f.node.capture(f.operator,f);await f.node.runOne(f.operator);const before=await f.service.walletStatus(f.principal,f.submissionId);assert.deepEqual(before,f.node.walletStatus(f.principal,f.submissionId));
 assert.equal(JSON.stringify(before).includes(f.job.content),false);
 const result=await f.service.appeal(f.principal,f.input());assert.equal(result.outcome,'created');assert.deepEqual(result.review,f.node.walletStatus(f.principal,f.submissionId));
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").get().n,1);
 assert.equal((await f.service.appeal(f.principal,f.input())).outcome,'replayed');
 await assert.rejects(f.service.appeal(f.principal,{...f.input(),reason:'Changed reason'}),e=>e.code==='idempotency_conflict');
 f.db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(f.submissionId,7,'synthetic-final-reviewer','Final decision',f.clock.nowMs(),'synthetic:final');
 assert.deepEqual(await f.service.walletStatus(f.principal,f.submissionId),f.node.walletStatus(f.principal,f.submissionId));
});

test('portable read/appeal refuses foreign wallets and a lost write reply replays exactly one obligation',async t=>{
 const f=await setup(t);for(const submissionId of [f.submissionId,'missing'])await assert.rejects(f.service.walletStatus({kind:'wallet',wallet:'foreign'},submissionId),e=>e.status===404);
 await assert.rejects(f.service.appeal({kind:'wallet',wallet:'foreign'},f.input()),e=>e.status===404);
 let dropped=false;const service=createReviewFeedbackService({...f,driver:{...f.driver,async batch(statements){const result=await f.driver.batch(statements);if(!dropped&&statements[0].sql.startsWith('INSERT INTO ai_review_appeals')){dropped=true;throw Error('lost acknowledgement');}return result;}}});
 assert.equal((await service.appeal(f.principal,f.input())).outcome,'replayed');assert.equal((await service.appeal(f.principal,f.input())).outcome,'replayed');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').get().n,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").get().n,1);
});

for(const boundary of ['final-review','closed-board','recovery'])test('SQL write rechecks '+boundary+' after awaited report verification',async t=>{
 const f=await setup(t);let read=false,injected=false;
 const driver={...f.driver,async batch(statements){const result=await f.driver.batch(statements);if(statements[0].sql.includes('FROM earn_submissions s'))read=true;return result;}};
 const crypto={...f.crypto,async sha256(bytes){if(read&&!injected){injected=true;
  if(boundary==='final-review')f.db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(f.submissionId,6,'synthetic-final-reviewer','Final decision',f.clock.nowMs(),'synthetic:final');
  if(boundary==='closed-board')f.db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(Math.floor(f.nowMs/86400000),'[]',f.clock.nowMs(),'synthetic-hash','synthetic:closed');
  if(boundary==='recovery')f.db.prepare("UPDATE app_recovery_state SET mode='private',status='held'").run();
 }return f.crypto.sha256(bytes);}};
 const service=createReviewFeedbackService({...f,driver,crypto});await assert.rejects(service.appeal(f.principal,f.input()),e=>e.status===409);
 assert(injected);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').get().n,0);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").get().n,0);
});

test('racing identical appeal requests converge on one receipt and child job',async t=>{
 const f=await setup(t),results=await Promise.all([f.service.appeal(f.principal,f.input()),f.service.appeal(f.principal,f.input())]);
 assert.deepEqual(results.map(r=>r.outcome).sort(),['created','replayed']);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').get().n,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").get().n,1);
});

test('valid standalone artifact with the wrong source binding is withheld by Node and portable views',async t=>{
 const f=await setup(t,{complete:false});const report=await evaluateSubmission({job:{...f.job,tokenId:'synthetic-other-token'},provider:syntheticProvider,nowMs:f.clock.nowMs()});
 f.db.prepare('INSERT INTO ai_review_reports VALUES(?,?,?,?,?)').run(report.reportId,f.jobId,f.submissionId,JSON.stringify(report),f.clock.nowMs());
 f.db.prepare("UPDATE ai_review_jobs SET state='completed',revision=revision+1 WHERE id=?").run(f.jobId);
 await assert.rejects(f.service.walletStatus(f.principal,f.submissionId),e=>e.status===503&&e.code==='review_evidence_unavailable');
 assert.throws(()=>f.node.walletStatus(f.principal,f.submissionId),e=>e.status===503&&e.code==='review_evidence_unavailable');
 await assert.rejects(f.service.appeal(f.principal,f.input()),e=>e.status===503);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').get().n,0);
});
