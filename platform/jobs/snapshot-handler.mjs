import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {createFreezeCommand} from '../storage/cutoff-freeze.mjs';
import {clone} from './model.mjs';
export const cutoffJobKey=(epoch,configurationDigest)=>'complete-cutoff:'+epoch+':'+configurationDigest;
const held=(reason,dependency)=>({state:'held',reason,dependency,readyMs:null});
// The immutable job carries one digest-bound private configuration reference,
// keeping source binding catalogs out of the bounded job/checkpoint JSON.
export function createSnapshotHandler({service,freezeRepository,store,crypto,clock,principal}){
 const operator=clone(principal);if(operator?.kind!=='operator')throw new TypeError('Snapshot runner operator required.');
 return async context=>{
  const payload=clone(context.job.payload);
  if(context.job.type!=='complete-cutoff'||canonicalJson(payload.principal??null)!==canonicalJson(operator)||
   await crypto.sha256(utf8(canonicalJson(payload)))!==context.lease.payloadDigest)return held('job-snapshot-binding','reconciliation');
  let identity;try{identity=privateIdentity(payload.configuration);}catch{return held('snapshot-configuration-identity','reconciliation');}
  if(context.signal.aborted)return held('snapshot-handler-aborted','reconciliation');
  const stored=await store.getVerified(identity);if(stored.status!=='verified')return held('snapshot-configuration-'+stored.status,'snapshot-configuration');
  let query;try{query=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stored.bytes));}catch{return held('snapshot-configuration-json','snapshot-configuration');}
  if(!Number.isSafeInteger(query.epoch)||query.epoch<0||context.job.businessKey!==cutoffJobKey(query.epoch,identity.byteDigest))
   return held('job-snapshot-binding','reconciliation');
  const stage=await context.checkpoint({stage:'configuration-verified',configurationDigest:identity.byteDigest});
  if(stage.kind!=='checkpointed'||context.signal.aborted)return held('snapshot-checkpoint-unknown','reconciliation');
  const frozen=await freezeRepository.freezeEpoch(await createFreezeCommand({principal:payload.principal,epoch:query.epoch,nowMs:clock.nowMs()},crypto));
  const existingFreeze=frozen.code==='epoch-already-frozen'&&await freezeRepository.readFreeze(query.epoch);
  if(!['committed','replayed'].includes(frozen.kind)&&!existingFreeze)return held(frozen.reason??frozen.code,'cutoff-freeze:'+query.epoch);
  if(context.signal.aborted)return held('snapshot-handler-aborted','reconciliation');
  const result=await service.assemble(payload.principal,query);
  if(context.signal.aborted)return held('snapshot-outcome-unknown','reconciliation');
  if(result.kind==='final'){
   const checkpoint=await context.checkpoint({stage:'board-already-final',epoch:result.epoch,snapshotId:result.snapshotId});
   return checkpoint.kind==='checkpointed'?{state:'completed',result:{epoch:result.epoch,snapshotId:result.snapshotId}}:held('snapshot-checkpoint-unknown','reconciliation');
  }
  const complete=['committed','replayed'].includes(result.kind),manifestDigest=complete?result.value.manifestDigest:result.manifestDigest??null;
  const checkpoint=await context.checkpoint({stage:complete?'input-sealed':'dependencies-pending',manifestDigest,reason:result.reason??result.code??null});
  if(checkpoint.kind!=='checkpointed')return held('snapshot-checkpoint-unknown','reconciliation');
  if(complete)return {state:'completed',result:{manifestDigest,inputDigest:result.value.inputDigest}};
  if(result.code==='revision_conflict'||result.code==='input_pointer_changed')return {state:'retry',reason:result.code,dependency:null,readyMs:clock.nowMs()+1000};
  return held(result.reason??result.code,'cutoff-evidence:'+query.epoch);
 };
}
