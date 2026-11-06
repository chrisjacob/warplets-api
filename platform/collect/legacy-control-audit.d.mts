import type {CanonicalCrypto} from '../application/ports';
import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CostPressure} from '../storage/atomic-operations.mjs';
import type {LegacyAdmissionControlFact} from './legacy-admission-audit.mjs';
export const LEGACY_CONTROL_AUDIT_LIMITS:Readonly<{usageRows:100;spendRows:100;selectionRows:101;selectedRowBytes:65536;sqlBytes:262144;workingBytes:1048576}>;
export interface LegacyControlSourcePin {readonly inventoryId:string;readonly sourceRevision:string;readonly generation:string;readonly watermark:number}
export interface LegacyControlAuditRequest {readonly rootId:string;readonly operationId:string;readonly atMs:number;readonly source:LegacyControlSourcePin}
export interface LegacyControlAuditMetrics {readonly sqlStatements:number;readonly batches:number;readonly maxBatchBytes:number;readonly readBytes:number;readonly workingBytes:number;readonly usageRows:number;readonly spendRows:number}
export type LegacyControlAuditResult=Readonly<{kind:'held';reason:string;metrics:LegacyControlAuditMetrics}>|Readonly<{kind:'verified';controlFact:LegacyAdmissionControlFact;provenance:'retained-history-as-of';sourcePin:LegacyControlSourcePin;pressure:Extract<CostPressure,{status:'ready'}>;metrics:LegacyControlAuditMetrics}>;
export function createLegacyControlAudit(ports:{driver:AtomicDriver;crypto:CanonicalCrypto;onMeasure?:(metrics:LegacyControlAuditMetrics)=>void}):Readonly<{read(input:LegacyControlAuditRequest):Promise<LegacyControlAuditResult>}>;
