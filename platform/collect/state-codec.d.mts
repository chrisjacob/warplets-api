import type {CanonicalCrypto,JsonValue} from '../application/ports';
export interface CollectionSourceRecord {readonly id:string;readonly size:number;readonly bytes:Uint8Array}
export interface CollectionSourceBundle {readonly root:CollectionSourceRecord;readonly listManifests:readonly CollectionSourceRecord[];readonly pages:readonly CollectionSourceRecord[]}
export interface CollectionSourcePage {format:'collection-page-v1';kind:'eligibility'|'admissions';index:number;entries:JsonValue[]}
export interface CollectionListManifest {format:'collection-list-v1';count:number;pageCount:number;pageIds:string[];walletsDigest:string}
export interface CollectionSourceRoot {format:'collection-source-v1';source:{inventoryId:string;revision:string;stateDigest:string};inventory:{[key:string]:JsonValue};stages:Array<{terms:{[key:string]:JsonValue};eligibility:{kind:'list'|'pending'|'unrestricted';manifestId:string|null}}>;admissions:{count:number;pageIds:string[]}}
export type CollectionSourceDocument=CollectionSourcePage|CollectionListManifest|CollectionSourceRoot;
export interface CollectionStateCodec {
 encodeWalletList(wallets:readonly string[]):Promise<{readonly manifest:CollectionSourceRecord;readonly pages:readonly CollectionSourceRecord[]}>;
 encodeReferenceInventory(state:unknown):Promise<CollectionSourceBundle>;
 decodeReferenceInventory(bundle:CollectionSourceBundle):Promise<unknown>;
 verifyRecord(record:CollectionSourceRecord,expectedId?:string):Promise<CollectionSourceDocument>;
}
export function createCollectionStateCodec(ports:{crypto:CanonicalCrypto}):CollectionStateCodec;
