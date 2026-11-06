import {createOperationsCommand,OPERATIONS} from '../storage/atomic-operations.mjs';
import {controlledScopes} from '../operations/portable-controls.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
import {FINAL_REVIEW,reviewRequestBytes} from './commands.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildStagePublicationCommand,PUBLISH_COLLECTION_STAGE} from '../collect/stage-service.mjs';
import {normalizeStagePublication} from '../collect/stage-plan.mjs';
import {prepareGovernanceOperatorCommand,PUBLISH_BALLOT,RECORD_DECISION} from '../governance/operator-service.mjs';

export const LOCAL_OPERATOR_COMMANDS=Object.freeze([OPERATIONS.configureWorkload,OPERATIONS.changeScope,FINAL_REVIEW,PUBLISH_COLLECTION_STAGE,PUBLISH_BALLOT,RECORD_DECISION]);
export const LOCAL_OPERATOR_SCOPES=Object.freeze({[OPERATIONS.configureWorkload]:'operations',[OPERATIONS.changeScope]:'operations',[FINAL_REVIEW]:'earn-review',[PUBLISH_COLLECTION_STAGE]:'collection-publication',[PUBLISH_BALLOT]:'governance-publication',[RECORD_DECISION]:'governance-decision'});
export function operatorCommandScope(kind){requireValue(LOCAL_OPERATOR_COMMANDS.includes(kind),'This operator command is unavailable.');return LOCAL_OPERATOR_SCOPES[kind];}
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const staffingFields=['effectiveEpoch','staffedMinutes','secondsPerReview','admissionLimit','reason'];
const scopeFields=['scope','paused','previousRevision','reason','evidenceRef'];
const reviewFields=['submissionId','score','reason','sourceRef'];
const ballotFields=['ballotId','opensMs','previousTrancheOpeningMs','electorateSourceId','electorateDigest','cutoffMs','sourceKind','holdersListId','nextWhitelistListId','unionListId'];
const decisionFields=['ballotId','choice','decidedMs','noticeMs','rationale'];

/** This registry accepts trusted principal/time separately from the wire body.
 * A preview is descriptive, never session, scope or current-state authority. */
export async function prepareOperatorCommand({principal,request,nowMs},crypto){
 const p=structuredClone(principal),r=structuredClone(request),at=nowMs;
 requireValue(exact(p,['kind','id'])&&p.kind==='operator','A local operator principal is required.');
 name(p.id,'operator');nat(at,'now');
 requireValue(exact(r,['operationKind','requestKey','input','expectedRevisions']),'Supply the exact operator command fields.');
 requireValue(LOCAL_OPERATOR_COMMANDS.includes(r.operationKind),'This operator command is unavailable.');
 requireValue(typeof r.requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(r.requestKey),'Invalid request key.');
 requireValue(exact(r.expectedRevisions,['earn','source','control'])&&Object.values(r.expectedRevisions).every(value=>
  typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value))),'Supply all three exact safe revision strings.');
 const i=r.input,staffing=r.operationKind===OPERATIONS.configureWorkload,review=r.operationKind===FINAL_REVIEW,stage=r.operationKind===PUBLISH_COLLECTION_STAGE,governance=r.operationKind===PUBLISH_BALLOT||r.operationKind===RECORD_DECISION;
 if(governance)requireValue(exact(i,r.operationKind===PUBLISH_BALLOT?ballotFields:decisionFields),'Invalid governance input fields.');
 if(!stage&&!governance){requireValue(exact(i,staffing?staffingFields:review?reviewFields:scopeFields),'Invalid operator input fields.');name(i.reason,'reason');}
 if(stage){
  normalizeStagePublication(i);
  requireValue(i.type==='whitelist'&&i.founderApproved===false&&i.approvedSpendLamports===null&&i.inventoryOverrideReason===null&&i.ballotId===null,'Only whitelist publication without founder, spend, override or ballot approval is available here.');
 }else if(staffing){
  nat(i.effectiveEpoch,'epoch');
  requireValue(Number.isInteger(i.staffedMinutes)&&i.staffedMinutes>=0&&i.staffedMinutes<=1440,'Invalid staffed minutes.');
  requireValue(Number.isInteger(i.secondsPerReview)&&i.secondsPerReview>=1&&i.secondsPerReview<=3600,'Invalid review estimate.');
  requireValue(Number.isInteger(i.admissionLimit)&&i.admissionLimit>=0&&i.admissionLimit<=100,'Invalid pilot capacity.');
 }else if(review){
  name(i.submissionId,'submission');name(i.sourceRef,'source reference');
  requireValue(r.requestKey===i.submissionId,'Final review request key must equal its submission ID.');
  requireValue(Number.isInteger(i.score)&&i.score>=0&&i.score<=10,'Score must be 0â€“10.');
 }else if(!governance){
  requireValue(controlledScopes.includes(i.scope),'Choose a controllable application scope. Claims, principal and recovery are protected.');
  requireValue(typeof i.paused==='boolean','Specify pause or resume.');
  requireValue(i.previousRevision===null||typeof i.previousRevision==='string'&&i.previousRevision.length>0&&i.previousRevision.length<=256&&i.previousRevision===i.previousRevision.trim(),'Invalid prior scope revision.');
  name(i.evidenceRef,'evidence reference');
 }
 freeze(p);freeze(r);
 const command=governance?await prepareGovernanceOperatorCommand(r.operationKind,{principal:p,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions},crypto):stage?await buildStagePublicationCommand(p,{requestKey:r.requestKey,input:i,expectedRevisions:r.expectedRevisions},crypto):review?{principal:p,operationKind:FINAL_REVIEW,businessIdentity:i.submissionId,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions,
  requestDigest:await crypto.sha256(reviewRequestBytes({principal:p,input:i}))}:
  await createOperationsCommand(r.operationKind,{principal:p,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions},crypto);
 const confirmationDigest=await crypto.sha256(utf8(canonicalJson(['10x-local-operator-confirmation-v1',p.id,r])));
 // Current-time/state predicates stay in the repository, after accepted replay.
 const preview={operationKind:r.operationKind,requestKey:r.requestKey,requestDigest:command.requestDigest,confirmationDigest,
  expectedRevisions:r.expectedRevisions,financialExecution:false,
  summary:governance?{...i,advisory:true,financialExecution:false}:staffing?{...i,calculatedCapacity:Math.min(i.admissionLimit,Math.floor(i.staffedMinutes*60/i.secondsPerReview)),currentOrFutureEpoch:i.effectiveEpoch>=Math.floor(at/86400000)}:review?{...i,final:true}:{...i}};
 return freeze({command,preview});
}

/** Named private dispatch only; repository validation and atomic scope checks
 * remain mandatory. No arbitrary method name is taken from the caller. */
export function dispatchOperatorCommand(repository,prepared){
 const command=prepared?.command;
 requireValue(command&&LOCAL_OPERATOR_COMMANDS.includes(command.operationKind),'This operator command is unavailable.');
 if(command.operationKind===PUBLISH_BALLOT){requireValue(typeof repository.publishBallot==='function','Ballot publication is unavailable.');return repository.publishBallot(command);}
 if(command.operationKind===RECORD_DECISION){requireValue(typeof repository.recordDecision==='function','Advisory decision is unavailable.');return repository.recordDecision(command);}
 if(command.operationKind===PUBLISH_COLLECTION_STAGE){requireValue(typeof repository.publishStage==='function','Stage publication is unavailable.');return repository.publishStage(command);}
 if(command.operationKind===FINAL_REVIEW){requireValue(typeof repository.recordFinalReview==='function','Final review is unavailable.');return repository.recordFinalReview(command);}
 return command.operationKind===OPERATIONS.configureWorkload?repository.configureWorkload(command):repository.changeScope(command);
}
