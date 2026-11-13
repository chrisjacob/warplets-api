import type {PlatformClient} from '../contracts/client.mjs';
export type ReviewFeedback=Awaited<ReturnType<PlatformClient['getEarnReviewFeedback']>>['data'];
export type ReviewPrincipal={kind:'wallet';wallet:string};
export type ReviewStatement={sql:string;values:(string|number|null)[]};
export function createReviewFeedbackService(ports:{
 driver:{batch(statements:readonly ReviewStatement[]):Promise<{rows:Record<string,string|number|null>[];changes:number}[]>};
 crypto:{sha256(bytes:Uint8Array):Promise<string>};
 clock:{nowMs():number};
}):Readonly<{
 walletStatus(principal:ReviewPrincipal,submissionId:string):Promise<ReviewFeedback>;
 appeal(principal:ReviewPrincipal,input:{submissionId:string;reportId:string;reason:string;requestKey:string}):Promise<{outcome:'created'|'replayed';review:ReviewFeedback}>;
}>;
