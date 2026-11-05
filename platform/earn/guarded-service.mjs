import {createEarnService} from './service.mjs';
import {createActionCommand} from '../storage/atomic-actions.mjs';
import {EarnError,nat} from './validation.mjs';
const errors={
 'stake-evidence':[503,'stake_evidence_pending','A current position read is required.'],
 'staffing-required':[503,'staffing_required','Staffed admission capacity is not configured.'],
 'operator-pause':[409,'scope_paused','New Earn admissions are paused.'],
 'read_only_archive':[409,'read_only_archive','Public archive serves existing awards.'],
 'stake_ineligible':[422,'stake_ineligible','The token requires at least $10 staked.'],
 'board_capacity':[409,'board_capacity','This board has reached its staffed capacity.'],
 'campaign_inactive':[409,'campaign_inactive','This campaign is not active.'],
 'already_submitted':[409,'already_submitted','A submission for this token and epoch already exists.'],
 'operator_scope_required':[403,'operator_scope_required','The operator lacks the required scope.'],
};
export function unwrapEarnOutcome(result){
 if(result.kind==='pending'||result.kind==='conflict'){
  const key=result.reason??result.code,args=errors[key]??[result.kind==='pending'?503:409,key.replaceAll('-','_'),'The Earn operation is not ready.'];
  throw new EarnError(...args);
 }return result;
}
// Reuse the common B01 command construction and domain validation. This facade
// adapts durable B02 receipts; it exposes no reference finalize/allocation flags.
export function createGuardedEarnService({guarded,reads,actions,crypto,clock}){
 const repository={
  ...reads,
  async admitSubmission(command){const result=unwrapEarnOutcome(await guarded.admitSubmission(command));return {...result.value,replay:result.kind==='replayed'||result.value.replay};},
  async recordFinalReview(command){const result=unwrapEarnOutcome(await guarded.recordFinalReview(command));return {...result.value,replayed:result.kind==='replayed'||result.value.replayed};},
  async readLeaderboard(query){return unwrapEarnOutcome(await reads.readLeaderboard(query));},
  async readWalletClaims(query){return unwrapEarnOutcome(await reads.readWalletClaims(query));},
  async readWalletSubmissions(query){return unwrapEarnOutcome(await reads.readWalletSubmissions(query));},
 };
 const service=createEarnService({repositories:{earn:repository},crypto,clock,executionPolicy:{mode:'local-validation',financialExecution:false}});
 return Object.freeze({
  submitContent:service.submitContent,recordFinalReview:service.recordFinalReview,readLeaderboard:service.readLeaderboard,
  readWalletClaims:service.readWalletClaims,readWalletSubmissions:service.readWalletSubmissions,
  async readCapacity(){return unwrapEarnOutcome(await reads.readCapacity({nowMs:nat(clock.nowMs(),'now')}));},
  async readActions(){return unwrapEarnOutcome(await reads.readActions({nowMs:nat(clock.nowMs(),'now')}));},
  async acceptSignedCompletion(principal,{actionId,proof,signature}){
   if(principal?.kind!=='wallet')throw new EarnError(401,'authentication_required','Connect your wallet.');
   const command=await createActionCommand({principal,input:{actionId,proof,signature},nowMs:nat(clock.nowMs(),'now')},crypto);
   const result=unwrapEarnOutcome(await actions.acceptCompletion(command));return {...result.value,replay:result.kind==='replayed'};
  },
 });
}
