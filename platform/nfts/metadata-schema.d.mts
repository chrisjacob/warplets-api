export interface CollectAssetMetadata {readonly id:string;readonly owner:string;readonly level:number;readonly traits:Readonly<{model:string;backdrop:string;symbol:string}>;readonly version:number;readonly rerolls:number;readonly eligibleAt:number;readonly pending:string|null;readonly expiresAt:number|null}
export type CollectMetadataInventory=Readonly<{id:string;kind:'genesis';tranche:number;season_start:null}>|Readonly<{id:string;kind:'season';tranche:null;season_start:number}>;
export type CollectMetadataSlot=Readonly<{kind:'genesis';tranche:number;level:number;ordinal:number}>|Readonly<{kind:'season';seasonId:string;slotIndex:number}>;
export interface CollectMetadataSource {readonly inventory:CollectMetadataInventory;readonly row:Readonly<{id:string;inventory_id:string;owner:string;asset:string;slot:string;bind_ms:number;reveal_ms:number|null;observed_ms:number}>}
/** Private projection only; concealed traits/coordinates MUST NOT be published. */
export interface PrivateCollectMetadata {readonly format:'10x.private-collect-metadata.v1';readonly visibility:'private-internal';readonly inventory:CollectMetadataInventory;readonly asset:CollectAssetMetadata;readonly slot:CollectMetadataSlot;readonly bindMs:number;readonly revealMs:number|null;readonly observedMs:number;readonly source:'local-fixture';readonly financialState:'not-applicable-local';readonly financialExecution:false}
export const METADATA_FORMAT:'10x.private-collect-metadata.v1';
export const METADATA_LIMITS:Readonly<{inputBytes:32768;assetBytes:16384;slotBytes:4096}>;
export function metadataFromCollect(input:CollectMetadataSource):PrivateCollectMetadata;
export function validateMetadata(value:PrivateCollectMetadata):PrivateCollectMetadata;
export function captureMetadata<T>(value:T):T;
export function metadataFreeze<T>(value:T):Readonly<T>;
export function metadataNeed(ok:unknown,code:string):asserts ok;
export function metadataExact(value:unknown,keys:readonly string[]):void;
export function metadataId(value:unknown):void;
export function metadataTime(value:unknown):void;
export function metadataCounter(value:unknown):void;
export function metadataHash(value:unknown):void;
export function metadataWallet(value:unknown):void;
export function sameMetadata(a:unknown,b:unknown):boolean;
