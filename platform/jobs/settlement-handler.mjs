import {canonicalJson,utf8} from '../security/canonical.mjs';
import {COMMIT_BOARD,COMMIT_ALLOCATION,settlementFenceKey} from '../storage/atomic-settlement.mjs';
import {clone} from './model.mjs';
// B07 builds evidence-complete payloads. This adapter only enforces that the
// running job's immutable payload is the exact command under its SQL fence.
export function createSettlementHandler(repository,{crypto,clock}){
 return async context=>{
  const payload=clone(context.job.payload),command=payload.command;
  const kind=context.job.type==='finalize-board'?COMMIT_BOARD:context.job.type==='allocate-token-day'?COMMIT_ALLOCATION:null;
  if(!kind||command?.operationKind!==kind||context.job.businessKey!==settlementFenceKey(kind,command.input)
    ||await crypto.sha256(utf8(canonicalJson(payload)))!==context.lease.payloadDigest)
   return {state:'held',reason:'job-command-binding',dependency:'reconciliation',readyMs:null};
  const method=kind===COMMIT_BOARD?'commitBoard':'commitAllocation';
  const result=await repository[method]({...command,nowMs:clock.nowMs()},context.lease);
  if(result.kind==='committed'||result.kind==='replayed'){
   const checkpoint=await context.checkpoint({businessReceipt:result.receipt.operationId,outputDigest:result.receipt.outputDigest});
   if(checkpoint.kind!=='checkpointed')return {state:'held',reason:'business-commit-reconciliation',dependency:'reconciliation',readyMs:null};
   return {state:'completed',result:{businessReceipt:result.receipt.operationId,outputDigest:result.receipt.outputDigest}};
  }
  return {state:'held',reason:result.reason??result.code,dependency:'settlement-input',readyMs:null};
 };
}
