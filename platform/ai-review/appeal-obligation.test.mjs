import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {seedSyntheticReviewQueueFixture} from './queue-fixture.mjs';
import {createNodeReviewQueueService} from './queue-service.mjs';
import {createAppeal} from './review.mjs';
import {canonicalJson} from '../security/canonical.mjs';

async function fixture(t){
 const db=openDatabase();t.after(()=>db.close());const f=await seedSyntheticReviewQueueFixture(db),service=createNodeReviewQueueService(db);
 service.capture(f.operator,f);const result=await service.runOne(f.operator,{jobId:f.jobId});assert.equal(result.outcome,'completed');
 const report=JSON.parse(db.prepare('SELECT report_json FROM ai_review_reports WHERE report_id=?').get(result.reportId).report_json),time=Date.now();
 const appeal=createAppeal({report,reason:'SYNTHETIC appeal obligation test',createdAt:new Date(time).toISOString()}),jobId='appeal:'+appeal.appealId;
 const insert=({wallet=f.principal.wallet,job=jobId}={})=>db.prepare('INSERT INTO ai_review_appeals VALUES(?,?,?,?,?,?,?,?,?)').run(appeal.appealId,f.submissionId,report.reportId,job,wallet,'synthetic-appeal','a'.repeat(64),canonicalJson(appeal),time);
 return {db,f,appeal,jobId,insert};
}
test('one appeal statement creates its exact child before immediate foreign-key validation',async t=>{
 const {db,f,appeal,jobId,insert}=await fixture(t);insert();const job=db.prepare('SELECT * FROM ai_review_jobs WHERE id=?').get(jobId);
 assert.equal(job.submission_id,f.submissionId);assert.equal(job.appeal_id,appeal.appealId);assert.equal(job.previous_report_id,appeal.payload.reportId);assert.equal(job.state,'awaiting-capture');
 assert.throws(()=>insert(),/UNIQUE/);assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").get().n,1);
});
test('mismatched source or failed child insertion rolls back the appeal and its watermark',async t=>{
 const {db,insert}=await fixture(t),watermark=()=>db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,before=watermark();
 for(const input of [{wallet:'different-wallet'},{job:'appeal:wrong-id'}])assert.throws(()=>insert(input),/binding mismatch/);
 assert.equal(watermark(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').get().n,0);
 db.exec("CREATE TRIGGER synthetic_child_failure BEFORE INSERT ON ai_review_jobs WHEN NEW.kind='appeal' BEGIN SELECT RAISE(ABORT,'synthetic child failure'); END;");
 assert.throws(()=>insert(),/synthetic child failure/);assert.equal(watermark(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").get().n,0);
});
