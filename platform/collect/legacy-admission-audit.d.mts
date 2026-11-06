import type {CanonicalCrypto} from '../application/ports';
import type {LegacySourceRecord,LegacyMintAuditResult} from './legacy-mint-audit.mjs';
import type {CollectionListSeal} from './source-intake.mjs';
import type {LegacyStageAuditResult,LegacyStageType} from './legacy-stage-audit.mjs';
export const LEGACY_ADMISSION_AUDIT_LIMITS:Readonly<{rootBytes:131072;pageBytes:65536;membershipPageBytes:8192;contextBytes:32768;workingBytes:1048576;stages:32;admissions:1000}>;
export interface LegacyAdmissionPrefix {readonly rootId:string;readonly ordinal:number;readonly pageIndex:number;readonly entryIndex:number;readonly fulfilled:number;readonly pending:number;readonly paid:number;readonly free:number;readonly founder:number;readonly remaining:readonly number[];readonly stages:readonly Readonly<{id:string;type:LegacyStageType;admitted:number;spentLamports:string}>[]}
export interface LegacyAdmissionOperation {readonly id:string;readonly kind:'mint';readonly inventory_id:string;readonly owner:string;readonly request_key:string;readonly request_digest:string;readonly commitment:string;readonly created_ms:number;readonly settled_ms:number|null;readonly proof_id:string|null;readonly evidence_digest:string|null;readonly operation:string;readonly receipt:string|null}
/** Selected by a future private source audit. sourceDigest is a historical
 * binding, never proof that an arbitrary caller-supplied decision is authorized. */
export interface LegacyAdmissionControlFact {readonly rootId:string;readonly operationId:string;readonly atMs:number;readonly scope:'collection-mint';readonly sourceDigest:string;readonly scopeRevision:string|null;readonly paused:boolean;readonly pressure:'normal'|'warning'|'limit';readonly decision:Readonly<{scope:'collection-mint';allowed:boolean;reason:string;revision?:string|null}>}
export interface LegacyAdmissionPriorFacts {readonly rootId:string;readonly ordinal:number;readonly operationId:string;readonly commitment:string;readonly wallet:string;readonly requestKey:string;readonly stageId:string;readonly proofId:string|null;readonly walletStageCount:number;readonly operationCount:number;readonly commitmentCount:number;readonly ownerRequestCount:number;readonly proofCount:number}
export interface LegacyAdmissionAuditInput {
 readonly sourceRoot:LegacySourceRecord;readonly admissionPage:LegacySourceRecord;readonly asOfMs:number;readonly prefix:LegacyAdmissionPrefix;readonly operation:LegacyAdmissionOperation;
 readonly stageAudit:Extract<LegacyStageAuditResult,{kind:'verified'}>|null;
 readonly membership:Readonly<{seal:CollectionListSeal;page:LegacySourceRecord}>|null;
 readonly freeCutAudit:Readonly<{rootId:string;inventoryId:string;stageId:string;opensAt:number;listId:string;walletsDigest:string;originalCutDigest:string;sourceDigest:string}>|null;
 readonly controlFact:LegacyAdmissionControlFact|null;
 readonly openingDecision:Readonly<{rootId:string;inventoryId:string;tranche:number;atMs:number;ballotId:string;earliestMs:number;previousTranche:number;previousUnsold:number;sourceDigest:string}>|null;
 readonly priorFacts:LegacyAdmissionPriorFacts|null;readonly mintAudit:Extract<LegacyMintAuditResult,{kind:'audited'}>|null;
}
export type LegacyAdmissionAuditResult=Readonly<{kind:'held';reason:string}>|Readonly<{kind:'audited';summary:Readonly<{rootId:string;ordinal:number;inventoryId:string;operationId:string;wallet:string;stageId:string;termsDigest:string;priceLamports:string;costLamports:string;status:'pending'|'fulfilled';verification:'historical-admission-economics';source:'local-reference-fixture';executable:false}>;nextPrefix:LegacyAdmissionPrefix}>;
export interface LegacyAdmissionAuditMetrics {readonly sourceBytes:number;readonly membershipBytes:number;readonly contextBytes:number;readonly workingBytes:number}
export function startLegacyAdmissions(record:LegacySourceRecord,ports:{crypto:CanonicalCrypto}):Promise<LegacyAdmissionPrefix>;
export function auditLegacyAdmission(input:LegacyAdmissionAuditInput,ports:{crypto:CanonicalCrypto;onMeasure?:(metrics:LegacyAdmissionAuditMetrics)=>void}):Promise<LegacyAdmissionAuditResult>;
export function finishLegacyAdmissions(record:LegacySourceRecord,prefix:LegacyAdmissionPrefix,ports:{crypto:CanonicalCrypto}):Promise<Readonly<{kind:'verified';rootId:string;inventoryId:string;admitted:number;fulfilled:number;remaining:readonly number[];counts:Readonly<{paid:number;free:number;founder:number;pending:number;unsold:number;unmintedReserve:number}>;stages:LegacyAdmissionPrefix['stages'];verification:'historical-admission-economics';source:'local-reference-fixture';executable:false}>>;
