import {DAY_MS,MIN_STAKE_MICRO_USD,onboardingTenths,multiplierTenths} from '../domain/earn/index.mjs';
export function displayFinalComponents(row,payload){
 if(!row)return null;
 const components={actionTenths:onboardingTenths(row.epoch,payload.intervals,payload.completions),streakDays:row.streak_days??0,
  highestEligibleLevel:payload.highestEligibleLevel,purchaseTokenDays:payload.purchaseTokenDays};
 return {epoch:row.epoch,cutoffAt:new Date((row.epoch+1)*DAY_MS-1).toISOString(),...components,multiplierTenths:multiplierTenths(components),
  sourceRef:row.source_ref,snapshotDigest:row.snapshot_hash};
}
export function displayMemberStatus({nowMs,epoch,recovery,capacity,decision,boardClosed,campaigns,observations,accepted,actions,final,finalPayload,unavailable=null}){
 const held=recovery?'read-only-archive':!decision.allowed?decision.reason:!capacity?.accepting?'board-capacity':boardClosed?'board-closed':null;
 const admission=unavailable?{status:'unavailable',reason:unavailable,items:[]}:{status:'complete',reason:null,items:campaigns.map(({token_id:tokenId})=>{
  const valuation=observations.get(tokenId)??{status:'pending'},prior=accepted.has(tokenId);
  const reason=prior?'already-accepted':held??(valuation.status!=='verified'?'stake-evidence-pending':BigInt(valuation.microUsd)<MIN_STAKE_MICRO_USD?'stake-ineligible':null);
  return {tokenId,status:prior?'accepted':reason===null?'eligible':reason==='stake-evidence-pending'?'pending':'held',reason,
   stakeMicroUsd:valuation.status==='verified'?valuation.microUsd:null,stakeObservedAt:valuation.asOfMs===undefined?null:new Date(valuation.asOfMs).toISOString(),sourceRef:valuation.receipt??null};
 })};
 return {mode:'local-fixture',asOf:new Date(nowMs).toISOString(),epoch,admission,
  actions:actions.length>100?{status:'unavailable',reason:'action-bound',items:[]}:{status:'complete',reason:null,items:actions.map(a=>({actionId:a.actionId,label:a.label,verifier:a.verifier,startEpoch:a.startEpoch,
   status:a.verified_ms===null?'pending':'verified',verifiedAt:a.verified_ms===null?null:new Date(a.verified_ms).toISOString(),sourceRef:a.source_ref}))},
  currentCutoff:{status:'pending',reason:'board-not-sealed',cutoffAt:new Date((epoch+1)*DAY_MS-1).toISOString()},
  latestFinalComponents:displayFinalComponents(final,finalPayload),multiplierBounds:{minimumTenths:1,maximumTenths:100}};
}
