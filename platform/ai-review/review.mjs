import {createHash} from 'node:crypto';
import {canonicalJson} from '../security/canonical.mjs';
import {RUBRIC_VERSION,PROMPT_VERSION,dimensions,reviewFlags,systemPrompt} from './rubric.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const require=(condition,message)=>{if(!condition)throw new TypeError(message);};
const text=(v,max=1000)=>typeof v==='string'&&v.trim().length>0&&v===v.trim()&&v.length<=max;
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonicalJson(v)).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
export function normalizeJob(value){
 require(exact(value,['submissionId','tokenId','url','capturedAt','contentType','content','projectContext']),'Supply the exact review job fields.');
 const j=structuredClone(value);require(id(j.submissionId)&&id(j.tokenId),'Invalid submission or token ID.');
 const url=new URL(j.url);require(url.protocol==='https:'&&!url.username&&!url.password&&j.url.length<=2048,'Use a bounded HTTPS source URL.');
 require(iso(j.capturedAt),'Supply an ISO UTC capture time.');
 require(['text','transcript'].includes(j.contentType),'Only captured text or transcripts can be reviewed.');
 require(text(j.content,20000)&&text(j.projectContext,8000),'Captured content/context is empty or exceeds bounds.');
 return freeze(j);
}
export function validateEvaluation(value,job){
 const j=normalizeJob(job),v=structuredClone(value);
 require(exact(v,['rubricVersion','criteria','summary','confidence','flags','verification']),'Unexpected evaluation fields.');
 require(v.rubricVersion===RUBRIC_VERSION&&v.verification==='provided-material-only','Incorrect rubric or unsupported verification claim.');
 require(['low','medium','high'].includes(v.confidence)&&text(v.summary,600),'Invalid confidence or summary.');
 require(Array.isArray(v.flags)&&v.flags.length<=reviewFlags.length&&new Set(v.flags).size===v.flags.length&&v.flags.every(f=>reviewFlags.includes(f)),'Invalid review flags.');
 require(Array.isArray(v.criteria)&&v.criteria.length===dimensions.length,'Supply every rubric criterion once.');
 const expected=dimensions.map(d=>d.id);require(new Set(v.criteria.map(c=>c.id)).size===expected.length&&v.criteria.every(c=>expected.includes(c.id)),'Invalid or repeated criterion.');
 for(const c of v.criteria){
  require(exact(c,['id','score','rationale','improvement','evidence']),'Unexpected criterion fields.');
  require(Number.isInteger(c.score)&&c.score>=0&&c.score<=5&&text(c.rationale,500)&&text(c.improvement,500),'Invalid score or missing substantive feedback.');
  require(Array.isArray(c.evidence)&&c.evidence.length>=1&&c.evidence.length<=3,'Each criterion needs bounded content evidence.');
  for(const e of c.evidence){
   require(exact(e,['start','end','quote'])&&Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=0&&e.end>e.start&&e.end<=j.content.length&&text(e.quote,200)&&j.content.slice(e.start,e.end)===e.quote,'Evidence must exactly match the captured content.');
  }
 }
 v.criteria.sort((a,b)=>expected.indexOf(a.id)-expected.indexOf(b.id));return freeze(v);
}
export function scoreEvaluation(evaluation){return Math.round(dimensions.reduce((sum,d)=>sum+d.weight*evaluation.criteria.find(c=>c.id===d.id).score,0)/5);}
export function verifyReport(report){
 require(exact(report,['reportId','payload'])&&/^[a-f0-9]{64}$/.test(report.reportId)&&hash(report.payload)===report.reportId,'Review artifact integrity check failed.');
 const p=report.payload;require(exact(p,['kind','rubricVersion','promptVersion','promptHash','createdAt','capturedJob','inputHash','contentHash','contextHash','provider','providerEvidence','simulation','evaluation','score','disposition','requiresFinalReview','financialExecution','lineage']),'Unexpected report fields.');require(p?.kind==='10x.ai-review-suggestion.v1'&&p.rubricVersion===RUBRIC_VERSION&&p.promptVersion===PROMPT_VERSION&&p.financialExecution===false&&p.requiresFinalReview===true,'Unsupported review artifact.');
 require(exact(p.provider,['id','model','version','kind','provenance'])&&[p.provider.id,p.provider.model,p.provider.version].every(id)&&['local-fixture','declared-local-adapter','operator-import'].includes(p.provider.provenance)&&iso(p.createdAt),'Invalid report provenance.');
 require(exact(p.lineage,['previousReportId','appealId'])&&Object.values(p.lineage).every(v=>v===null||/^[a-f0-9]{64}$/.test(v)),'Invalid lineage.');
 require(['synthetic','model'].includes(p.provider?.kind)&&p.simulation===(p.provider.kind==='synthetic')&&p.simulation===(p.provider.provenance==='local-fixture'),'Invalid simulation label.');
 if(p.providerEvidence!==null)require(exact(p.providerEvidence,['responseId','requestId','resolvedModel','inputTokens','outputTokens','totalTokens'])&&text(p.providerEvidence.responseId,128)&&(p.providerEvidence.requestId===null||text(p.providerEvidence.requestId,128))&&text(p.providerEvidence.resolvedModel,128)&&['inputTokens','outputTokens','totalTokens'].every(k=>Number.isSafeInteger(p.providerEvidence[k])&&p.providerEvidence[k]>=0)&&p.providerEvidence.totalTokens===p.providerEvidence.inputTokens+p.providerEvidence.outputTokens,'Invalid provider receipt.');
 const job=normalizeJob(p.capturedJob),evaluation=validateEvaluation(p.evaluation,job);
 require(Date.parse(p.createdAt)>=Date.parse(job.capturedAt),'Review predates capture.');
 if(p.simulation)require(p.provider.provenance==='local-fixture'&&new URL(job.url).hostname.endsWith('.invalid')&&job.content.startsWith('SYNTHETIC'),'Simulation requires an explicitly labelled .invalid fixture.');
 require(p.inputHash===hash(job)&&p.contentHash===hash(job.content)&&p.contextHash===hash(job.projectContext)&&p.promptHash===hash(systemPrompt),'Review evidence hash mismatch.');
 require(p.score===scoreEvaluation(evaluation)&&p.disposition===disposition(evaluation),'Review score/disposition mismatch.');
 return freeze(structuredClone(report));
}
const disposition=e=>e.confidence==='low'||e.flags.length?'needs-investigation':'ready-for-operator-review';
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
export function creatorFeedback(report){
 const {payload:p,reportId}=verifyReport(report);
 return freeze({reportId,submissionId:p.capturedJob.submissionId,label:p.simulation?'SIMULATION — not an AI judgment':p.provider.provenance==='operator-import'?'Imported review suggestion — model provenance unverified':'AI review suggestion — awaiting authorized final review',simulation:p.simulation,suggestedScore:p.score,scoreMaximum:10,status:p.disposition,rubricVersion:p.rubricVersion,summary:p.evaluation.summary,criteria:p.evaluation.criteria.map(({id,score,rationale,improvement})=>({id,label:dimensions.find(d=>d.id===id).label,score,maximum:5,rationale,improvement})),uncertainty:p.evaluation.confidence,reviewNeeded:p.disposition==='needs-investigation',flags:p.evaluation.flags,appealAvailable:true,previousReportId:p.lineage.previousReportId,financialExecution:false});
}
export function createAppeal({report,reason,createdAt}){
 const r=verifyReport(report);require(text(reason,2000)&&iso(createdAt)&&Date.parse(createdAt)>=Date.parse(r.payload.createdAt),'Supply a substantive appeal reason and valid timestamp.');
 const payload={kind:'10x.ai-review-appeal.v1',reportId:r.reportId,submissionId:r.payload.capturedJob.submissionId,reason,createdAt,status:'awaiting-independent-review',simulation:r.payload.simulation,financialExecution:false};return freeze({appealId:hash(payload),payload});
}
export function verifyAppeal(a){require(exact(a,['appealId','payload'])&&hash(a.payload)===a.appealId&&exact(a.payload,['kind','reportId','submissionId','reason','createdAt','status','simulation','financialExecution'])&&a.payload.kind==='10x.ai-review-appeal.v1'&&a.payload.financialExecution===false&&text(a.payload.reason,2000)&&iso(a.payload.createdAt)&&id(a.payload.submissionId)&&/^[a-f0-9]{64}$/.test(a.payload.reportId)&&typeof a.payload.simulation==='boolean'&&a.payload.status==='awaiting-independent-review','Appeal artifact integrity check failed.');return a;}
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
