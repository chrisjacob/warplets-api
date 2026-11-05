import { computeBoard, computeAllocation } from './settlement.mjs';
import { EarnError, name, nat, requireValue, canonicalContentUrl } from './validation.mjs';
import { ADMIT_SUBMISSION, admissionRequestBytes, FINAL_REVIEW, reviewRequestBytes } from '../application/commands.mjs';
function walletPrincipal(principal) {
  if(principal?.kind!=='wallet')throw new EarnError(401,'authentication_required','Connect your wallet.');
  return Object.freeze({kind:'wallet',wallet:name(principal.wallet,'wallet')});
}
async function settle(query,load,compute,commit) {
  for(let attempt=0;attempt<2;attempt++) {
    const loaded=await load(query);
    if(loaded.result)return loaded.result;
    const plan=compute(loaded.input);
    if(plan.status!=='ready')return {mode:'local-fixture',status:plan.status,epoch:query.epoch??plan.boardEpoch,
      ...(query.tokenId?{tokenId:query.tokenId,day:query.day}:{reason:plan.reason})};
    const result=await commit({query,versions:loaded.versions,plan});
    if(result.kind==='committed'||result.kind==='replayed')return result.value;
    if(result.kind==='pending')return {mode:'local-fixture',status:'pending',epoch:query.epoch??plan.boardEpoch,reason:result.reason};
    if(result.kind!=='conflict')throw new TypeError('Unknown settlement outcome.');
  }
  return {mode:'local-fixture',status:'pending',epoch:query.epoch,reason:'revision-conflict'};
}
export function createEarnService(context) {
  if(context.executionPolicy?.mode!=='local-validation'||context.executionPolicy.financialExecution!==false)
    throw new TypeError('Financial execution is unavailable.');
  const repository=context.repositories.earn;
  return Object.freeze({
    async submitContent(principal,{tokenId,url,requestKey}) {
      principal=walletPrincipal(principal);name(tokenId,'token');
      requireValue(typeof requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey),'Supply an Idempotency-Key of 1–128 characters.');
      const input=Object.freeze({tokenId,url:canonicalContentUrl(url)}),nowMs=nat(context.clock.nowMs(),'now');
      const requestDigest=await context.crypto.sha256(admissionRequestBytes({principal,input}));
      return await repository.admitSubmission(Object.freeze({principal,operationKind:ADMIT_SUBMISSION,
        businessIdentity:principal.wallet+'/'+tokenId,requestKey,requestDigest,expectedRevisions:Object.freeze({}),input,nowMs}));
    },
    async recordFinalReview(principal,{submissionId,score,reason,sourceRef,expectedRevisions={}}) {
      if(principal?.kind!=='operator')throw new EarnError(403,'operator_required','Operator authentication required.');
      principal=Object.freeze({kind:'operator',id:name(principal.id,'operator')});
      name(submissionId,'submission');name(reason,'score reason');name(sourceRef,'source reference');
      requireValue(Number.isInteger(score)&&score>=0&&score<=10,'Score must be 0–10.');
      const input=Object.freeze({submissionId,score,reason,sourceRef});
      const expected=Object.freeze({...expectedRevisions});
      const requestDigest=await context.crypto.sha256(reviewRequestBytes({principal,input}));
      return await repository.recordFinalReview(Object.freeze({principal,operationKind:FINAL_REVIEW,
        businessIdentity:submissionId,requestKey:submissionId,requestDigest,expectedRevisions:expected,
        input,nowMs:nat(context.clock.nowMs(),'now')}));
    },
    async finalizeBoard({epoch,sourceComplete,sourceRef}) {
      const query={epoch:nat(epoch,'epoch'),nowMs:nat(context.clock.nowMs(),'now'),sourceComplete,sourceRef:name(sourceRef,'source reference')};
      return await settle(query,repository.loadBoardInput,computeBoard,repository.commitBoard);
    },
    async recordAllocation({tokenId,day}) {
      name(tokenId,'token');requireValue(Number.isInteger(day)&&day>=1&&day<=10,'Invalid campaign day.');
      return await settle({tokenId,day,nowMs:nat(context.clock.nowMs(),'now')},repository.loadAllocationInput,computeAllocation,repository.commitAllocation);
    },
    async readLeaderboard(epoch) {return await repository.readLeaderboard({epoch:nat(epoch,'epoch')});},
    async readWalletClaims(principal,{after=0}={}) {
      return await repository.readWalletClaims({principal:walletPrincipal(principal),nowMs:nat(context.clock.nowMs(),'now'),after:nat(after,'cursor')});
    },
    async readWalletSubmissions(principal,{after=0}={}) {
      return await repository.readWalletSubmissions({principal:walletPrincipal(principal),after:nat(after,'cursor'),nowMs:nat(context.clock.nowMs(),'now')});
    },
  });
}
