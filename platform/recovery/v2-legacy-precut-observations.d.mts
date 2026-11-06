import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {RetainedObservationInput} from './v2-legacy-current-observation.mjs';
export interface PrecutObservationMetrics {sql:number;objectReads:number;maxBatchBytes:number;maxReturnedBytes:number;workingBytes:number}
export interface PrecutObservationRequest {restoreId:string;adoptionId:string;ordinal:number;pin:{generation:string;watermark:number};retainedBytes:number}
export interface PrecutObservationContext {
 format:'legacy-precut-observations-v1';adoptionId:string;ordinal:number;certificateDigest:string;anchorDigest:string;assetId:string;
 cutRevision:string;cutMs:number;inventory:RetainedObservationInput['inventory'];baseline:RetainedObservationInput['baseline'];
 processed:number;preCount:number;postCount:number;transfers:number;afterSourceRevision:string|null;
 legacyCounts:{observations:number;vaultEvents:number;transfers:number;history:number};chain:string;
}
export interface PrecutCurrent {owner:string;level:number;version:number;rerolls:number;eligibleAt:number;expiresAt:number|null;revealMs:number|null;observedMs:number}
export interface PrecutCounts {vaultEvents:number;transfers:number;reveals:number;levelHistory:number;completedProgressions:0}
export type PrecutObservationOutcome={kind:'held';reason:string;metrics:PrecutObservationMetrics}|{kind:'progress';context:PrecutObservationContext;readiness:false;metrics:PrecutObservationMetrics}|{
 kind:'verified';adoptionId:string;ordinal:number;assetId:string;anchorDigest:string;currentAssetDigest:string;counts:PrecutCounts;current:PrecutCurrent;
 baseline:RetainedObservationInput['baseline'];inventory:RetainedObservationInput['inventory'];afterSourceRevision:string;preCount:number;postCount:number;chain:string;
 verification:'accepted-pre-adoption-observation-replay';originalIngestionAuthenticated:false;readiness:false;metrics:PrecutObservationMetrics;
};
/** Private contexts must be retained by the restore CAS; public requests are not
 * an authorized source of contexts or mapped baseline facts. */
export function createRecoveryLegacyPrecutObservations(ports:{driver:AtomicDriver;crypto:CanonicalCrypto;artifacts:ArtifactStore}):Readonly<{
 start(input:PrecutObservationRequest):Promise<PrecutObservationOutcome>;
 step(input:PrecutObservationRequest&{context:PrecutObservationContext}):Promise<PrecutObservationOutcome>;
}>;
