import type {CanonicalCrypto} from '../application/ports';
import type {LegacyAdmissionSourcePin} from './legacy-admission-source.mjs';
export type LegacyCurrentAssetMetrics=Readonly<{sql:number;maxBatchBytes:number;maxParameters:number;maxReturnedBytes:number;workingBytes:number}>;
export type LegacyCurrentAssetRequest=Readonly<{rootId:string;ordinal:number;pageIndex:number;entryIndex:number;source:LegacyAdmissionSourcePin;asOfMs:number}>;
export type LegacyCurrentAssetClosureRequest=Pick<LegacyCurrentAssetRequest,'rootId'|'source'|'asOfMs'>;
export type LegacyCurrentAssetCounts=Readonly<{vaultEvents:number;transfers:number;reveals:number;levelHistory:number;completedProgressions:0}>;
export type LegacyCurrentAssetClosureCounts=Readonly<{admissionCount:number;fulfilledCount:number;mintOperations:number;distinctMintAssets:number;collectAssets:number;vaultBindings:number;pendingOperations:number;lockedAssets:number;heldConflicts:number;malformedOperations:number;unboundAssets:number;missingVaultBindings:number;extraVaultBindings:number}>;
type Verified=Readonly<{kind:'verified';rootId:string;sourcePin:LegacyAdmissionSourcePin;sourceDigest:string;prefixAuthority:false;economics:false;adoption:false;metrics:LegacyCurrentAssetMetrics}>;
export type LegacyCurrentAssetHeld=Readonly<{kind:'held';reason:string;metrics:LegacyCurrentAssetMetrics}>;
export type LegacyCurrentAssetProof=Verified&Readonly<{operationId:string;assetId:string;ordinal:number;currentAssetDigest:string;current:Readonly<{owner:string;level:number;version:number;rerolls:number;eligibleAt:number;expiresAt:number|null;revealMs:number|null;observedMs:number}>;counts:LegacyCurrentAssetCounts;verification:'historical-current-asset-consistency'}>;
/** Count closure alone does not assert that every asset ordinal was audited. */
export type LegacyCurrentAssetClosureProof=Verified&Readonly<{counts:LegacyCurrentAssetClosureCounts;quiescent:true;verification:'inventory-quiescence-and-binding-closure'}>;
export function createLegacyCurrentAssetAudit(ports:{driver:{batch(statements:readonly {sql:string;values:readonly (string|number|null)[]}[]):Promise<{rows:Record<string,unknown>[];changes:number}[]>};crypto:CanonicalCrypto}):Readonly<{
 read(input:LegacyCurrentAssetRequest):Promise<LegacyCurrentAssetProof|LegacyCurrentAssetHeld>;
 closure(input:LegacyCurrentAssetClosureRequest):Promise<LegacyCurrentAssetClosureProof|LegacyCurrentAssetHeld>;
}>;
