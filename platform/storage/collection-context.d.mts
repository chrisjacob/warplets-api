import type {AtomicDriver} from './atomic-earn.mjs';
import type {Principal,Revisions} from '../application/ports';
import type {ProgressionQuoteContext,DeriveProgressionQuote} from '../application/collection-quotes.mjs';
export const COLLECTION_CONTEXT_BYTES:65536;
export const COLLECTION_ASSET_BYTES:16384;
export interface CollectionContextSnapshot {readonly revisions:Revisions;readonly nowMs:number;readonly inventory:Readonly<{id:string;kind:'genesis'|'season';tranche:number|null;seasonStartMs:number|null;seasonMonth:string|null;revision:string;originDigest:string}>|null;
 readonly assets:readonly Readonly<{id:string;inventoryId:string;owner:string;bindMs:number;observedMs:number;revealMs:number|null;assetBytes:number;assetJson:string|null;ownerObservedAtMs:number|null;ownerEventId:string|null;ownerEventKind:string|null;ownerEvidenceJson:string|null}>[]}
export interface CollectionContextRepository {readProgressionContext(input:{wallet:string;inventoryId:string;assetIds:readonly string[];nowMs:number}):Promise<CollectionContextSnapshot>}
export type CollectionContextResult=Readonly<{kind:'ready';context:ProgressionQuoteContext;revisions:Revisions;inventoryRevision:string;observedAtMs:number}>|Readonly<{kind:'unavailable';reason:string;revisions?:Revisions}>;
export interface CollectionContextService {read(principal:Principal,input:{inventoryId:string;request:DeriveProgressionQuote['request']}):Promise<CollectionContextResult>}
export function createCollectionContextRepository(driver:AtomicDriver):CollectionContextRepository;
export function createCollectionContextService(ports:{repository:CollectionContextRepository;clock:{nowMs():number}}):CollectionContextService;
