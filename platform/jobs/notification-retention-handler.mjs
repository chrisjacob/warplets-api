import {canonicalJson,utf8} from '../security/canonical.mjs';
import {retentionPayload,retentionBusinessKey} from '../notifications/retention-plan.mjs';
import {noticeWorkerPrincipal} from '../notifications/delivery-plan.mjs';
const hold=reason=>({state:'held',reason,dependency:'notification-retention-reconciliation',readyMs:null});
export function createNotificationRetentionHandler({repository,crypto,clock,principal}){
 const owner=noticeWorkerPrincipal(principal);
 return async context=>{
  const job=structuredClone(context.job),lease=structuredClone(context.lease);let payload;
  try{payload=retentionPayload(job.payload);}catch{return hold('retention-job-binding');}
  if(job.type!=='retention-maintenance'||job.businessKey!==retentionBusinessKey(payload)||lease?.businessKey!==job.businessKey||lease.jobId!==job.id||job.payloadDigest!==lease.payloadDigest||await crypto.sha256(utf8(canonicalJson(payload)))!==lease.payloadDigest)return hold('retention-job-binding');
  if(context.signal?.aborted)return hold('retention-handler-aborted');
  const result=await repository.purgeExpired(owner,{limit:payload.limit},lease);
  if(result.kind!=='purged')return hold(result.reason);
  const saved=await context.checkpoint({kind:payload.kind,runKey:payload.runKey,lastPageRemoved:result.outboxRemoved,consentRequestKeysRemoved:0});
  if(saved.kind!=='checkpointed')return hold('retention-checkpoint-unknown');
  // A full page may leave more rows. The same B03 job retries; it owns no
  // notification delivery lease and makes no unprovable cumulative count claim.
  if(result.outboxRemoved===payload.limit)return {state:'retry',reason:'retention-page-full',dependency:null,readyMs:clock.nowMs()};
  return {state:'completed',result:{kind:payload.kind,runKey:payload.runKey,lastPageRemoved:result.outboxRemoved,consentRequestKeysRemoved:0,financialExecution:false}};
 };
}
