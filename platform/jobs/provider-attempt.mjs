import {createOperationsCommand,OPERATIONS} from '../storage/atomic-operations.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {clone,pending} from './model.mjs';
import {name} from '../earn/validation.mjs';
// One bounded read-only call per job attempt. No transport, credentials, signing
// or spending capability is provided here; callers supply a local recorded read.
export function createProviderAttemptExecutor({repository,operations,crypto,clock,principal}){
 principal=clone(principal);
 return async function execute(context,configuration,readOnlyCall){
  const config=clone(configuration);name(config.step,'provider step');name(config.provider,'provider');
  if(config.cost?.upperUsdMicros!=='0'||!config.cost.quoteRef)return pending('free-cost-evidence-required');
  const current=await repository.readJob(context.job.id);
  if(current?.state!=='running'||current.lease.token!==context.lease.token)return pending('lease-replaced');
  if(!current.checkpoint||typeof current.checkpoint!=='object'||Array.isArray(current.checkpoint))return pending('provider-checkpoint-shape');
  const attemptId=await crypto.sha256(utf8(canonicalJson([current.id,current.attempt,config.step,config.provider])));
  const configDigest=await crypto.sha256(utf8(canonicalJson(config)));
  const previous=current.checkpoint.providerAttempt;
  if(previous){
   if(previous.configDigest!==configDigest)return pending('provider-configuration-conflict');
   if(previous.step!==config.step)return pending('provider-step-conflict');
   if(previous.phase==='completed')return {kind:'replayed',value:previous.value};
   if(previous.phase==='dispatching')return pending('provider-outcome-unknown');
   // Includes failed observations; the runner must explicitly start a new job
   // attempt before a new metered call, never repeat a dispatch in-place.
   if(previous.attemptId===attemptId)return pending(previous.phase==='failed'?'read-attempt-failed':'provider-outcome-unknown');
  }
  const command=async(method,key,input)=>createOperationsCommand(OPERATIONS[method],{principal,requestKey:key,input,nowMs:clock.nowMs()},crypto);
  const cost=await operations.reserveOptionalCost(await command('reserveOptionalCost',attemptId,{scope:'optional-refresh',upperUsdMicros:'0',quoteRef:config.cost.quoteRef}));
  if(!['committed','replayed'].includes(cost.kind))return pending(cost.reason??cost.code);
  const quota=await operations.meterProviderAttempt(await command('meterProviderAttempt',attemptId,{attemptId,provider:config.provider,units:config.units,quota:config.quota,evidenceRef:config.evidenceRef}));
  if(!['committed','replayed'].includes(quota.kind))return pending(quota.reason??quota.code);
  // Recovered metering by itself cannot authorize redispatch. It may have been
  // followed by a call whose checkpoint response was lost.
  if(quota.kind==='replayed')return pending('provider-dispatch-reconciliation');
  let sequence=current.checkpointSeq;
  const save=async providerAttempt=>{
   const saved=await repository.checkpoint(context.lease,{sequence,value:{...current.checkpoint,providerAttempt}});
   if(saved.kind==='checkpointed')sequence=saved.job.checkpointSeq;return saved;
  };
  const record={attemptId,step:config.step,configDigest,phase:'dispatching',usageReceipt:quota.value.receipt};
  if((await save(record)).kind!=='checkpointed')return pending('provider-dispatch-reconciliation');
  if(context.signal.aborted)return pending('provider-dispatch-reconciliation');
  let value,failure;
  try{value=await readOnlyCall({signal:context.signal,attemptId});}catch(error){failure=error;}
  const settled=await operations.settleOptionalCost(await command('settleOptionalCost',attemptId,{reservationKey:attemptId,actualUsdMicros:'0',evidenceRef:config.cost.quoteRef}));
  if(!['committed','replayed'].includes(settled.kind))return pending('provider-cost-reconciliation');
  const completed={...record,phase:failure?'failed':'completed',...(failure?{reason:'read-transport'}:{value:clone(value)})};
  if((await save(completed)).kind!=='checkpointed')return pending('provider-outcome-unknown');
  if(failure)throw Object.assign(new Error('Recorded read transport failed.'),{effect:'read-only',retryable:true});
  return {kind:'completed',value};
 };
}
