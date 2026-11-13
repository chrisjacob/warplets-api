import {RUBRIC_VERSION,PROMPT_VERSION,dimensions,reviewFlags} from './rubric.mjs';
export const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const requireReview=(condition,message)=>{if(!condition)throw new TypeError(message);};
export const text=(v,max=1000)=>typeof v==='string'&&v.trim().length>0&&v===v.trim()&&v.length<=max;
export const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const require=requireReview;
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
  for(const e of c.evidence)require(exact(e,['start','end','quote'])&&Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=0&&e.end>e.start&&e.end<=j.content.length&&text(e.quote,200)&&j.content.slice(e.start,e.end)===e.quote,'Evidence must exactly match the captured content.');
 }
 v.criteria.sort((a,b)=>expected.indexOf(a.id)-expected.indexOf(b.id));return freeze(v);
}
export function scoreEvaluation(evaluation){return Math.round(dimensions.reduce((sum,d)=>sum+d.weight*evaluation.criteria.find(c=>c.id===d.id).score,0)/5);}
export const disposition=e=>e.confidence==='low'||e.flags.length?'needs-investigation':'ready-for-operator-review';
export function checkReportEnvelope(report){require(exact(report,['reportId','payload'])&&/^[a-f0-9]{64}$/.test(report.reportId),'Review artifact integrity check failed.');}
/** Structural/evidence validation only. Public codecs additionally verify all five hashes. */
export function checkReportBody(report){
 const p=report.payload;require(exact(p,['kind','rubricVersion','promptVersion','promptHash','createdAt','capturedJob','inputHash','contentHash','contextHash','provider','providerEvidence','simulation','evaluation','score','disposition','requiresFinalReview','financialExecution','lineage']),'Unexpected report fields.');require(p?.kind==='10x.ai-review-suggestion.v1'&&p.rubricVersion===RUBRIC_VERSION&&p.promptVersion===PROMPT_VERSION&&p.financialExecution===false&&p.requiresFinalReview===true,'Unsupported review artifact.');
 require(exact(p.provider,['id','model','version','kind','provenance'])&&[p.provider.id,p.provider.model,p.provider.version].every(id)&&['local-fixture','declared-local-adapter','operator-import'].includes(p.provider.provenance)&&iso(p.createdAt),'Invalid report provenance.');
 require(exact(p.lineage,['previousReportId','appealId'])&&Object.values(p.lineage).every(v=>v===null||/^[a-f0-9]{64}$/.test(v)),'Invalid lineage.');
 require(['synthetic','model'].includes(p.provider?.kind)&&p.simulation===(p.provider.kind==='synthetic')&&p.simulation===(p.provider.provenance==='local-fixture'),'Invalid simulation label.');
 if(p.providerEvidence!==null)require(exact(p.providerEvidence,['responseId','requestId','resolvedModel','inputTokens','outputTokens','totalTokens'])&&text(p.providerEvidence.responseId,128)&&(p.providerEvidence.requestId===null||text(p.providerEvidence.requestId,128))&&text(p.providerEvidence.resolvedModel,128)&&['inputTokens','outputTokens','totalTokens'].every(k=>Number.isSafeInteger(p.providerEvidence[k])&&p.providerEvidence[k]>=0)&&p.providerEvidence.totalTokens===p.providerEvidence.inputTokens+p.providerEvidence.outputTokens,'Invalid provider receipt.');
 const job=normalizeJob(p.capturedJob),evaluation=validateEvaluation(p.evaluation,job);
 require(Date.parse(p.createdAt)>=Date.parse(job.capturedAt),'Review predates capture.');
 if(p.simulation)require(p.provider.provenance==='local-fixture'&&new URL(job.url).hostname.endsWith('.invalid')&&job.content.startsWith('SYNTHETIC'),'Simulation requires an explicitly labelled .invalid fixture.');
 require(p.score===scoreEvaluation(evaluation)&&p.disposition===disposition(evaluation),'Review score/disposition mismatch.');
 return job;
}
export function checkEvidenceHashes(report,[inputHash,contentHash,contextHash,promptHash]){
 const p=report.payload;require(p.inputHash===inputHash&&p.contentHash===contentHash&&p.contextHash===contextHash&&p.promptHash===promptHash,'Review evidence hash mismatch.');
}
/** Internal projection: only call after the public codec has fully verified the report. */
export function feedbackProjection({payload:p,reportId}){
 return freeze({reportId,submissionId:p.capturedJob.submissionId,label:p.simulation?'SIMULATION — not an AI judgment':p.provider.provenance==='operator-import'?'Imported review suggestion — model provenance unverified':'AI review suggestion — awaiting authorized final review',simulation:p.simulation,suggestedScore:p.score,scoreMaximum:10,status:p.disposition,rubricVersion:p.rubricVersion,summary:p.evaluation.summary,criteria:p.evaluation.criteria.map(({id,score,rationale,improvement})=>({id,label:dimensions.find(d=>d.id===id).label,score,maximum:5,rationale,improvement})),uncertainty:p.evaluation.confidence,reviewNeeded:p.disposition==='needs-investigation',flags:p.evaluation.flags,appealAvailable:true,previousReportId:p.lineage.previousReportId,financialExecution:false});
}
export function appealPayload(report,reason,createdAt){
 require(text(reason,2000)&&iso(createdAt)&&Date.parse(createdAt)>=Date.parse(report.payload.createdAt),'Supply a substantive appeal reason and valid timestamp.');
 return {kind:'10x.ai-review-appeal.v1',reportId:report.reportId,submissionId:report.payload.capturedJob.submissionId,reason,createdAt,status:'awaiting-independent-review',simulation:report.payload.simulation,financialExecution:false};
}
export function checkAppealShape(a){require(exact(a,['appealId','payload'])&&exact(a.payload,['kind','reportId','submissionId','reason','createdAt','status','simulation','financialExecution'])&&a.payload.kind==='10x.ai-review-appeal.v1'&&a.payload.financialExecution===false&&text(a.payload.reason,2000)&&iso(a.payload.createdAt)&&id(a.payload.submissionId)&&/^[a-f0-9]{64}$/.test(a.payload.reportId)&&typeof a.payload.simulation==='boolean'&&a.payload.status==='awaiting-independent-review','Appeal artifact integrity check failed.');}
export function checkReportBinding(report,{submission,record,job}){
 const p=report.payload,j=p.capturedJob;
 require(record&&job&&record.report_id===report.reportId&&record.submission_id===submission.id&&record.job_id===job.id&&job.submission_id===submission.id
  &&j.submissionId===submission.id&&j.tokenId===submission.token_id&&j.url===submission.url&&Date.parse(j.capturedAt)>=submission.submitted_ms
  &&p.lineage.previousReportId===job.previous_report_id&&p.lineage.appealId===job.appeal_id
  &&((job.kind==='initial'&&job.previous_report_id===null&&job.appeal_id===null)||(job.kind==='appeal'&&job.previous_report_id!==null&&job.appeal_id!==null)),'Review report does not match its owned source and lineage.');
}
