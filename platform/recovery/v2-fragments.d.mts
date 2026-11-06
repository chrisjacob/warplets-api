import type {ArtifactIdentity,CanonicalCrypto} from '../application/ports';
export const RECOVERY_FRAGMENT_LIMITS:Readonly<{rowBytes:1048576;chunkCharacters:8192;chunkBytes:32768;chunks:128;descriptorBytes:65536}>;
export const RECOVERY_FRAGMENT_COLUMNS:readonly ['inventory_id','policy_hash','traits','registered_ms'];
export interface RecoveryFragmentHeader {
 readonly format:'10x.local.recovery.fragmented-row.v2';readonly table:'fair_inventories';readonly schemaFingerprint:string;
 readonly index:number;readonly columns:typeof RECOVERY_FRAGMENT_COLUMNS;readonly hasRowid:true;
 readonly after:readonly[number]|null;readonly cursor:readonly[number];readonly encoding:'sqlite-json-array-text-utf8-v1';readonly characters:number;readonly bytes:number;
}
export interface RecoveryFragmentReference {readonly index:number;readonly offset:number;readonly characters:number;readonly identity:ArtifactIdentity}
export interface RecoveryFragmentDescriptor extends RecoveryFragmentHeader {readonly fragments:readonly RecoveryFragmentReference[]}
export interface RecoveryFragmentCodec {
 encodeChunk(text:string):Promise<{text:string;characters:number;bytes:Uint8Array;identity:ArtifactIdentity}>;
 verifyChunk(bytes:Uint8Array,identity:ArtifactIdentity,expectedCharacters?:number):Promise<Readonly<{text:string;characters:number;identity:ArtifactIdentity}>>;
 encodeRowDescriptor(value:RecoveryFragmentDescriptor):Promise<{value:RecoveryFragmentDescriptor;bytes:Uint8Array;identity:ArtifactIdentity}>;
 verifyRowDescriptor(bytes:Uint8Array,identity:ArtifactIdentity):Promise<RecoveryFragmentDescriptor>;
}
export function recoveryFragmentCharacters(text:string):number;
export function recoveryFragmentHeader(value:RecoveryFragmentHeader):RecoveryFragmentHeader;
export function recoveryFragmentDescriptor(value:RecoveryFragmentDescriptor):RecoveryFragmentDescriptor;
export function createRecoveryV2FragmentCodec(ports:{crypto:CanonicalCrypto}):RecoveryFragmentCodec;
