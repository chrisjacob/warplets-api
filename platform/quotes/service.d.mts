import type {ArtifactStore} from '../artifacts/store';
import type {CanonicalCrypto,OperatorPrincipal,RepositoryOutcome} from '../application/ports';
import type {QuoteDto,QuoteRequest} from '../application/quotes';
import type {QuoteRepository} from './repository.mjs';
export interface QuoteService {
 bind(principal:OperatorPrincipal,input:{marketId:string;sourceId:string;sourceRevision:string;previousBinding?:string|null}):Promise<RepositoryOutcome<unknown>>;
 materialize(principal:OperatorPrincipal,marketId:string):Promise<{kind:string;value?:unknown;reason?:string;code?:string}>;
 quote(request:QuoteRequest):Promise<QuoteDto>;
 availability(marketId:string):Promise<{available:boolean;expiresAt?:string;attDecimals?:number;ogDecimals?:number;reason?:string;source:'local-fixture';executable:false}>;
}
export function createQuoteService(ports:{repository:QuoteRepository;store:ArtifactStore;crypto:CanonicalCrypto;clock:{nowMs():number}}):QuoteService;
