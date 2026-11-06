import {canonicalJson,utf8} from '../security/canonical.mjs';
import {noticeWorkerPrincipal} from '../notifications/delivery-plan.mjs';
import {deliveryJobPayload,deliveryJobBusinessKey} from '../notifications/delivery-job-plan.mjs';
const held=reason=>({state:'held',reason,dependency:'notification-delivery-reconciliation',readyMs:null});
export function createNotificationDeliveryHandler({repository,crypto,clock,principal}){
 const owner=noticeWorkerPrincipal(principal);
 return async context=>{
  const job=structuredClone(context.job),lease=structuredClone(context.lease);let payload;
  try{payload=deliveryJobPayload(job.payload);}catch{return held('notice-job-binding');}
  if(job.type!=='deliver-local-notice'||job.businessKey!==deliveryJobBusinessKey(payload)||lease?.businessKey!==job.businessKey||lease.jobId!==job.id||job.payloadDigest!==lease.payloadDigest||await crypto.sha256(utf8(canonicalJson(payload)))!==lease.payloadDigest)return held('notice-job-binding');
  const id=payload.noticeId,checkpoint=job.checkpoint;
  if(!checkpoint||typeof checkpoint!=='object'||Array.isArray(checkpoint)||Object.keys(checkpoint).length&&(Object.keys(checkpoint).sort().join(',')!=='kind,noticeId,noticeLease'||checkpoint.kind!==payload.kind||checkpoint.noticeId!==id||checkpoint.noticeLease!==null&&(!checkpoint.noticeLease||Object.keys(checkpoint.noticeLease).sort().join(',')!=='id,lease'||checkpoint.noticeLease.id!==id||typeof checkpoint.noticeLease.lease!=='string'||!checkpoint.noticeLease.lease.length||checkpoint.noticeLease.lease.length>256)))return held('notice-job-checkpoint');
  const completed=state=>({state:'completed',result:{kind:payload.kind,noticeId:id,state,financialExecution:false}});
  const save=async token=>context.signal?.aborted?{kind:'pending'}:context.checkpoint({kind:payload.kind,noticeId:id,noticeLease:token});
  const settle=async(result)=>{
   if(result.state==='delivered'||result.state==='cancelled')return completed(result.state);
   if(context.signal?.aborted)return held('notice-handler-aborted');
   const reconciled=await repository.reconcileUnknown(owner,{id},lease);
   if(reconciled.kind)return held(reconciled.reason??reconciled.code);
   if(['delivered','cancelled','missing'].includes(reconciled.state))return completed(reconciled.state);
   if(result.kind)return held(result.reason??result.code);
   if((await save(null)).kind!=='checkpointed')return held('notice-checkpoint-unknown');
   return {state:'retry',reason:'notice-'+reconciled.state,dependency:null,readyMs:clock.nowMs()+60000};
  };
  if(context.signal?.aborted)return held('notice-handler-aborted');
  if(checkpoint.noticeLease){
   const result=await repository.finishLease(owner,checkpoint.noticeLease,lease);
   if(result.state!=='fenced')return settle(result);
  }
  if(context.signal?.aborted)return held('notice-handler-aborted');
  const claimed=await repository.leaseDue(owner,{limit:1,noticeId:id},lease);
  if(!Array.isArray(claimed))return settle(claimed);
  if(claimed.length===0)return settle({state:'unclaimed'});
  if(claimed.length!==1||claimed[0].id!==id)return held('notice-lease-binding');
  const token={id,lease:claimed[0].lease};
  if((await save(token)).kind!=='checkpointed')return held('notice-checkpoint-unknown');
  if(context.signal?.aborted)return held('notice-handler-aborted');
  return settle(await repository.finishLease(owner,token,lease));
 };
}
