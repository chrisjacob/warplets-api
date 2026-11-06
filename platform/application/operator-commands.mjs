import {CONFIGURE_ACTION,buildActionPolicyCommand} from '../earn/action-policy-service.mjs';
import {createOperationsCommand,OPERATIONS} from '../storage/atomic-operations.mjs';
import {controlledScopes} from '../operations/portable-controls.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
import {FINAL_REVIEW,reviewRequestBytes} from './commands.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildStagePublicationCommand,PUBLISH_COLLECTION_STAGE} from '../collect/stage-service.mjs';
import {normalizeStagePublication} from '../collect/stage-plan.mjs';
import {buildCollectionCutCommand,BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT} from '../collect/free-cut-service.mjs';
import {prepareGovernanceOperatorCommand,PUBLISH_BALLOT,RECORD_DECISION} from '../governance/operator-service.mjs';

export const LOCAL_OPERATOR_COMMANDS=Object.freeze([CONFIGURE_ACTION,OPERATIONS.configureWorkload,OPERATIONS.changeScope,FINAL_REVIEW,PUBLISH_COLLECTION_STAGE,PUBLISH_BALLOT,RECORD_DECISION,BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT]);
export const LOCAL_OPERATOR_SCOPES=Object.freeze({[CONFIGURE_ACTION]:'earn-action-policy',[OPERATIONS.configureWorkload]:'operations',[OPERATIONS.changeScope]:'operations',[FINAL_REVIEW]:'earn-review',[PUBLISH_COLLECTION_STAGE]:'collection-publication',[PUBLISH_BALLOT]:'governance-publication',[RECORD_DECISION]:'governance-decision',[BEGIN_COLLECTION_FREE_CUT]:'collection-evidence',[VALIDATE_COLLECTION_CUT_PAGE]:'collection-evidence',[SEAL_COLLECTION_FREE_CUT]:'collection-evidence'});
export function operatorCommandScope(kind){requireValue(LOCAL_OPERATOR_COMMANDS.includes(kind),'This operator command is unavailable.');return LOCAL_OPERATOR_SCOPES[kind];}
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const staffingFields=['effectiveEpoch','staffedMinutes','secondsPerReview','admissionLimit','reason'];
const scopeFields=['scope','paused','previousRevision','reason','evidenceRef'];
const reviewFields=['submissionId','score','reason','sourceRef'];
const ballotFields=['ballotId','opensMs','previousTrancheOpeningMs','electorateSourceId','electorateDigest','cutoffMs','sourceKind','holdersListId','nextWhitelistListId','unionListId'];
const decisionFields=['ballotId','choice','decidedMs','noticeMs','rationale'];
const cutFields=Object.freeze({[BEGIN_COLLECTION_FREE_CUT]:['rootId'],[VALIDATE_COLLECTION_CUT_PAGE]:['attemptId','pageIndex'],[SEAL_COLLECTION_FREE_CUT]:['attemptId']});

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
 const i=r.input,action=r.operationKind===CONFIGURE_ACTION,staffing=r.operationKind===OPERATIONS.configureWorkload,review=r.operationKind===FINAL_REVIEW,stage=r.operationKind===PUBLISH_COLLECTION_STAGE,governance=r.operationKind===PUBLISH_BALLOT||r.operationKind===RECORD_DECISION,cut=Object.hasOwn(cutFields,r.operationKind);
 if(cut)requireValue(exact(i,cutFields[r.operationKind]),'Invalid fixed-cut input fields.');
 if(governance)requireValue(exact(i,r.operationKind===PUBLISH_BALLOT?ballotFields:decisionFields),'Invalid governance input fields.');
 if(!action&&!stage&&!governance&&!cut){requireValue(exact(i,staffing?staffingFields:review?reviewFields:scopeFields),'Invalid operator input fields.');name(i.reason,'reason');}
 if(stage){
  normalizeStagePublication(i);
  requireValue(i.inventoryOverrideReason===null&&i.ballotId===null,'Ballot and inventory override publication are unavailable here.');
  requireValue(i.type==='public'?i.founderApproved===true&&i.approvedSpendLamports===null:
   i.type==='founder'?i.founderApproved===true&&i.approvedSpendLamports!==null:
   i.founderApproved===false&&i.approvedSpendLamports===null,'Supply only the explicit fixture approvals required by this stage type.');
  requireValue(!['free','founder'].includes(i.type)||i.priceLamports==='0','Free and founder stage price must be zero.');
 }else if(staffing){
  nat(i.effectiveEpoch,'epoch');
  requireValue(Number.isInteger(i.staffedMinutes)&&i.staffedMinutes>=0&&i.staffedMinutes<=1440,'Invalid staffed minutes.');
  requireValue(Number.isInteger(i.secondsPerReview)&&i.secondsPerReview>=1&&i.secondsPerReview<=3600,'Invalid review estimate.');
  requireValue(Number.isInteger(i.admissionLimit)&&i.admissionLimit>=0&&i.admissionLimit<=100,'Invalid pilot capacity.');
 }else if(review){
  name(i.submissionId,'submission');name(i.sourceRef,'source reference');
  requireValue(r.requestKey===i.submissionId,'Final review request key must equal its submission ID.');
  requireValue(Number.isInteger(i.score)&&i.score>=0&&i.score<=10,'Score must be 0-10.');
 }else if(!action&&!governance&&!cut){
  requireValue(controlledScopes.includes(i.scope),'Choose a controllable application scope. Claims, principal and recovery are protected.');
  requireValue(typeof i.paused==='boolean','Specify pause or resume.');
  requireValue(i.previousRevision===null||typeof i.previousRevision==='string'&&i.previousRevision.length>0&&i.previousRevision.length<=256&&i.previousRevision===i.previousRevision.trim(),'Invalid prior scope revision.');
  name(i.evidenceRef,'evidence reference');
 }
 freeze(p);freeze(r);
 const command=action?await buildActionPolicyCommand({principal:p,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions},crypto):cut?await buildCollectionCutCommand(r.operationKind,p,{requestKey:r.requestKey,...i,expectedRevisions:r.expectedRevisions},crypto):governance?await prepareGovernanceOperatorCommand(r.operationKind,{principal:p,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions},crypto):stage?await buildStagePublicationCommand(p,{requestKey:r.requestKey,input:i,expectedRevisions:r.expectedRevisions},crypto):review?{principal:p,operationKind:FINAL_REVIEW,businessIdentity:i.submissionId,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions,
  requestDigest:await crypto.sha256(reviewRequestBytes({principal:p,input:i}))}:
  await createOperationsCommand(r.operationKind,{principal:p,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions},crypto);
 const confirmationDigest=await crypto.sha256(utf8(canonicalJson(['10x-local-operator-confirmation-v1',p.id,r])));
 // Current-time/state predicates stay in the repository, after accepted replay.
 const preview={operationKind:r.operationKind,requestKey:r.requestKey,requestDigest:command.requestDigest,confirmationDigest,
  expectedRevisions:r.expectedRevisions,financialExecution:false,
  summary:action?{...i,futureOnly:true,financialExecution:false}:cut?{...i,financialExecution:false}:governance?{...i,advisory:true,financialExecution:false}:staffing?{...i,calculatedCapacity:Math.min(i.admissionLimit,Math.floor(i.staffedMinutes*60/i.secondsPerReview)),currentOrFutureEpoch:i.effectiveEpoch>=Math.floor(at/86400000)}:review?{...i,final:true}:{...i}};
 return freeze({command,preview});
}

/** Named private dispatch only; repository validation and atomic scope checks
 * remain mandatory. No arbitrary method name is taken from the caller. */
export function dispatchOperatorCommand(repository,prepared){
 const command=prepared?.command;
 requireValue(command&&LOCAL_OPERATOR_COMMANDS.includes(command.operationKind),'This operator command is unavailable.');
 if(command.operationKind===CONFIGURE_ACTION){requireValue(typeof repository.configureAction==='function','Action policy configuration is unavailable.');return repository.configureAction(command);}
 if(command.operationKind===BEGIN_COLLECTION_FREE_CUT){requireValue(typeof repository.beginCut==='function','Fixed-cut begin is unavailable.');return repository.beginCut(command);}
 if(command.operationKind===VALIDATE_COLLECTION_CUT_PAGE){requireValue(typeof repository.validatePage==='function','Fixed-cut page validation is unavailable.');return repository.validatePage(command);}
 if(command.operationKind===SEAL_COLLECTION_FREE_CUT){requireValue(typeof repository.sealCut==='function','Fixed-cut sealing is unavailable.');return repository.sealCut(command);}
 if(command.operationKind===PUBLISH_BALLOT){requireValue(typeof repository.publishBallot==='function','Ballot publication is unavailable.');return repository.publishBallot(command);}
 if(command.operationKind===RECORD_DECISION){requireValue(typeof repository.recordDecision==='function','Advisory decision is unavailable.');return repository.recordDecision(command);}
 if(command.operationKind===PUBLISH_COLLECTION_STAGE){requireValue(typeof repository.publishStage==='function','Stage publication is unavailable.');return repository.publishStage(command);}
 if(command.operationKind===FINAL_REVIEW){requireValue(typeof repository.recordFinalReview==='function','Final review is unavailable.');return repository.recordFinalReview(command);}
 return command.operationKind===OPERATIONS.configureWorkload?repository.configureWorkload(command):repository.changeScope(command);
}
