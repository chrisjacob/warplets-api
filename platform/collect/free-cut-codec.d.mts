import type {CanonicalCrypto} from '../application/ports';
export const COLLECTION_CUT_BOUNDS:Readonly<{recordBytes:65536;pageHoldings:100;pages:100;holdings:10000;summaryReadBytes:1048576}>;
export interface CollectionCutRecord {readonly id:string;readonly size:number;readonly bytes:Uint8Array}
export interface CollectionCutHolding {readonly id:string;readonly owner:string;readonly collection:string;readonly level:number|null;readonly revealedAt:number|null}
export interface CollectionCutPageBody {readonly format:'collection-cut-page-v1';readonly index:number;readonly holdings:readonly CollectionCutHolding[]}
export interface CollectionCutPageDescriptor {readonly index:number;readonly id:string;readonly count:number;readonly firstAsset:string|null;readonly lastAsset:string|null}
export interface CollectionCutRootBody {readonly format:'collection-cut-root-v1';readonly inventoryId:string;readonly stageId:string;readonly termsDigest:string;readonly atMs:number;readonly sourceRef:string;readonly sourceKind:'synthetic-local-operator-fixture';readonly eligibilityListId:string;readonly holdingCount:number;readonly pages:readonly CollectionCutPageDescriptor[]}
export interface VerifiedCollectionCutRecord {readonly id:string;readonly size:number;readonly format:CollectionCutPageBody['format']|CollectionCutRootBody['format'];readonly bodyJson:string;readonly body:CollectionCutPageBody|CollectionCutRootBody}
export interface CollectionCutAttempt {readonly id:string;readonly rootId:string;readonly sourceRevision:string}
export interface TrackedCollectionCutAsset {readonly id:string;readonly owner:string;readonly bindMs:number;readonly revealMs:number|null;readonly level:number;readonly ownerObservedMs:number}
export interface KnownCollectionCutAsset {readonly id:string;readonly kind:'genesis'|'season';readonly bindMs:number}
export interface CollectionCutPageSummary {readonly attemptId:string;readonly rootId:string;readonly sourceRevision:string;readonly pageId:string;readonly pageIndex:number;readonly holdingCount:number;readonly trackedCount:number;readonly firstAsset:string|null;readonly lastAsset:string|null;readonly eligibleWallets:readonly string[];readonly closureDigest:string}
export interface CollectionCutStage {readonly inventoryId:string;readonly stageId:string;readonly kind:'season';readonly type:'free';readonly opensAtMs:number;readonly termsDigest:string}
export interface CollectionCutList {readonly id:string;readonly count:number;readonly walletsDigest:string;readonly indexedCount:number}
export interface CollectionCutSeal {readonly inventoryId:string;readonly stageId:string;readonly atMs:number;readonly rootId:string;readonly attemptId:string;readonly eligibilityListId:string;readonly eligibleWallets:number;readonly walletsDigest:string;readonly sourceRef:string;readonly sourceRevision:string;readonly commitmentKind:'paged-fixed-cut-v1';readonly source:'local-fixture';readonly executable:false}
export function captureCollectionCutRecord(value:CollectionCutRecord):CollectionCutRecord;
export function prepareCollectionCutRecord(value:CollectionCutRecord,crypto:CanonicalCrypto):Promise<VerifiedCollectionCutRecord>;
/** Offline fixture/import operation; runtime checks one bounded page. */
export function encodeCollectionCut(value:Readonly<{inventoryId:string;stageId:string;termsDigest:string;atMs:number;sourceRef:string;eligibilityListId:string;holdings:readonly CollectionCutHolding[]}>,crypto:CanonicalCrypto):Promise<{root:CollectionCutRecord;pages:CollectionCutRecord[]}>;
export function collectionCutAttemptId(rootId:string,sourceRevision:string,crypto:CanonicalCrypto):Promise<string>;
export function prepareCollectionCutPage(value:Readonly<{rootRecord:CollectionCutRecord;pageRecord:CollectionCutRecord;attempt:CollectionCutAttempt;tracked:readonly TrackedCollectionCutAsset[];suppliedKnown:readonly KnownCollectionCutAsset[];nowMs:number}>,crypto:CanonicalCrypto):Promise<CollectionCutPageSummary>;
export function prepareCollectionCutSeal(value:Readonly<{rootRecord:CollectionCutRecord;attempt:CollectionCutAttempt;pages:readonly CollectionCutPageSummary[];list:CollectionCutList;stage:CollectionCutStage;nowMs:number}>,crypto:CanonicalCrypto):Promise<CollectionCutSeal>;
