import type {ArtifactIdentity,CanonicalCrypto,JsonValue} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {ManifestCodec} from '../artifacts/manifest-codec.mjs';
import type {AtomicDriver} from '../storage/atomic-earn.mjs';
export type RecoverySchema=Readonly<{fingerprint:string;migrations:readonly Readonly<{file:string;digest:string}>[]}>;
export type PublicRecoveryPin=Readonly<{identity:ArtifactIdentity;semanticDigest:string;boardId:string;epoch:number;
 allocations:readonly Readonly<{tokenId:string;day:number;allocationId:string;awardRoot:string}>[]}>;
export type RecoveryTable=Readonly<{name:string;columns:readonly string[];primaryKey:readonly string[];hasRowid:boolean;rowCount:number;rowsDigest:string;pages:readonly ArtifactIdentity[]}>;
export type RecoveryInventory=Readonly<{format:'10x.local.recovery.v1';mode:'public'|'private';createdMs:number;sourceCommit:string;schema:RecoverySchema|null;
 tables:readonly RecoveryTable[];objects:readonly ArtifactIdentity[];publications:readonly PublicRecoveryPin[];checkpoints:Readonly<Record<string,JsonValue>>;authPolicy:'no-private-state'|'revoke-sessions-and-fence-leases'}>;
export type RecoveryInput=Readonly<{inventory:RecoveryInventory;pinnedDigest:string}>;
export type RecoveryReport=Readonly<{kind:'verified';mode:'public'|'private';objects:number;publications:number;tables:number;sessionsRevoked:true;leasesFenced:boolean;financialExecution:false;chainStatus:'unproven'}>;
export type RecoveryOutcome=Readonly<{kind:'started';restoreId:string;units:number}>|Readonly<{kind:'progress';restoreId:string;cursor:number}>
 |Readonly<{kind:'replayed';restoreId:string;cursor?:number;report?:RecoveryReport}>|Readonly<{kind:'imported';restoreId:string}>
 |Readonly<{kind:'restored';restoreId:string;report:RecoveryReport}>|Readonly<{kind:'held';restoreId:string;reason:string}>
 |Readonly<{kind:'pending';reason:string}>|Readonly<{kind:'conflict';code:string}>;
export type CapturedRecovery=Readonly<{kind:'captured';inventory:RecoveryInventory;bytes:Uint8Array;digest:string}>;
export type ExportOutcome=CapturedRecovery|Readonly<{kind:'pending';reason:string;objectKey?:string}>;
export type RecoveryPorts=Readonly<{driver:AtomicDriver;artifacts:ArtifactStore;sourceArtifacts?:Pick<ArtifactStore,'getVerified'>;codec:ManifestCodec;
 crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string};schema?:RecoverySchema|null}>;
export interface RecoveryService {start(input:RecoveryInput):Promise<RecoveryOutcome>;step(input:RecoveryInput):Promise<RecoveryOutcome>;finish(input:RecoveryInput):Promise<RecoveryOutcome>;restore(input:RecoveryInput):Promise<RecoveryOutcome>}
