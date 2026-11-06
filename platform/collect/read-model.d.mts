import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {Principal} from '../application/ports';
export type CollectionReadOutcome<T>={kind:'ready';value:T}|{kind:'missing'}|{kind:'pending';reason:string};
export interface CollectionAssetView {id:string;inventoryId:string;owner:string;revealStatus:'unrevealed'|'revealed';revealedAt:string|null;ownerObservedAt:string|null;evidenceStatus:'local-fixture';source:'local-fixture';executable:false;level?:number;traits?:{model:string;backdrop:string;symbol:string};version?:number;rerolls?:number;nextRerollAt?:string|null;expiresAt?:string|null;operationPending?:boolean}
export interface CollectionOperationView {id:string;kind:'mint'|'upgrade'|'visual';inventoryId:string;owner:string;stageId:string|null;targetId:string|null;materialId:string|null;status:'awaiting-evidence'|'fulfilled';createdAt:null;priceLamports:string|null;costLamports:string|null;feeLamports:string|null;assetId:string|null;source:'local-fixture';executable:false;quoteId?:string;bindingDigest?:string;fairness?:'manual-fixture'|'configured-offline-beacon';reconciliation?:{status:'held';reason:'external-transfer';observedAt:string}}
export interface CollectionReadPage<T>{items:T[];nextCursor:string|null}
export const COLLECTION_READ_LIMITS:Readonly<{page:25;recordBytes:16384;responseBytes:262144}>;
export interface CollectionReadRepository {
 readAsset(query:{assetId:string;nowMs:number}):Promise<CollectionReadOutcome<CollectionAssetView>>;
 listOwnedAssets(query:{principal:Principal;nowMs:number;after?:string}):Promise<CollectionReadOutcome<CollectionReadPage<CollectionAssetView>>>;
 listOwnOperations(query:{principal:Principal;nowMs:number;after?:string}):Promise<CollectionReadOutcome<CollectionReadPage<CollectionOperationView>>>;
 readOwnOperation(query:{principal:Principal;operationId:string;nowMs:number}):Promise<CollectionReadOutcome<CollectionOperationView>>;
}
export function createCollectionReadRepository(driver:AtomicDriver):CollectionReadRepository;
