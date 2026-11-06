import type {OperatorPrincipal,CanonicalCrypto,RepositoryOutcome} from '../application/ports';
export const OBSERVE_COLLECTION_ASSET:'collection.observe-asset.v1';
export class CollectionObservationInputError extends TypeError{readonly code:string;readonly status:400;}
export interface CollectionObservationInput{readonly assetId:string;readonly kind:'reveal'|'transfer';readonly from:string|null;readonly to:string|null;readonly observedMs:number;readonly expectedAssetVersion:number;readonly evidenceReceiptId:string;readonly evidenceDigest:string}
export interface CollectionObservationCommand{readonly operationKind:typeof OBSERVE_COLLECTION_ASSET;readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:CollectionObservationInput;readonly businessIdentity:string;readonly requestDigest:string}
export interface CollectionObservationResult{readonly sourceId:string;readonly assetId:string;readonly kind:'reveal'|'transfer';readonly observedMs:number;readonly owner:string;readonly revealMs:number|null;readonly assetVersion:number;readonly resultKind:'applied'|'held';readonly conflictId:string|null;readonly operationId:string|null;readonly evidenceReceiptId:string;readonly source:'local-fixture';readonly executable:false}
export interface CollectionObservationRepository{observe(command:CollectionObservationCommand):Promise<RepositoryOutcome<CollectionObservationResult>>}
export function normalizeCollectionObservation(value:CollectionObservationInput):CollectionObservationInput;
export function collectionObservationBytes(command:Omit<CollectionObservationCommand,'requestDigest'>):Uint8Array;
export function buildCollectionObservationCommand(principal:OperatorPrincipal,input:CollectionObservationInput&{requestKey:string},crypto:CanonicalCrypto):Promise<CollectionObservationCommand>;
export function createCollectionObservationService(ports:{repository:CollectionObservationRepository;crypto:CanonicalCrypto}):{observe(principal:OperatorPrincipal,input:CollectionObservationInput&{requestKey:string}):Promise<RepositoryOutcome<CollectionObservationResult>>};
