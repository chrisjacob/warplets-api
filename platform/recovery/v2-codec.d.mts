import type {ArtifactIdentity,CanonicalCrypto} from '../application/ports';
import type {RecoverySchema,PublicRecoveryPin} from './types';
export type RecoveryV2Cell=string|number|null;
export type RecoveryV2Cursor=readonly (string|number)[]|null;
export interface RecoveryV2Rows {format:'10x.local.recovery.rows.v2';table:string;index:number;columns:readonly string[];hasRowid:boolean;after:RecoveryV2Cursor;rows:readonly (readonly RecoveryV2Cell[])[]}
export interface RecoveryV2Pointer {identity:ArtifactIdentity|null;count:number}
export interface RecoveryV2Table {name:string;columns:readonly string[];primaryKey:readonly string[];hasRowid:boolean;rowCount:number;pages:RecoveryV2Pointer;tableDigest:string}
export interface RecoveryV2PageEntry {identity:ArtifactIdentity;index:number;rowCount:number;after:RecoveryV2Cursor;last:RecoveryV2Cursor}
export interface RecoveryV2Branch {first:string;last:string;count:number;identity:ArtifactIdentity}
export interface RecoveryV2Leaf {key:string;value:RecoveryV2Table|RecoveryV2PageEntry|ArtifactIdentity|PublicRecoveryPin}
export interface RecoveryV2Index {format:'10x.local.recovery.index.v2';kind:'tables'|'table-pages'|'objects'|'publications';level:number;entries:readonly (RecoveryV2Branch|RecoveryV2Leaf)[]}
export interface RecoveryV2Root {format:'10x.local.recovery.v2';mode:'private';createdMs:number;sourceCommit:string;schema:RecoverySchema;snapshot:{generation:string;watermark:string};tables:RecoveryV2Pointer;objects:RecoveryV2Pointer;publications:RecoveryV2Pointer;checkpoints:ArtifactIdentity;totals:{rows:number;objects:number;bytes:number};authPolicy:'revoke-sessions-and-fence-leases'}
export interface RecoveryV2Encoded<T>{value:Readonly<T>;bytes:Uint8Array;identity:ArtifactIdentity}
export interface RecoveryV2Pinned {value:Readonly<RecoveryV2Root>;bytes:Uint8Array;digest:string}
export const RECOVERY_V2_LIMITS:Readonly<{rootBytes:262144;indexBytes:131072;pageBytes:131072;sourcePageBytes:196608;pageRows:100;indexEntries:100;indexLevels:8;tableRows:65536;tables:128;objects:16384;totalBytes:134217728;stepOperations:64;stepWorkingBytes:1048576;publicStepWorkingBytes:4194304}>;
export interface RecoveryV2Codec {
 encodeRows(value:RecoveryV2Rows):Promise<RecoveryV2Encoded<RecoveryV2Rows>>;
 encodeIndex(value:RecoveryV2Index):Promise<RecoveryV2Encoded<RecoveryV2Index>>;
 verifyRows(bytes:Uint8Array,identity:ArtifactIdentity):Promise<Readonly<RecoveryV2Rows>>;
 verifyIndex(bytes:Uint8Array,identity:ArtifactIdentity):Promise<Readonly<RecoveryV2Index>>;
 tableDescriptor(value:Omit<RecoveryV2Table,'tableDigest'>):Promise<Readonly<RecoveryV2Table>>;
 verifyTableDescriptor(value:RecoveryV2Table):Promise<Readonly<RecoveryV2Table>>;
 encodeRoot(value:RecoveryV2Root):Promise<RecoveryV2Pinned>;
 verifyRoot(bytes:Uint8Array,pinnedDigest:string):Promise<Readonly<RecoveryV2Root>>;
}
export function createRecoveryV2Codec(ports:{crypto:CanonicalCrypto}):RecoveryV2Codec;
/** Call only for a node whose exact bytes were verified. Structural summaries
 * alone never establish object existence, capture authority or graph closure. */
export function recoveryV2IndexSummary(node:RecoveryV2Index,identity:ArtifactIdentity):Readonly<RecoveryV2Branch>;
export function verifyRecoveryV2IndexChild(parent:RecoveryV2Index,entry:RecoveryV2Branch,child:RecoveryV2Index,identity:ArtifactIdentity):true;
