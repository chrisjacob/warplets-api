import {canonicalJson,utf8} from '../security/canonical.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
export const JOB_TYPES=Object.freeze(['capture-eligibility','complete-cutoff','finalize-board','allocate-token-day','publish-archive','reconcile-publication','retention-maintenance','deliver-local-notice']);
export const clone=value=>JSON.parse(canonicalJson(value));
export const boundedJson=value=>{const text=canonicalJson(value);requireValue(utf8(text).length<=16384,'Job value exceeds16KiB.');return text;};
export const jobRequestBytes=c=>utf8(canonicalJson([c.operationKind,c.principal,c.input,c.expectedRevisions]));
export async function createJobCommand({principal,requestKey,input,nowMs,expectedRevisions={}},crypto){
 const command=clone({operationKind:'jobs.enqueue.v1',principal,requestKey,input,nowMs,expectedRevisions});
 command.businessIdentity=command.input.businessKey;command.requestDigest=await crypto.sha256(jobRequestBytes(command));return command;
}
export function validateJobInput(input){
 for(const key of ['businessKey','sourceKey'])name(input[key],key);
 requireValue(JOB_TYPES.includes(input.type),'Unknown job type.');boundedJson(input.payload);
 nat(input.readyMs,'ready time');requireValue(Number.isInteger(input.maxAttempts)&&input.maxAttempts>=1&&input.maxAttempts<=20,'Invalid attempt ceiling.');
}
export const pending=reason=>({kind:'pending',reason});
export const conflict=code=>({kind:'conflict',code});
export function jobFromRow(r){return r?{id:r.id,businessKey:r.business_key,type:r.type,payload:JSON.parse(r.payload_json),payloadDigest:r.payload_digest,
 state:r.state,readyMs:r.ready_ms,attempt:r.attempt,maxAttempts:r.max_attempts,checkpoint:JSON.parse(r.checkpoint_json),checkpointSeq:r.checkpoint_seq,
 result:r.result_json===null?null:JSON.parse(r.result_json),resultDigest:r.result_digest,reason:r.reason,dependency:r.dependency,
 lease:r.state==='running'?{jobId:r.id,businessKey:r.business_key,payloadDigest:r.payload_digest,token:r.lease_token,expiresAtMs:r.lease_until_ms,revision:String(r.revision),attempt:r.attempt}:null}:null;}
