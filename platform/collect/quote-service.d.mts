import type {CanonicalCrypto,Principal,RepositoryOutcome} from '../application/ports';
import type {ImmutableProgressionQuote} from '../application/collections';
export const ISSUE_COLLECTION_QUOTE:'collection.issue-quote.v1';
export const COLLECTION_QUOTE_POLICY:'collection-progression-v1';
export const COLLECTION_QUOTE_TTL_MS:120000;
export class CollectionQuoteInputError extends TypeError {readonly code:string;readonly status:400;}
export interface CollectionQuoteInput {readonly kind:'upgrade'|'visual';readonly inventoryId:string;readonly targetId:string;readonly materialId?:string|null;readonly expectedTargetVersion:number;readonly expectedMaterialVersion?:number|null;readonly maxTotalLamports?:string|null}
export interface NormalizedCollectionQuoteInput extends CollectionQuoteInput {readonly materialId:string|null;readonly expectedMaterialVersion:number|null;readonly maxTotalLamports:string|null}
export interface CollectionQuoteIssueCommand {readonly operationKind:typeof ISSUE_COLLECTION_QUOTE;readonly principal:Principal;readonly requestKey:string;readonly input:NormalizedCollectionQuoteInput;readonly businessIdentity:string;readonly requestDigest:string}
export type StoredCollectionQuoteRead=Readonly<{kind:'missing'}>|Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>|Readonly<{kind:'found';quote:ImmutableProgressionQuote;lifetime:'not-yet-valid'|'within-window'|'expired';currentStateVerified:false;executable:false}>;
export interface CollectionQuoteRepository {issueQuote(command:CollectionQuoteIssueCommand):Promise<RepositoryOutcome<ImmutableProgressionQuote>>;readQuote(principal:Principal,id:string):Promise<StoredCollectionQuoteRead>}
export interface CollectionQuoteService {issueQuote(principal:Principal,input:CollectionQuoteInput&{requestKey:string}):Promise<RepositoryOutcome<ImmutableProgressionQuote>>;readQuote(principal:Principal,id:string):Promise<StoredCollectionQuoteRead>}
export function quotePrincipal(principal:Principal):Principal;
export function normalizeCollectionQuoteInput(input:CollectionQuoteInput):NormalizedCollectionQuoteInput;
export function collectionQuoteCommandBytes(command:Omit<CollectionQuoteIssueCommand,'requestDigest'>):Uint8Array;
export function collectionQuoteBusinessIdentity(principal:Principal,requestKey:string,crypto:CanonicalCrypto):Promise<string>;
export function buildCollectionQuoteCommand(principal:Principal,input:CollectionQuoteInput&{requestKey:string},crypto:CanonicalCrypto):Promise<CollectionQuoteIssueCommand>;
export function createCollectionQuoteService(ports:{repository:CollectionQuoteRepository;crypto:CanonicalCrypto}):CollectionQuoteService;
