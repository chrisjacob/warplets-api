import type {Participant,Edition,Entitlement,Candidate} from '../shared/contracts';
export interface IdentityAdapter { verify(request:Request):Promise<Participant|null> }
export interface WarpletOwnershipAdapter { freeze(input:{fid:number;before:string}):Promise<{snapshotId:string;highestLevels:Record<string,number>}> }
export interface ScreeningAdapter { review(ogMint:string):Promise<Pick<Candidate,'screening'|'evidence'>> }
export interface LaunchExecutionAdapter { execute(edition:Edition,idempotencyKey:string):Promise<{transactionSignature:string}> }
export interface DistributionAdapter { allocate(entitlements:Entitlement[],idempotencyKey:string):Promise<{allocationId:string}> }
export interface LaunchpadAdapters { identity:IdentityAdapter; ownership:WarpletOwnershipAdapter; screening:ScreeningAdapter; launch:LaunchExecutionAdapter; distribution:DistributionAdapter }
// Interfaces only. This skeleton constructs no production adapters or signing clients.
