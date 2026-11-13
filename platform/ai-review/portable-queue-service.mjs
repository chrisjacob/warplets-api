import {canonicalJson,utf8} from '../security/canonical.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {createPortableReviewCodec} from './portable-review.mjs';
import {feedbackProjection,appealPayload,checkReportBinding} from './review-core.mjs';
import {ReviewQueueError} from './queue-error.mjs';
const fail=(status,code,message)=>{throw new ReviewQueueError(status,code,message);};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const snapshotSql=`SELECT s.id AS submission_id,s.wallet,s.token_id,s.url,s.submitted_ms,
 j.id AS job_id,j.state AS job_state,j.kind AS job_kind,j.previous_report_id,j.appeal_id,
 r.report_id,r.report_json,r.submission_id AS report_submission_id,r.job_id AS report_job_id,
 rj.submission_id AS report_job_submission_id,rj.kind AS report_job_kind,rj.previous_report_id AS report_job_previous_id,rj.appeal_id AS report_job_appeal_id,
 f.content_score AS final_score,f.reviewed_ms AS final_reviewed_ms,
 EXISTS(SELECT 1 FROM earn_boards WHERE epoch=s.epoch) AS board_closed,
 EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='public' OR status IN ('restoring','held')) AS write_disabled,
 a.appeal_id AS latest_appeal_id,a.report_id AS appealed_report_id,a.created_ms AS appeal_created_ms,
 EXISTS(SELECT 1 FROM ai_review_appeals used WHERE used.report_id=r.report_id) AS report_appealed
 FROM earn_submissions s
 LEFT JOIN ai_review_jobs j ON j.id=(SELECT latest.id FROM ai_review_jobs latest WHERE latest.submission_id=s.id AND NOT EXISTS(
  SELECT 1 FROM ai_review_reports parent JOIN ai_review_jobs child ON child.previous_report_id=parent.report_id WHERE parent.job_id=latest.id)
  ORDER BY latest.created_ms DESC,latest.id DESC LIMIT 1)
 LEFT JOIN ai_review_reports r ON r.report_id=COALESCE((SELECT own.report_id FROM ai_review_reports own WHERE own.job_id=j.id),j.previous_report_id)
 LEFT JOIN ai_review_jobs rj ON rj.id=r.job_id
 LEFT JOIN earn_reviews f ON f.submission_id=s.id
 LEFT JOIN ai_review_appeals a ON a.appeal_id=j.appeal_id
 WHERE s.id=? AND s.wallet=?`;
const unavailable=row=>row.final_score!==null?'final-review-recorded':row.board_closed?'board-closed':!row.report_id?'review-not-available':row.job_state!=='completed'?'review-in-progress':row.report_appealed?'appeal-already-submitted':null;

/** Owner actions only. No capture, provider, grant, settlement or final-review port exists here. */
export function createReviewFeedbackService({driver,crypto,clock}){
 if(typeof driver?.batch!=='function'||typeof crypto?.sha256!=='function'||typeof clock?.nowMs!=='function')throw new TypeError('Review feedback requires database, SHA-256 and clock ports.');
 const codec=createPortableReviewCodec({crypto}),hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 const identity=(principal,submissionId)=>{
  if(principal?.kind!=='wallet'||!id(principal.wallet))fail(401,'authentication_required','Connect your wallet.');
  if(!id(submissionId))fail(404,'submission_not_found','Submission not found.');
  return {wallet:principal.wallet,submissionId};
 };
 async function load(owner,requestKey){
  const statements=[sql(snapshotSql,owner.submissionId,owner.wallet)];
  if(requestKey!==undefined)statements.push(sql('SELECT request_digest,submission_id,report_id,appeal_id FROM ai_review_appeals WHERE wallet=? AND request_key=?',owner.wallet,requestKey));
  const results=await driver.batch(statements),row=results[0].rows[0];
  if(!row)fail(404,'submission_not_found','Submission not found.');
  return {row,prior:results[1]?.rows[0]??null};
 }
 async function verified(row){
  if(!row.report_id)return null;
  try{
   if(typeof row.report_json!=='string'||utf8(row.report_json).byteLength>131072)throw new TypeError('Stored report exceeds its private evidence bound.');
   const report=await codec.verifyReport(JSON.parse(row.report_json));
   checkReportBinding(report,{submission:{id:row.submission_id,token_id:row.token_id,url:row.url,submitted_ms:row.submitted_ms},record:{report_id:row.report_id,submission_id:row.report_submission_id,job_id:row.report_job_id},job:{id:row.report_job_id,submission_id:row.report_job_submission_id,kind:row.report_job_kind,previous_report_id:row.report_job_previous_id,appeal_id:row.report_job_appeal_id}});
   return report;
  }catch{fail(503,'review_evidence_unavailable','Verified review evidence is temporarily unavailable.');}
 }
 async function project(row){
  const report=await verified(row),reason=unavailable(row);
  return {submissionId:row.submission_id,status:row.job_state??(row.final_score!==null?'completed':'held'),feedback:report?{...feedbackProjection(report),appealAvailable:reason===null}:null,
   finalReview:row.final_score!==null?{score:row.final_score,reviewedAtMs:row.final_reviewed_ms}:null,
   appeal:{eligible:reason===null,reason,latest:row.latest_appeal_id?{appealId:row.latest_appeal_id,status:row.job_state==='completed'?'reviewed':'awaiting-independent-review',reportId:row.appealed_report_id,createdAt:new Date(row.appeal_created_ms).toISOString()}:null},paidCallsEnabled:false};
 }
 const replay=(prior,digest)=>{if(prior&&prior.request_digest!==digest)fail(409,'idempotency_conflict','This request key was already used for another appeal.');return !!prior;};
 return Object.freeze({
  async walletStatus(principal,submissionId){return project((await load(identity(principal,submissionId))).row);},
  async appeal(principal,{submissionId,reportId,reason,requestKey}){
   const owner=identity(principal,submissionId);
   if(!id(requestKey)||typeof reportId!=='string'||!/^[a-f0-9]{64}$/.test(reportId)||typeof reason!=='string'||!reason.trim()||reason!==reason.trim()||reason.length>2000)fail(400,'invalid_appeal','Supply the current report, a reason and an idempotency key.');
   const digest=await hash({submissionId,reportId,reason}),initial=await load(owner,requestKey);
   if(replay(initial.prior,digest))return {outcome:'replayed',review:await project(initial.row)};
   const report=await verified(initial.row),blocked=unavailable(initial.row);
   if(blocked)fail(409,blocked,'An appeal is not available for this review.');
   if(report.reportId!==reportId)fail(409,'review_changed','Appeal the latest review report.');
   if(initial.row.write_disabled)fail(409,'review_unavailable','Review changes are paused during recovery.');
   const time=clock.nowMs();if(!Number.isSafeInteger(time)||time<0)throw new TypeError('Invalid queue clock.');
   const payload=appealPayload(report,reason,new Date(time).toISOString()),appealId=await hash(payload),appeal={appealId,payload},json=canonicalJson(appeal),jobId='appeal:'+appealId;
   if(utf8(json).byteLength>16384)fail(400,'input_too_large','Appeal evidence exceeds its storage limit.');
   let changes=0,writeFailed=false;
   try{
    const result=await driver.batch([sql(`INSERT INTO ai_review_appeals(appeal_id,submission_id,report_id,job_id,wallet,request_key,request_digest,appeal_json,created_ms)
     SELECT ?,?,?,?,?,?,?,?,? FROM earn_submissions s JOIN ai_review_reports r ON r.submission_id=s.id JOIN ai_review_jobs j ON j.id=r.job_id
     WHERE s.id=? AND s.wallet=? AND s.token_id=? AND s.url=? AND s.submitted_ms=? AND r.report_id=? AND j.id=? AND j.state='completed'
      AND NOT EXISTS(SELECT 1 FROM earn_reviews WHERE submission_id=s.id)
      AND NOT EXISTS(SELECT 1 FROM earn_boards WHERE epoch=s.epoch)
      AND NOT EXISTS(SELECT 1 FROM ai_review_jobs child WHERE child.previous_report_id=r.report_id)
      AND NOT EXISTS(SELECT 1 FROM ai_review_appeals used WHERE used.report_id=r.report_id OR (used.wallet=? AND used.request_key=?))
      AND NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='public' OR status IN ('restoring','held'))`,appealId,submissionId,reportId,jobId,owner.wallet,requestKey,digest,json,time,
      submissionId,owner.wallet,initial.row.token_id,initial.row.url,initial.row.submitted_ms,reportId,initial.row.job_id,owner.wallet,requestKey)]);
    changes=Number(result[0].changes);
   }catch{writeFailed=true;}
   // A lost acknowledgement is reconciled from the immutable owner/key receipt.
   const after=await load(owner,requestKey);
   if(replay(after.prior,digest))return {outcome:changes>0?'created':'replayed',review:await project(after.row)};
   if(after.row.write_disabled)fail(409,'review_unavailable','Review changes are paused during recovery.');
   const changed=unavailable(after.row);if(changed)fail(409,changed,'An appeal is not available for this review.');
   if(after.row.report_id!==reportId)fail(409,'review_changed','Appeal the latest review report.');
   fail(writeFailed?503:409,writeFailed?'appeal_unavailable':'review_changed','The appeal could not be confirmed. Retry with the same request key.');
  },
 });
}
