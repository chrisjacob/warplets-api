import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {useCapability,useRuntimeQuery} from './capabilities';
import {client} from './sdk';
import {friendlyError,privateIntentKey,Loaded,Modal,utc} from './common';

const reviewPath='/api/v1/earn/submissions/{submissionId}/review';
const appealPath='/api/v1/earn/submissions/{submissionId}/appeals';
const feedbackModel=z.object({
 reportId:z.string(),submissionId:z.string(),label:z.string(),simulation:z.boolean(),
 suggestedScore:z.number().int().min(0).max(10),scoreMaximum:z.literal(10),
 status:z.enum(['ready-for-operator-review','needs-investigation']),rubricVersion:z.string(),summary:z.string(),
 criteria:z.array(z.object({id:z.string(),label:z.string(),score:z.number().int().min(0).max(5),maximum:z.literal(5),rationale:z.string(),improvement:z.string()})).max(20),
 uncertainty:z.enum(['low','medium','high']),reviewNeeded:z.boolean(),flags:z.array(z.string()),appealAvailable:z.boolean(),previousReportId:z.string().nullable(),financialExecution:z.literal(false),
});
export const earnReviewModel=z.object({
 submissionId:z.string(),status:z.enum(['awaiting-capture','ready','running','completed','failed','unknown','held']),
 feedback:feedbackModel.nullable(),finalReview:z.object({score:z.number().int().min(0).max(10),reviewedAtMs:z.number().int().nonnegative()}).nullable(),
 appeal:z.object({eligible:z.boolean(),reason:z.string().nullable(),latest:z.object({appealId:z.string(),status:z.enum(['awaiting-independent-review','reviewed']),reportId:z.string(),createdAt:z.iso.datetime()}).nullable()}),
 paidCallsEnabled:z.literal(false),
}).superRefine((value,ctx)=>{
 if(value.feedback&&value.feedback.submissionId!==value.submissionId)ctx.addIssue({code:'custom',message:'Review belongs to another submission.'});
 if(value.feedback?.simulation&&value.feedback.label!=='SIMULATION — not an AI judgment')ctx.addIssue({code:'custom',message:'Simulation label is missing.'});
});
type Review=z.infer<typeof earnReviewModel>;
const states:Record<Review['status'],[string,string]>={
 'awaiting-capture':['Waiting for source review','Your link is saved. The source material needs to be captured and checked before scoring can begin.'],
 ready:['Ready for review','Source material is ready. This status does not mean an AI model has scored your content.'],
 running:['Review in progress','A review attempt has started. A suggestion will appear only after its result is validated.'],
 completed:['Feedback ready','Read the suggestion below. Authorized final review decides the content score.'],
 failed:['Review needs attention','The latest attempt did not produce an accepted result. It has not been counted as a zero score.'],
 unknown:['Review delayed','An interrupted attempt is being checked before another review can proceed.'],
 held:['Review on hold','The review needs an operator check before it can continue.'],
};
const appealReasons:Record<string,string>={
 'final-review-recorded':'Appeals are closed because this submission has a final reviewed score.',
 'board-closed':'Appeals are closed for this reward day.',
 'review-not-available':'An appeal will be available when there is a review suggestion to reconsider.',
 'review-in-progress':'Wait for the current review to finish before requesting another review.',
 'appeal-already-submitted':'An appeal has already been submitted for this suggestion.',
};

function ReviewDialog({wallet,submissionId,onClose}:{wallet:string;submissionId:string;onClose:()=>void}){
 const cache=useQueryClient(),[reason,setReason]=useState('');
 const queryKey=['private',wallet,'solana','earn-review',submissionId];
 const query=useRuntimeQuery(reviewPath,{queryKey,retry:false,queryFn:async({signal})=>{
  const response=await client.getEarnReviewFeedback({path:{submissionId},signal});
  const result=earnReviewModel.parse(response.data);
  if(result.submissionId!==submissionId)throw Error('The review did not match this submission.');
  return result;
 }});
 const appealSupport=useCapability('POST',appealPath);
 const appeal=useMutation({mutationFn:async(body:{reportId:string;reason:string})=>{
  const pending=await privateIntentKey(wallet,'earn-review-appeal:'+submissionId,body);
  const response=await client.submitEarnReviewAppeal({path:{submissionId},body,idempotencyKey:pending.key});
  const result=earnReviewModel.parse(response.data);
  if(result.submissionId!==submissionId)throw Error('The appeal response did not match this submission.');
  pending.done();return result;
 },onSuccess:result=>{cache.setQueryData(queryKey,result);setReason('');void cache.invalidateQueries({queryKey:['private',wallet,'solana','submissions']});}});
 return <Modal title="Review & feedback" onClose={onClose}><Loaded query={query}>{review=>{
  const feedback=review.feedback,latest=review.appeal.latest;
  return <div className="submission-review">
   <div role="status"><h3>{review.finalReview&&!feedback?'Final review recorded':states[review.status][0]}</h3><p>{review.finalReview&&!feedback?'This submission was reviewed without a saved automated suggestion.':states[review.status][1]}</p></div>
   {review.finalReview&&<div className="review-final"><h3>Final reviewed score: {review.finalReview.score} / 10</h3><p>Reviewed {utc(new Date(review.finalReview.reviewedAtMs).toISOString())}. Eligibility and ranking still determine any award.</p></div>}
   {feedback?<><p className="fixture-label">{feedback.simulation?'SIMULATION — not an AI judgment':feedback.label}</p><h3>Suggested score: {feedback.suggestedScore} / {feedback.scoreMaximum}</h3><p>{feedback.summary}</p>
    {review.status!=='completed'&&<p>This is the most recent completed suggestion. The current review status is shown above.</p>}
    <p>{feedback.simulation?'This suggestion was generated by a deterministic simulation, not an AI model. ':''}A suggestion does not change your final score or rewards.{feedback.reviewNeeded?' The reviewer needs to investigate this suggestion.':''}</p>
    <details><summary>Scoring details & ways to improve</summary><ul className="review-criteria">{feedback.criteria.map(c=><li key={c.id}><h4>{c.label} · {c.score}/{c.maximum}</h4><p>{c.rationale}</p><p><strong>To improve:</strong> {c.improvement}</p></li>)}</ul><p>Reviewer confidence: {feedback.uncertainty}. Rubric: {feedback.rubricVersion}.</p></details>
   </>:<p>No review suggestion is available yet.</p>}
   <section className="review-appeal" aria-label="Review appeal"><h3>Request another review</h3>
    {latest&&<p role="status">{latest.status==='awaiting-independent-review'?'Appeal received — awaiting another review.':'Your appeal has been reviewed.'} Submitted {utc(latest.createdAt)}.</p>}
    <p>An appeal asks a reviewer to reconsider the suggestion. It does not change a final score, reopen a closed reward day or guarantee an award.</p>
    {review.appeal.eligible&&feedback&&appealSupport.allowed?<form className="member-form" onSubmit={event=>{
     event.preventDefault();if(query.isFetching||appeal.isPending||!reason.trim())return;
     appeal.mutate({reportId:feedback.reportId,reason:reason.trim()});
    }}><label>What should the reviewer reconsider?<textarea required maxLength={2000} rows={4} value={reason} onChange={event=>setReason(event.target.value)} aria-describedby="appeal-reason-help"/></label><p id="appeal-reason-help">Explain the issue or missing context. Up to 2,000 characters.</p><button disabled={query.isFetching||appeal.isPending||!reason.trim()}>{appeal.isPending?'Sending appeal…':'Send appeal'}</button></form>:!review.appeal.eligible?<p>{review.finalReview?appealReasons['final-review-recorded']:latest?.status==='awaiting-independent-review'?'Your current appeal is already in the review queue.':appealReasons[review.appeal.reason??'']??'An appeal is not available for this submission.'}</p>:<p role="status">Appeals are unavailable in this runtime.</p>}
    <output aria-live="polite">{appeal.isError?friendlyError(appeal.error):appeal.isSuccess?'Your appeal is saved.':''}</output>
   </section>
   <p className="review-note">Paid AI calls are disabled in this local app.</p><button disabled={query.isFetching||appeal.isPending} onClick={()=>void query.refetch()}>{query.isFetching?'Refreshing…':'Refresh review'}</button>
  </div>;
 }}</Loaded></Modal>;
}

export function SubmissionReview({wallet,submissionId}:{wallet:string;submissionId:string}){
 const [open,setOpen]=useState(false),support=useCapability('GET',reviewPath);
 if(!support.allowed)return null;
 return <div className="submission-review-action"><button onClick={()=>setOpen(true)}>Review & feedback</button>{open&&<ReviewDialog wallet={wallet} submissionId={submissionId} onClose={()=>setOpen(false)}/>}</div>;
}
