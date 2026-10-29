/** New launchpad contracts. Amounts are decimal strings; dates are UTC ISO 8601. */
export type Finality = 'provisional' | 'final';
export interface Participant { fid:number; solanaWallet:string|null; baseWallets:string[] }
export interface Candidate { id:string; name:string; symbol:string; ogMint:string; uniqueVoters:number; weightedVotes:number; screening:'pending'|'reviewed'; evidence:string[] }
export interface Round { id:string; opensAt:string; closesAt:string; state:'scheduled'|'open'|'closed'|'selected'|'skipped'; candidates:Candidate[]; selectedCandidateId:string|null; finality:Finality }
export interface Vote { roundId:string; fid:number; candidateId:string; firstValidVoteAt:string; finality:Finality }
export interface BoostBreakdown { base:1; warplet:number; holding:number; streak:number; total:number; featuredAttribute:string; eligibleLevel:number; ownershipFrozenAt:string; rewardPoints:number; voteWeight:number; finality:Finality }
export interface Edition { id:string; name:string; symbol:string; tokenMint:string; ogMint:string; launchedAt:string; state:'planned'|'launched'|'skipped'; finality:Finality }
export interface Campaign { editionId:string; totalSupply:string; liquidityBps:9000; rewardsBps:1000; releaseCount:10; firstReleaseAt:string; lastReleaseAt:string; finality:Finality }
export interface Entitlement { id:string; editionId:string; roundId:string; fid:number; amount:string; releaseAt:string; finality:Finality }
export interface Claim { id:string; entitlementIds:string[]; state:'available'|'pending'|'claimed'; transactionSignatures:string[]; finality:Finality }
export interface LaunchpadPreview { mode:'fixture'; actionsEnabled:false; asOf:string; participant:Participant; round:Round; boost:BoostBreakdown; editions:Edition[]; campaigns:Campaign[]; entitlements:Entitlement[]; claims:Claim[] }
