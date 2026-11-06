import type {CanonicalCrypto} from '../application/ports';
/** Exact historical+modern lineage aggregation shared with private recovery. */
export function legacyImportedAdmissionTotalsSql(input:Readonly<{inventoryId:string;historicalAdmissions:number;fulfilled:number}>):Readonly<{sql:string;values:readonly (string|number|null)[]}>;
export type LegacyAdoptionCertificateRow=Readonly<{
 id:string;inventory_id:string;activation_command_id?:string;root_id:string;origin_digest:string;source_revision:number;
 raw_digest:string;canonical_digest:string;source_generation:string;source_watermark:number;schema_fingerprint:string;
 economic_audit_id:string;economic_selection_digest:string;economic_chain_digest:string;economic_result_json:string;economic_result_digest:string;
 parent_preimage_json:string;quiescence_json:string;parent_digest:string;preparation_digest:string;preparation_result_json:string;preparation_result_digest:string;
 stage_count:number;admitted:number;fulfilled:number;remaining_json:string;operator:string;created_ms:number;
}>;
export type LegacyAdoptionCertificateBody=Readonly<{
 format:'legacy-adoption-certificate-v1';adoptionId:string;inventoryId:string;rootId:string;originDigest:string;sourceRevision:number;
 rawDigest:string;canonicalDigest:string;sourceGeneration:string;sourceWatermark:number;schemaFingerprint:string;
 economicAuditId:string;economicSelectionDigest:string;economicChainDigest:string;economicResultDigest:string;
 parentDigest:string;preparationDigest:string;preparationResultDigest:string;stageCount:number;admitted:number;fulfilled:number;
 remaining:readonly number[];operator:string;createdMs:number;
}>;
export function legacyAdoptionCertificateBody(row:LegacyAdoptionCertificateRow):LegacyAdoptionCertificateBody;
export function hashLegacyAdoptionCertificate(row:LegacyAdoptionCertificateRow,crypto:CanonicalCrypto):Promise<Readonly<{body:LegacyAdoptionCertificateBody;certificateDigest:string}>>;
export type LegacyAdoptionAuthorityMetrics=Readonly<{sql:number;maxBatchBytes:number;maxParameters:number;maxReturnedBytes:number;workingBytes:number}>;
export type LegacyAdoptionAuthorityResult=
 |Readonly<{kind:'absent';metrics:LegacyAdoptionAuthorityMetrics}>
 |Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[];metrics:LegacyAdoptionAuthorityMetrics}>
 |Readonly<{kind:'ready';
 certificate:LegacyAdoptionCertificateBody&Readonly<{activationCommandId:string;certificateDigest:string}>;
 authority:Readonly<{revision:number;admitted:number;fulfilled:number;remaining:readonly number[]}>;
 counts:Readonly<{historicalAdmissions:number;newAdmissions:number;newFulfillments:number;totalStages:number;importedStages:number;newStages:number}>;
 stage:null|Readonly<{id:string;type:'whitelist'|'public'|'free'|'founder';termsDigest:string;admitted:number;walletAdmitted:number|null;founderSpentLamports:string|null}>;
 fence:Readonly<{sourceRevision:string;watermark:number;generation:string;authorityRevision:number;adoptionId:string;activationCommandId:string;preparationDigest:string}>;
 metrics:LegacyAdoptionAuthorityMetrics}>;
/** Internal read facts only. Mutation callers retain current scope and replay
 * handling, and recheck this fence in their actual receipt claim. */
export function createLegacyAdoptionAuthorityReader(ports:{driver:{batch(statements:readonly {sql:string;values:readonly (string|number|null)[]}[]):Promise<{rows:Record<string,unknown>[];changes:number}[]>};crypto:CanonicalCrypto}):Readonly<{read(input:Readonly<{inventoryId:string;stageId:string|null;wallet:string|null}>):Promise<LegacyAdoptionAuthorityResult>}>;

/** Internal pure receipt checks; actual restored row linkage is required separately. */
export interface LegacyAdoptionReceiptFields {
 readonly operation_id:string;readonly state:string;readonly operation_kind:string;readonly principal_key:string;readonly business_key:string;readonly result_ref:string;readonly request_key:string;readonly created_ms:number;readonly input_json:string;readonly result_json:string;readonly request_digest:string;readonly output_digest:string;
}
export interface LegacyImportedStageReceiptFields extends LegacyAdoptionReceiptFields {
 /** Computed by private SQL joining actual prepared/imported/current rows. Never caller authority. */
 readonly binding_valid:number;readonly ordinal:number;readonly stage_id:string;readonly terms_digest:string;readonly source_proof_digest:string;readonly terms_json:string;readonly stage_type:string;readonly eligibility_kind:string;readonly list_id:string|null;readonly eligible_count:number|null;
}
export function verifyLegacyAdoptionActivationReceipt(input:Readonly<{receipt:LegacyAdoptionReceiptFields;certificate:LegacyAdoptionCertificateBody;certificateDigest:string}>,crypto:CanonicalCrypto):Promise<string>;
export function verifyLegacyImportedStageReceipt(input:Readonly<{receiptAndStage:LegacyImportedStageReceiptFields;certificate:LegacyAdoptionCertificateBody;sourceStage:Readonly<{id:string;ordinal:number;termsByteDigest:string;eligibility:Readonly<{kind:string;manifestId:string|null}>}>}>,crypto:CanonicalCrypto):Promise<void>;
