export interface FinalizedMemberComponents {
  epoch:number; cutoffAt:string; actionTenths:number; streakDays:number; highestEligibleLevel:number;
  purchaseTokenDays:number; multiplierTenths:number; sourceRef:string; snapshotDigest:string;
}
export interface EarnMemberStatus {
  mode:'local-fixture'; asOf:string; epoch:number;
  admission:{status:'complete'|'unavailable';reason:string|null;items:Array<{
    tokenId:string;status:'accepted'|'eligible'|'pending'|'held';reason:string|null;
    stakeMicroUsd:string|null;stakeObservedAt:string|null;sourceRef:string|null;
  }>};
  actions:{status:'complete'|'unavailable';reason:string|null;items:Array<{
    actionId:string;label:string;verifier:string;startEpoch:number;status:'verified'|'pending';verifiedAt:string|null;sourceRef:string|null;
  }>};
  currentCutoff:{status:'pending';reason:'board-not-sealed';cutoffAt:string};
  latestFinalComponents:FinalizedMemberComponents|null;
  multiplierBounds:{minimumTenths:1;maximumTenths:100};
}
/** Requires the Node SQLite database. Principal must come from authenticated transport. */
export function readMemberStatus(db:unknown,principal:{kind:'wallet';wallet:string},nowMs:number):EarnMemberStatus;
export function finalizedMemberComponents(row:{epoch:number;payload:string;streak_days:number|null;source_ref:string;snapshot_hash:string}|null|undefined):FinalizedMemberComponents|null;
