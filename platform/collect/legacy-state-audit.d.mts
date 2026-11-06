import type {CanonicalCrypto,JsonValue} from '../application/ports';
import type {CollectionSourceRecord} from './state-codec.mjs';
/** Trusted runtime injects the pinned resumable adapter. This generic boundary
 * also permits a labeled native-cache test adapter; it is not application auth. */
export interface ProjectionHashState {readonly bytes:number;readonly [key:string]:JsonValue}
export interface ProjectionHashAdapter {initial():ProjectionHashState;advance(state:ProjectionHashState,bytes:Uint8Array):ProjectionHashState;finish(state:ProjectionHashState):string}
export interface LegacyStateAuditCheckpoint {
 readonly format:'legacy-canonical-state-audit-v1';readonly rootId:string;readonly phase:'admissions'|'stages'|'wallets'|'finish';readonly admissionIndex:number;readonly admissionCount:number;readonly stageIndex:number;
 readonly listPageIndex:number;readonly listCount:number;readonly listLastWallet:string|null;readonly listsVerified:number;readonly walletsVerified:number;readonly prefixBytes:number;readonly mainHash:ProjectionHashState;readonly listHash:ProjectionHashState|null;readonly checkpointDigest:string;
}
export interface LegacyStateAuditMetrics {readonly records:number;readonly readBytes:number;readonly emittedBytes:number;readonly maxWorkingBytes:number}
export type LegacyStateAuditResult=Readonly<{kind:'held';reason:string;metrics:LegacyStateAuditMetrics}>|Readonly<{kind:'continue';checkpoint:LegacyStateAuditCheckpoint;metrics:LegacyStateAuditMetrics}>|Readonly<{kind:'verified';rootId:string;inventoryId:string;sourceRevision:string;stateDigest:string;transcriptBytes:number;admissionCount:number;stageCount:number;listOccurrences:number;walletOccurrences:number;verification:'projection-digest-only';rawSourceRelationVerified:false;economicsVerified:false;adoptionAuthorized:false;executable:false;metrics:LegacyStateAuditMetrics}>;
export const LEGACY_STATE_AUDIT_LIMITS:Readonly<{transcriptBytes:33554432;fragmentBytes:65536;checkpointBytes:4096;workingBytes:1048576;recordsPerStep:3}>;
export function createLegacyStateAudit(ports:{crypto:CanonicalCrypto;hash:ProjectionHashAdapter;readRecord(id:string):Promise<CollectionSourceRecord|null>}):Readonly<{step(input:Readonly<{rootId:string;checkpoint:LegacyStateAuditCheckpoint|null}>):Promise<LegacyStateAuditResult>}>;
