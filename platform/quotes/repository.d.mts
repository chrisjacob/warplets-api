import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,OperatorPrincipal,RepositoryOutcome} from '../application/ports';
import type {EvidenceSource} from '../evidence/types';
import type {QuoteMarket,QuoteSupply} from '../application/quotes';
export const BIND_QUOTE_SOURCE:'quotes.bind-source.v1';
export const RECORD_QUOTE_INPUT:'quotes.record-input.v1';
export type QuoteCommand={operationKind:typeof BIND_QUOTE_SOURCE|typeof RECORD_QUOTE_INPUT;principal:OperatorPrincipal;input:Readonly<Record<string,unknown>>;businessIdentity:string;requestKey:string;nowMs:number;expectedRevisions:Readonly<Record<string,string>>;requestDigest:string};
export interface QuoteRepository {
 findInput(principal:OperatorPrincipal,inputDigest:string):Promise<RepositoryOutcome<unknown>|null>;
 metadata(marketId:string):Promise<{market:QuoteMarket;supply:QuoteSupply;supplyActivationMs:number}|null>;
 readSource(sourceId:string,sourceRevision:string):Promise<{digest:string;source:EvidenceSource}|null>;
 readContext(marketId:string):Promise<Record<string,unknown>|null>;
 bind(command:QuoteCommand):Promise<RepositoryOutcome<unknown>>;
 recordInput(command:QuoteCommand):Promise<RepositoryOutcome<unknown>>;
}
export function quoteCommandBytes(command:QuoteCommand):Uint8Array;
export function createQuoteRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string}}):QuoteRepository;
