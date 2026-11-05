import {canonicalJson,utf8} from '../security/canonical.mjs';
import {COMMIT_BOARD,COMMIT_ALLOCATION,settlementFenceKey} from '../storage/atomic-settlement.mjs';
import {clone} from './model.mjs';
const held=(reason,dependency='settlement-input')=>({state:'held',reason,dependency,readyMs:null});
// Compact business intent survives changed input revisions. Every attempt
// prepares a new exact command under the current immutable job lease.
export function createPreparedSettlementHandler({service,repository,crypto,clock,principal}){
 const operator=clone(principal);if(operator.kind!=='operator')throw new TypeError('Settlement operator required.');
 return async context=>{
  const payload=clone(context.job.payload),board=context.job.type==='finalize-board',allocation=context.job.type==='allocate-token-day';
  const fields=board?['epoch','principal']:['day','principal','tokenId'];
  if((!board&&!allocation)||canonicalJson(Object.keys(payload).sort())!==canonicalJson(fields.sort())||
   canonicalJson(payload.principal)!==canonicalJson(operator)||await crypto.sha256(utf8(canonicalJson(payload)))!==context.lease.payloadDigest||
   context.job.businessKey!==settlementFenceKey(board?COMMIT_BOARD:COMMIT_ALLOCATION,payload))return held('job-settlement-binding','reconciliation');
  const query=board?{epoch:payload.epoch}:{tokenId:payload.tokenId,day:payload.day};
  const prepare=()=>service[board?'prepareBoard':'prepareAllocation'](operator,{...query,requestKey:context.job.id});
  for(let attempt=0;attempt<2;attempt++){
   if(context.signal.aborted)return held('settlement-handler-aborted','reconciliation');
   const prepared=await prepare();
   if(context.signal.aborted)return held('settlement-handler-aborted','reconciliation');
   if(prepared.kind==='final'||prepared.kind==='recorded'){
    const result=board?{epoch:prepared.epoch,snapshotId:prepared.snapshotId}:prepared.value;
    const saved=await context.checkpoint({stage:'existing-result',result});
    return saved.kind==='checkpointed'?{state:'completed',result}:held('settlement-checkpoint-unknown','reconciliation');
   }
   if(prepared.kind!=='prepared')return prepared.readyMs!=null?{state:'retry',reason:prepared.reason,dependency:null,readyMs:prepared.readyMs}:
    held(prepared.reason??prepared.code,board?'cutoff-evidence:'+payload.epoch:prepared.dependencyIds?.[0]??'board-for:'+payload.tokenId+':'+payload.day);
   const result=await repository[board?'commitBoard':'commitAllocation'](prepared.command,context.lease);
   if(['committed','replayed'].includes(result.kind)){
    const summary={businessReceipt:result.receipt.operationId,outputDigest:result.receipt.outputDigest};
    const saved=await context.checkpoint({stage:'committed',...summary});
    return saved.kind==='checkpointed'?{state:'completed',result:summary}:held('business-commit-reconciliation','reconciliation');
   }
   if(result.code==='revision_conflict'&&attempt===0)continue;
   return held(result.reason??result.code,board?'cutoff-evidence:'+payload.epoch:'board-for:'+payload.tokenId+':'+payload.day);
  }
  return held('settlement-revision-conflict');
 };
}
