import {canonicalJson,utf8} from '../security/canonical.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {normalizeJob} from '../ai-review/review-core.mjs';
import {ReviewQueueError} from '../ai-review/queue-error.mjs';
import {supportedPost} from './supported-post.mjs';
import {readSupportedPost} from './post-source.mjs';
const fail=(status,code,message)=>{throw new ReviewQueueError(status,code,message);};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const query=`SELECT s.*,c.job_json,c.input_hash,c.created_ms AS captured_ms,
 EXISTS(SELECT 1 FROM earn_decisions d JOIN earn_boards b ON b.epoch=s.epoch JOIN json_each(b.winners) w
 WHERE d.submission_id=s.id AND d.qualified=1 AND json_extract(w.value,'$.wallet')=s.wallet AND json_extract(w.value,'$.submissionId')=s.id) AS published,
 EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='public' OR status IN ('restoring','held')) AS disabled
 FROM earn_submissions s LEFT JOIN ai_review_captures c ON s.wallet=? AND c.job_id=(
 SELECT j.id FROM ai_review_jobs j JOIN ai_review_captures capture ON capture.job_id=j.id
 WHERE j.submission_id=s.id ORDER BY capture.created_ms DESC,j.id DESC LIMIT 1) WHERE s.id=?`;
/** Owner captures are private. Other viewers receive only a fresh public-source
 * preview only for the exact qualified submission on the immutable final board.
 */
export function createPostContentService({driver,crypto,clock={nowMs:Date.now},fetcher=fetch}){
 async function load(wallet,id){
  const result=await driver.batch([sql(query,wallet,id)]),row=result[0].rows[0];
  if(!row||row.wallet!==wallet&&!row.published)fail(404,'submission_not_found','Submission not found.');
  if(row.disabled)fail(409,'review_unavailable','Post access is paused during recovery.');return row;
 }
 return Object.freeze({async walletContent(principal,submissionId){
  if(!validId(submissionId))fail(404,'submission_not_found','Submission not found.');
  const wallet=principal?.kind==='wallet'&&validId(principal.wallet)?principal.wallet:null,row=await load(wallet,submissionId);let post;
  try{post=supportedPost(row.url);}catch{}
  const base={submissionId,status:'unsupported',source:post?.source??null,canonicalUrl:post?.canonicalUrl??null,text:null,author:null,capturedAt:null,provenance:null,textComplete:false,mediaIncluded:false,automatedScoringEnabled:false,message:'This older submission uses an unsupported source. Its historical record is retained.'};
  if(row.wallet===wallet&&row.job_json){
   try{const job=normalizeJob(JSON.parse(row.job_json));if(job.submissionId!==row.id||job.tokenId!==row.token_id||job.url!==row.url||Date.parse(job.capturedAt)<row.submitted_ms||await crypto.sha256(utf8(canonicalJson(job)))!==row.input_hash)throw Error();
    await load(wallet,submissionId);return {...base,status:'captured',text:job.content,capturedAt:job.capturedAt,provenance:'operator-capture',textComplete:true,message:post?'Saved text used for review. Media is not included; automated scoring remains paused.':'Saved historical text. This source is not supported for new submissions; no external preview is loaded.'};
   }catch(error){if(error instanceof ReviewQueueError)throw error;fail(503,'review_evidence_unavailable','Verified captured text is temporarily unavailable.');}
  }
  if(!post)return base;
  let source;try{source=await readSupportedPost(row.url,{fetcher,crypto,clock});}catch{await load(wallet,submissionId);return {...base,status:'unavailable',message:'The public post could not be loaded. It may be private, deleted or temporarily unavailable. No score has been assigned.'};}
  await load(wallet,submissionId);
  return {...base,status:'preview',text:source.text,author:source.author,capturedAt:source.capturedAt,provenance:source.provenance,textComplete:source.textComplete,message:source.message};
 }});
}
