import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
export interface RetainedObservationAsset {id:string;inventory_id:string;owner:string;bind_ms:number;observed_ms:number;reveal_ms:number|null;slot:string;asset:string}
export interface RetainedObservationVault {id:string;slot_key:string;coords:string;owner:string;latest_ms:number}
export interface RetainedOwnerEvidence {event_id:string;asset_id:string;kind:'bind'|'transfer';observed_ms:number;body:string}
export interface RetainedPendingOperation {id:string;kind:'upgrade'|'visual';inventory_id:string;owner:string;commitment:string;settled_ms:null;operation:string}
export interface RetainedObservationInput {
 sourceId:string;assetId:string;afterSourceRevision:string|null;
 inventory:{id:string;kind:'season'|'genesis';tranche:number|null;season_start:number|null};
 baseline:{asset:RetainedObservationAsset;vault:RetainedObservationVault;ownerEvidence:RetainedOwnerEvidence;operation:RetainedPendingOperation|null};
 asOfMs:number;pin:{generation:string;watermark:number};
 /** Bytes retained by the outer restore checkpoint/wrapper, already multiplied
  * for its actual live copies. Included in the one-MiB combined working bound. */
 retainedBytes?:number;
}
export interface RetainedObservationMetrics {sql:number;objectReads:number;maxBatchBytes:number;maxParameters:number;maxReturnedBytes:number;workingBytes:number}
export interface RetainedObservationConflict {id:string;operation_id:string;asset_id:string;evidence_receipt_digest:string;from_wallet:string;to_wallet:string;observed_ms:number;recorded_ms:number;status:'held'}
export type RetainedObservationOutcome={kind:'held';reason:string;metrics:RetainedObservationMetrics}|{kind:'verified';sourceId:string;sourceRevision:string;commandOperationId:string;asset:RetainedObservationAsset;vault:RetainedObservationVault;ownerEvidence:RetainedOwnerEvidence;conflict:RetainedObservationConflict|null;observationDigest:string;verification:'accepted-observation-replay';source:'synthetic-local-fixture';readiness:false;metrics:RetainedObservationMetrics};
export function createRetainedCollectionObservationVerifier(ports:{driver:AtomicDriver;crypto:CanonicalCrypto;artifacts:ArtifactStore}):Readonly<{replay(input:RetainedObservationInput):Promise<RetainedObservationOutcome>}>;
