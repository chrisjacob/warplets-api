export interface VaultAllocationProjection {
  marketId:string;allocated:string;vested:string;claimed:string;claimable:string;manifestDigest:string;
  activatedAt:string;cliffEndsAt:string;fullyVestedAt:string;
}
export type MemberVaultSummary={source:'local-fixture';asOf:string} & (
  {status:'complete';reason:null;assetCount:number;items:VaultAllocationProjection[]}|
  {status:'unavailable';reason:'asset-bound'|'manifest-bound'|'concealed-metadata';assetCount:null;items:[]}
);
/** Recorded bind/transfer only. Reveal and claim events cannot refresh ownership age. */
export function ownerObservedAt(db:unknown,id:string):string|null;
/** Complete bounded local ledger only. Concealed holdings suppress the entire summary. */
export function memberVaultSummary(db:unknown,wallet:string,now:number):MemberVaultSummary;
