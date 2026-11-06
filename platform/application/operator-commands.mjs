import {createOperationsCommand,OPERATIONS} from '../storage/atomic-operations.mjs';
import {controlledScopes} from '../operations/portable-controls.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';

export const LOCAL_OPERATOR_COMMANDS=Object.freeze([OPERATIONS.configureWorkload,OPERATIONS.changeScope]);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const staffingFields=['effectiveEpoch','staffedMinutes','secondsPerReview','admissionLimit','reason'];
const scopeFields=['scope','paused','previousRevision','reason','evidenceRef'];

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
 const i=r.input,staffing=r.operationKind===OPERATIONS.configureWorkload;
 requireValue(exact(i,staffing?staffingFields:scopeFields),'Invalid operator input fields.');
 name(i.reason,'reason');
 if(staffing){
  nat(i.effectiveEpoch,'epoch');
  requireValue(Number.isInteger(i.staffedMinutes)&&i.staffedMinutes>=0&&i.staffedMinutes<=1440,'Invalid staffed minutes.');
  requireValue(Number.isInteger(i.secondsPerReview)&&i.secondsPerReview>=1&&i.secondsPerReview<=3600,'Invalid review estimate.');
  requireValue(Number.isInteger(i.admissionLimit)&&i.admissionLimit>=0&&i.admissionLimit<=100,'Invalid pilot capacity.');
 }else{
  requireValue(controlledScopes.includes(i.scope),'Choose a controllable application scope. Claims, principal and recovery are protected.');
  requireValue(typeof i.paused==='boolean','Specify pause or resume.');
  requireValue(i.previousRevision===null||typeof i.previousRevision==='string'&&i.previousRevision.length>0&&i.previousRevision.length<=256&&i.previousRevision===i.previousRevision.trim(),'Invalid prior scope revision.');
  name(i.evidenceRef,'evidence reference');
 }
 freeze(p);freeze(r);
 const command=await createOperationsCommand(r.operationKind,{principal:p,requestKey:r.requestKey,input:i,nowMs:at,expectedRevisions:r.expectedRevisions},crypto);
 // Current-time/state predicates stay in the repository, after accepted replay.
 const preview={operationKind:r.operationKind,requestKey:r.requestKey,requestDigest:command.requestDigest,
  expectedRevisions:r.expectedRevisions,financialExecution:false,
  summary:staffing?{...i,calculatedCapacity:Math.min(i.admissionLimit,Math.floor(i.staffedMinutes*60/i.secondsPerReview)),currentOrFutureEpoch:i.effectiveEpoch>=Math.floor(at/86400000)}:{...i}};
 return freeze({command,preview});
}

/** Named private dispatch only; repository validation and atomic scope checks
 * remain mandatory. No arbitrary method name is taken from the caller. */
export function dispatchOperatorCommand(repository,prepared){
 const command=prepared?.command;
 requireValue(command&&LOCAL_OPERATOR_COMMANDS.includes(command.operationKind),'This operator command is unavailable.');
 return command.operationKind===OPERATIONS.configureWorkload?repository.configureWorkload(command):repository.changeScope(command);
}
