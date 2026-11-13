import {createHash} from 'node:crypto';
import {canonicalJson} from '../security/canonical.mjs';
import {RUBRIC_VERSION,PROMPT_VERSION,systemPrompt} from './rubric.mjs';
import {exact,requireReview as require,text,freeze,iso,id,normalizeJob,validateEvaluation,scoreEvaluation,disposition,checkReportEnvelope,checkReportBody,checkEvidenceHashes,feedbackProjection,appealPayload,checkAppealShape} from './review-core.mjs';
export {normalizeJob,validateEvaluation,scoreEvaluation} from './review-core.mjs';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonicalJson(v)).digest('hex');
export function verifyReport(value){
 const report=freeze(structuredClone(value));checkReportEnvelope(report);
 require(hash(report.payload)===report.reportId,'Review artifact integrity check failed.');
 const job=checkReportBody(report);checkEvidenceHashes(report,[hash(job),hash(job.content),hash(job.projectContext),hash(systemPrompt)]);
 return report;
}
/** Provider implementation is trusted server code. Content never selects a provider or tools. */
export async function evaluateSubmission({job,provider,nowMs=Date.now(),timeoutMs=30000,previousReport=null,appeal=null}){
 const j=normalizeJob(job);
 require(provider&&typeof provider.evaluate==='function'&&id(provider.id)&&id(provider.model)&&id(provider.version)&&['synthetic','model'].includes(provider.kind),'A named/versioned review provider is required.');
 require(['local-fixture','declared-local-adapter','operator-import'].includes(provider.provenance),'Declare provider provenance.');
 require(provider.responseFormat===undefined||provider.responseFormat==='evaluation-with-evidence-v1','Unsupported provider response format.');
 require((provider.kind==='synthetic')===(provider.provenance==='local-fixture'),'Synthetic results must identify fixture provenance.');
 if(provider.kind==='synthetic')require(new URL(j.url).hostname.endsWith('.invalid')&&j.content.startsWith('SYNTHETIC'),'Simulation requires an explicitly labelled .invalid fixture.');
 require(Number.isSafeInteger(nowMs)&&nowMs>=Date.parse(j.capturedAt)&&nowMs<=8640000000000000,'Review time cannot precede capture.');
 require(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=120000,'Invalid review timeout.');
 if(previousReport){verifyReport(previousReport);require(['submissionId','tokenId','url'].every(k=>previousReport.payload.capturedJob[k]===j[k])&&nowMs>=Date.parse(previousReport.payload.createdAt),'Previous report belongs to another submission.');}
 if(appeal){verifyAppeal(appeal);require(previousReport&&appeal.payload.reportId===previousReport.reportId&&nowMs>=Date.parse(appeal.payload.createdAt),'Appeal must refer to the previous report.');}
 const controller=new AbortController();let timer;
 try{
  const request=freeze({systemPrompt,rubricVersion:RUBRIC_VERSION,untrustedData:{contentType:j.contentType,content:j.content,projectContext:j.projectContext}});
  const response=await Promise.race([Promise.resolve().then(()=>provider.evaluate(request,{signal:controller.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Review provider timed out; no score was accepted.'));},timeoutMs);})]);
  const hasReceipt=provider.responseFormat==='evaluation-with-evidence-v1';
  if(hasReceipt)require(exact(response,['evaluation','providerEvidence'])&&response.providerEvidence!==null,'Supply an evaluation and its own provider receipt.');
  const evaluation=validateEvaluation(hasReceipt?response.evaluation:response,j),payload={kind:'10x.ai-review-suggestion.v1',rubricVersion:RUBRIC_VERSION,promptVersion:PROMPT_VERSION,promptHash:hash(systemPrompt),createdAt:new Date(nowMs).toISOString(),capturedJob:j,inputHash:hash(j),contentHash:hash(j.content),contextHash:hash(j.projectContext),provider:{id:provider.id,model:provider.model,version:provider.version,kind:provider.kind,provenance:provider.provenance},providerEvidence:hasReceipt?response.providerEvidence:null,simulation:provider.kind==='synthetic',evaluation,score:scoreEvaluation(evaluation),disposition:disposition(evaluation),requiresFinalReview:true,financialExecution:false,lineage:{previousReportId:previousReport?.reportId??null,appealId:appeal?.appealId??null}};
  return verifyReport({reportId:hash(payload),payload});
 }finally{clearTimeout(timer);}
}
export function creatorFeedback(report){return feedbackProjection(verifyReport(report));}
export function createAppeal({report,reason,createdAt}){const payload=appealPayload(verifyReport(report),reason,createdAt);return freeze({appealId:hash(payload),payload});}
export function verifyAppeal(value){const appeal=freeze(structuredClone(value));checkAppealShape(appeal);require(hash(appeal.payload)===appeal.appealId,'Appeal artifact integrity check failed.');return appeal;}
/** An INPUT DRAFT only: existing operator preview, confirmation, scope and revision guards still decide authorization. */
export function draftFinalReviewInput(report,{decision,allowSimulation=false}={}){
 const {payload:p,reportId}=verifyReport(report);require(decision==='accept-suggestion','Explicit reviewer acceptance is required.');
 require(p.disposition==='ready-for-operator-review','Investigate uncertainty/flags before finalizing; no draft is produced.');
 require(!p.simulation||allowSimulation===true,'Simulation cannot be mistaken for a model review.');
 return freeze({submissionId:p.capturedJob.submissionId,score:p.score,reason:((p.simulation?'SIMULATION ONLY: ':'Reviewed AI suggestion: ')+p.evaluation.summary).slice(0,256).trim(),sourceRef:'ai-review:'+reportId});
}

export function draftOperatorRequest(report,{decision,allowSimulation=false,expectedRevisions}={}){
 const input=draftFinalReviewInput(report,{decision,allowSimulation});
 require(exact(expectedRevisions,['earn','source','control'])&&Object.values(expectedRevisions).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v))),'Supply all three current revision strings.');
 return freeze({operationKind:'earn.final-review.v1',requestKey:input.submissionId,input,expectedRevisions:structuredClone(expectedRevisions)});
}
