import type {Principal,OperatorPrincipal,Revisions,GuardedAdmissionRepository,CanonicalCrypto,AdmissionResult,FinalReviewResult,Leaderboard,Claims,SubmissionPage} from '../application/ports';
import type {EarnReadRepository,EarnCapacity,EarnActions} from '../storage/earn-reads.mjs';
import type {AtomicActionRepository,ActionCompletionInput,AcceptedActionCompletion} from '../storage/atomic-actions.mjs';
export interface GuardedEarnService{
 submitContent(principal:Principal,input:{tokenId:string;url:string;requestKey:string}):Promise<AdmissionResult>;
 recordFinalReview(principal:OperatorPrincipal,input:{submissionId:string;score:number;reason:string;sourceRef:string;expectedRevisions?:Revisions}):Promise<FinalReviewResult>;
 readLeaderboard(epoch:number):Promise<Leaderboard>;
 readWalletClaims(principal:Principal,args?:{after?:number}):Promise<Claims>;
 readWalletSubmissions(principal:Principal,args?:{after?:number}):Promise<SubmissionPage>;
 readCapacity():Promise<EarnCapacity>;
 readActions():Promise<EarnActions>;
 acceptSignedCompletion(principal:Principal,input:ActionCompletionInput):Promise<AcceptedActionCompletion>;
}
export function createGuardedEarnService(options:{guarded:GuardedAdmissionRepository;reads:EarnReadRepository;actions:AtomicActionRepository;crypto:CanonicalCrypto;clock:{nowMs():number}}):GuardedEarnService;
export function unwrapEarnOutcome<T>(result:T):T;
