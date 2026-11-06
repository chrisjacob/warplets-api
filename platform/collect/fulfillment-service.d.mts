import type {OperatorPrincipal,CanonicalCrypto,RepositoryOutcome} from '../application/ports';
export const FULFILL_COLLECTION_PROGRESSION:'collection.fulfill-operation.v1';
export class CollectionFulfillmentInputError extends TypeError{readonly code:string;readonly status:400;}
export interface CollectionFulfillmentInput{readonly operationId:string;readonly evidenceReceiptId:string;readonly evidenceDigest:string}
export interface CollectionFulfillmentCommand{readonly operationKind:typeof FULFILL_COLLECTION_PROGRESSION;readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:CollectionFulfillmentInput;readonly businessIdentity:string;readonly requestDigest:string}
export interface CollectionFulfillmentResult{readonly operationId:string;readonly inventoryId:string;readonly kind:'upgrade'|'visual';readonly targetId:string;readonly materialId:string|null;readonly proofId:string;readonly effectiveMs:number;readonly status:'fulfilled';readonly provenance:'manual-fixture'|'configured-offline-beacon';readonly evidenceReceiptId:string;readonly source:'local-fixture';readonly executable:false}
export interface CollectionFulfillmentRepository{fulfill(command:CollectionFulfillmentCommand):Promise<RepositoryOutcome<CollectionFulfillmentResult>>}
export function collectionFulfillmentBytes(command:Omit<CollectionFulfillmentCommand,'requestDigest'>):Uint8Array;
export function buildCollectionFulfillmentCommand(principal:OperatorPrincipal,input:CollectionFulfillmentInput&{requestKey:string},crypto:CanonicalCrypto):Promise<CollectionFulfillmentCommand>;
export function createCollectionFulfillmentService(ports:{repository:CollectionFulfillmentRepository;crypto:CanonicalCrypto}):{fulfill(principal:OperatorPrincipal,input:CollectionFulfillmentInput&{requestKey:string}):Promise<RepositoryOutcome<CollectionFulfillmentResult>>};
