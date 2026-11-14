import {createHash,randomUUID} from 'node:crypto';
import {transaction} from '../storage/database.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {normalizeJob,evaluateSubmission,verifyReport,creatorFeedback,createAppeal,verifyAppeal} from './review.mjs';
import {syntheticProvider} from './fixture.mjs';
import {checkReportBinding} from './review-core.mjs';
import {assertReviewRowRecoverable} from './queue-storage.mjs';

import {ReviewQueueError} from './queue-error.mjs';
export {ReviewQueueError} from './queue-error.mjs';
const fail=(status,code,message)=>{throw new ReviewQueueError(status,code,message);};
const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,256}$/.test(value);
const bounded=(value,max)=>{const json=canonicalJson(value);if(Buffer.byteLength(json)>max)fail(400,'input_too_large','Review evidence exceeds its storage limit.');return json;};
const isSynthetic=job=>new URL(job.url).hostname.endsWith('.invalid')&&job.content.startsWith('SYNTHETIC');

/** Local Node facade. The injected DB and SQL clock are trusted server dependencies, never request fields. */
export function createNodeReviewQueueService(db,{clock={nowMs:()=>Date.now()},leaseNowSql="CAST(unixepoch('subsec')*1000 AS INTEGER)"}={}){
 const now=()=>{const value=clock.nowMs();if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Invalid queue clock.');return value;};
 const dbNow=()=>Number(db.prepare(`SELECT ${leaseNowSql} AS now_ms`).get().now_ms);
 const operator=principal=>{
  if(principal?.kind!=='operator'||!validId(principal.id)||!db.prepare("SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='ai-review' AND enabled=1").get(principal.id))fail(403,'operator_scope_required','An active AI review operator grant is required.');
 };
 const owned=(principal,submissionId)=>{
  if(principal?.kind!=='wallet'||!validId(principal.wallet))fail(401,'authentication_required','Connect your wallet.');
  const row=validId(submissionId)&&db.prepare('SELECT * FROM earn_submissions WHERE id=? AND wallet=?').get(submissionId,principal.wallet);
  if(!row)fail(404,'submission_not_found','Submission not found.');return row;
 };
 const finalReview=id=>db.prepare('SELECT content_score,reviewed_ms FROM earn_reviews WHERE submission_id=?').get(id);
 const boardClosed=id=>!!db.prepare('SELECT 1 FROM earn_boards WHERE epoch=(SELECT epoch FROM earn_submissions WHERE id=?)').get(id);
 const latestJob=id=>db.prepare(`SELECT j.* FROM ai_review_jobs j WHERE j.submission_id=? AND NOT EXISTS(
  SELECT 1 FROM ai_review_reports r JOIN ai_review_jobs child ON child.previous_report_id=r.report_id WHERE r.job_id=j.id)
  ORDER BY j.created_ms DESC,j.id DESC LIMIT 1`).get(id);
 const readReport=id=>{const row=id&&db.prepare('SELECT report_json FROM ai_review_reports WHERE report_id=?').get(id);return row?verifyReport(JSON.parse(row.report_json)):null;};
 const ownReport=(job,submission)=>{
  try{
   const own=db.prepare('SELECT report_id FROM ai_review_reports WHERE job_id=?').get(job.id),report=readReport(own?.report_id??job.previous_report_id);
   if(report){const record=db.prepare('SELECT * FROM ai_review_reports WHERE report_id=?').get(report.reportId),sourceJob=db.prepare('SELECT * FROM ai_review_jobs WHERE id=?').get(record.job_id);checkReportBinding(report,{submission,record,job:sourceJob});}
   return report;
  }catch{fail(503,'review_evidence_unavailable','Verified review evidence is temporarily unavailable.');}
 };
 const eligible=(submissionId,job,report)=>finalReview(submissionId)?'final-review-recorded':boardClosed(submissionId)?'board-closed':!report?'review-not-available':job?.state!=='completed'?'review-in-progress':db.prepare('SELECT 1 FROM ai_review_appeals WHERE report_id=?').get(report.reportId)?'appeal-already-submitted':null;
 const view=(principal,submissionId)=>{
  const submission=owned(principal,submissionId),job=latestJob(submissionId),report=job?ownReport(job,submission):null,final=finalReview(submissionId);
  const appeal=job?.appeal_id?db.prepare('SELECT * FROM ai_review_appeals WHERE appeal_id=?').get(job.appeal_id):null;
  const reason=eligible(submissionId,job,report);
  return {submissionId,status:job?.state??(final?'completed':'held'),feedback:report?{...creatorFeedback(report),appealAvailable:reason===null}:null,
   finalReview:final?{score:final.content_score,reviewedAtMs:final.reviewed_ms}:null,
   appeal:{eligible:reason===null,reason,latest:appeal?{appealId:appeal.appeal_id,status:job.state==='completed'?'reviewed':'awaiting-independent-review',reportId:appeal.report_id,createdAt:new Date(appeal.created_ms).toISOString()}:null},paidCallsEnabled:false};
 };
 const leaseCurrent=lease=>db.prepare(`SELECT * FROM ai_review_jobs WHERE id=? AND state='running' AND lease_token=? AND revision=? AND lease_until_ms>${leaseNowSql}`).get(lease.id,lease.token,lease.revision);
 const endAttempt=(lease,outcome,time)=>db.prepare('UPDATE ai_review_attempts SET ended_ms=?,outcome=? WHERE job_id=? AND attempt=? AND lease_token=? AND ended_ms IS NULL').run(time,outcome,lease.id,lease.attempt,lease.token);
 const uncertain=(lease,reason)=>transaction(db,()=>{
  const row=db.prepare("SELECT * FROM ai_review_jobs WHERE id=? AND state='running' AND lease_token=? AND revision=?").get(lease.id,lease.token,lease.revision);
  if(!row)return false;const time=now();
  db.prepare("UPDATE ai_review_jobs SET state='unknown',lease_token=NULL,lease_until_ms=NULL,reason=?,updated_ms=?,revision=revision+1 WHERE id=?").run(reason,time,lease.id);
  endAttempt(lease,'unknown',time);return true;
 });
 const reconcileExpired=()=>{
  const expired=db.prepare(`SELECT * FROM ai_review_jobs WHERE state='running' AND lease_until_ms<=${leaseNowSql} LIMIT 100`).all();
  for(const row of expired){const dispatched=row.dispatched_ms!==null,time=now();
   db.prepare('UPDATE ai_review_jobs SET state=?,lease_token=NULL,lease_until_ms=NULL,reason=?,updated_ms=?,revision=revision+1 WHERE id=?').run(dispatched?'unknown':'ready',dispatched?'provider-outcome-unknown':null,time,row.id);
   endAttempt({id:row.id,token:row.lease_token,attempt:row.attempt},dispatched?'expired-unknown':'expired-unstarted',time);
  }
 };
 return Object.freeze({
  walletStatus(principal,submissionId){return transaction(db,()=>view(principal,submissionId));},
  capture(principal,{jobId,job,evidenceRef}){
   const normalized=normalizeJob(job),json=bounded(normalized,131072),digest=hash(normalized);
   if(!validId(jobId)||typeof evidenceRef!=='string'||!evidenceRef.trim()||evidenceRef!==evidenceRef.trim()||evidenceRef.length>512)fail(400,'invalid_capture','Supply a job ID and bounded capture evidence reference.');
   return transaction(db,()=>{
    operator(principal);const queue=db.prepare('SELECT * FROM ai_review_jobs WHERE id=?').get(jobId);
    if(!queue)fail(404,'job_not_found','Review job not found.');
    const submission=db.prepare('SELECT * FROM earn_submissions WHERE id=?').get(queue.submission_id),time=now();
    if(normalized.submissionId!==submission.id||normalized.tokenId!==submission.token_id||normalized.url!==submission.url||Date.parse(normalized.capturedAt)<submission.submitted_ms||Date.parse(normalized.capturedAt)>time)fail(409,'capture_mismatch','Captured evidence does not match this submission and time.');
    const previous=db.prepare('SELECT * FROM ai_review_captures WHERE job_id=?').get(jobId);
    if(previous){if(previous.input_hash!==digest||previous.evidence_ref!==evidenceRef||previous.captured_by!==principal.id)fail(409,'capture_conflict','This job already has different immutable evidence.');return {outcome:'replayed',jobId,state:queue.state};}
    if(queue.state!=='awaiting-capture')fail(409,'job_not_awaiting_capture','This job is not accepting a source capture.');
    if(finalReview(submission.id)||boardClosed(submission.id))fail(409,'review_closed','Final moderation or the board has already closed.');
    const synthetic=isSynthetic(normalized),state=synthetic?'ready':'held';
    db.prepare('INSERT INTO ai_review_captures(job_id,job_json,input_hash,evidence_ref,captured_by,created_ms) VALUES(?,?,?,?,?,?)').run(jobId,json,digest,evidenceRef,principal.id,time);
    assertReviewRowRecoverable(db,'ai_review_captures',jobId);
    db.prepare('UPDATE ai_review_jobs SET state=?,reason=?,updated_ms=?,revision=revision+1 WHERE id=?').run(state,synthetic?null:'provider-disabled',time,jobId);
    return {outcome:'created',jobId,state};
   });
  },
  appeal(principal,{submissionId,reportId,reason,requestKey}){
   if(!validId(requestKey)||requestKey.length>128||typeof reportId!=='string'||!/^[a-f0-9]{64}$/.test(reportId)||typeof reason!=='string'||!reason.trim()||reason!==reason.trim()||reason.length>2000)fail(400,'invalid_appeal','Supply the current report, a reason and an idempotency key.');
   const digest=hash({submissionId,reportId,reason});
   return transaction(db,()=>{
    const submission=owned(principal,submissionId);const prior=db.prepare('SELECT * FROM ai_review_appeals WHERE wallet=? AND request_key=?').get(principal.wallet,requestKey);
    if(prior){if(prior.request_digest!==digest)fail(409,'idempotency_conflict','This request key was already used for another appeal.');return {outcome:'replayed',review:view(principal,submissionId)};}
    const job=latestJob(submissionId),report=job?ownReport(job,submission):null,blocked=eligible(submissionId,job,report);
    if(blocked)fail(409,blocked,'An appeal is not available for this review.');
    if(report.reportId!==reportId)fail(409,'review_changed','Appeal the latest review report.');
    const time=now(),appeal=createAppeal({report,reason,createdAt:new Date(time).toISOString()}),jobId='appeal:'+appeal.appealId;
    if(time<Date.parse(report.payload.createdAt))fail(409,'invalid_appeal_time','Appeal time cannot precede the report.');
    db.prepare(`INSERT INTO ai_review_jobs(id,submission_id,kind,previous_report_id,appeal_id,state,created_ms,updated_ms) VALUES(?,?,'appeal',?,?,'awaiting-capture',?,?)`).run(jobId,submissionId,reportId,appeal.appealId,time,time);
    db.prepare('INSERT INTO ai_review_appeals(appeal_id,submission_id,report_id,job_id,wallet,request_key,request_digest,appeal_json,created_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(appeal.appealId,submissionId,reportId,jobId,principal.wallet,requestKey,digest,bounded(appeal,16384),time);
    return {outcome:'created',review:view(principal,submissionId)};
   });
  },
  async runOne(principal,{provider=syntheticProvider,jobId,leaseMs=30000,timeoutMs=10000}={}){
   if(db.isTransaction)throw new TypeError('Review dispatch requires an independently committed transaction.');
   operator(principal);
   if(provider?.kind!=='synthetic'||provider?.provenance!=='local-fixture')fail(403,'paid_provider_disabled','Only explicitly synthetic offline evaluation is enabled.');
   if((jobId!==undefined&&!validId(jobId))||!Number.isInteger(leaseMs)||leaseMs<100||leaseMs>30000||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>=leaseMs)fail(400,'invalid_run_limits','Use a bounded timeout shorter than the review lease.');
   const claimed=transaction(db,()=>{
    operator(principal);reconcileExpired();
    const row=jobId?db.prepare("SELECT * FROM ai_review_jobs WHERE id=? AND state='ready'").get(jobId):db.prepare("SELECT * FROM ai_review_jobs WHERE state='ready' ORDER BY created_ms,id LIMIT 1").get();
    if(!row)return null;
    if(finalReview(row.submission_id)||boardClosed(row.submission_id)){db.prepare("UPDATE ai_review_jobs SET state='held',reason='review-closed',updated_ms=?,revision=revision+1 WHERE id=?").run(now(),row.id);return {terminal:'held',id:row.id};}
    const capture=db.prepare('SELECT * FROM ai_review_captures WHERE job_id=?').get(row.id);
    let job;
    try{job=normalizeJob(JSON.parse(capture?.job_json));if(hash(job)!==capture.input_hash||!isSynthetic(job))throw new Error();}catch{db.prepare("UPDATE ai_review_jobs SET state='failed',reason='invalid-capture',updated_ms=?,revision=revision+1 WHERE id=?").run(now(),row.id);return {terminal:'failed',id:row.id};}
    const token=randomUUID(),time=now(),until=dbNow()+leaseMs,revision=row.revision+1,attempt=row.attempt+1;
    db.prepare("UPDATE ai_review_jobs SET state='running',revision=?,attempt=?,lease_token=?,lease_until_ms=?,dispatched_ms=NULL,reason=NULL,updated_ms=? WHERE id=?").run(revision,attempt,token,until,time,row.id);
    db.prepare('INSERT INTO ai_review_attempts(job_id,attempt,lease_token,started_ms) VALUES(?,?,?,?)').run(row.id,attempt,token,time);
    return {id:row.id,token,revision,attempt,expiresMs:until,job,previousReport:readReport(row.previous_report_id),appeal:row.appeal_id?verifyAppeal(JSON.parse(db.prepare('SELECT appeal_json FROM ai_review_appeals WHERE appeal_id=?').get(row.appeal_id).appeal_json)):null};
   });
   if(!claimed)return {outcome:'idle'};if(claimed.terminal)return {outcome:claimed.terminal,jobId:claimed.id};
   try{
    transaction(db,()=>{
     operator(principal);if(!leaseCurrent(claimed))fail(409,'lease_lost','The review lease is no longer current.');
     const time=now(),changed=db.prepare(`UPDATE ai_review_jobs SET dispatched_ms=?,updated_ms=?,revision=revision+1 WHERE id=? AND state='running' AND lease_token=? AND revision=? AND lease_until_ms>${leaseNowSql}`).run(time,time,claimed.id,claimed.token,claimed.revision).changes;
     if(Number(changed)!==1)fail(409,'lease_lost','The review lease expired before dispatch.');
     db.prepare('UPDATE ai_review_attempts SET dispatched_ms=? WHERE job_id=? AND attempt=? AND lease_token=?').run(time,claimed.id,claimed.attempt,claimed.token);
     if(dbNow()>=claimed.expiresMs)fail(409,'lease_lost','The review lease expired before dispatch commit.');
    });
    claimed.revision+=1;
    const report=await evaluateSubmission({job:claimed.job,provider,nowMs:now(),timeoutMs,previousReport:claimed.previousReport,appeal:claimed.appeal});
    return transaction(db,()=>{
     operator(principal);if(!leaseCurrent(claimed))fail(409,'lease_lost','The review lease expired before its result was accepted.');
     const time=now(),json=bounded(report,131072);
     db.prepare('INSERT INTO ai_review_reports(report_id,job_id,submission_id,report_json,created_ms) VALUES(?,?,?,?,?)').run(report.reportId,claimed.id,claimed.job.submissionId,json,time);
     assertReviewRowRecoverable(db,'ai_review_reports',report.reportId);
     const changed=db.prepare(`UPDATE ai_review_jobs SET state='completed',lease_token=NULL,lease_until_ms=NULL,reason=NULL,updated_ms=?,revision=revision+1 WHERE id=? AND state='running' AND lease_token=? AND revision=? AND lease_until_ms>${leaseNowSql}`).run(time,claimed.id,claimed.token,claimed.revision).changes;
     if(Number(changed)!==1)fail(409,'lease_lost','The review lease expired before its result write.');
     endAttempt(claimed,'completed',time);
     if(dbNow()>=claimed.expiresMs)fail(409,'lease_lost','The review lease expired before its result commit.');
     return {outcome:'completed',jobId:claimed.id,reportId:report.reportId};
    });
   }catch{
    uncertain(claimed,'provider-outcome-unknown');return {outcome:'unknown',jobId:claimed.id};
   }
  },
 });
}
