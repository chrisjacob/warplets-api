import type {AtomicDriver} from './atomic-earn.mjs';
import type {Principal,Leaderboard,Claims,SubmissionPage} from '../application/ports';
export type EarnReadPending={kind:'pending';reason:string;dependencyIds:readonly string[]};
export type EarnCapacity={mode:'local-fixture';epoch:number;limit:number;admitted:number;remaining:number;accepting:boolean;policy:string};
export type EarnActions={mode:'local-fixture';epoch:number;items:{actionId:string;label:string;verifier:string;startEpoch:number}[]};
export interface EarnReadRepository {
 readLeaderboard(query:{epoch:number}):Promise<Leaderboard|EarnReadPending>;
 readWalletClaims(query:{principal:Principal;nowMs:number;after?:number}):Promise<Claims|EarnReadPending>;
 readWalletSubmissions(query:{principal:Principal;nowMs:number;after?:number}):Promise<SubmissionPage|EarnReadPending>;
 readCapacity(query:{nowMs:number}):Promise<EarnCapacity|EarnReadPending>;
 readActions(query:{nowMs:number}):Promise<EarnActions|EarnReadPending>;
}
export function createEarnReadRepository(driver:AtomicDriver):EarnReadRepository;
