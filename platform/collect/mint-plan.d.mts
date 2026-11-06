import type {CanonicalCrypto} from '../application/ports';
import type {PublishedStageTerms} from '../application/collections';
import type {PinnedBeaconProof,PinnedBeaconVerifier} from '../beacon/portable.mjs';

/** Repository-owned private facts. No field asserts payment or chain finality. */
export interface NormalizedMintAuthority {
 readonly inventoryId:string;readonly kind:'genesis'|'season';readonly tranche:number|null;
 readonly seasonStart:number|null;readonly revision:number;readonly admitted:number;
 readonly fulfilled:number;readonly remaining:readonly number[];
}
export interface MintFairPolicy {readonly policy_hash:string;readonly registered_ms:number}
export interface NormalizedMintAdmission {
 readonly operationId:string;readonly ordinal:number;readonly wallet:string;readonly stageId:string;
 readonly drawCommitment:string;readonly admittedAt:number;readonly costLamports:string;readonly priceLamports:string;
 readonly termsDigest:string;readonly membershipSourceId:string|null;readonly fairPolicyHash:string|null;
 readonly fairRegisteredMs:number|null;readonly targetRound:number|null;readonly contextDigest:string|null;
}
export interface NormalizedMintOpening {
 readonly firstStage:{readonly ballotId:string;readonly inventoryOverrideReason:string|null};
 readonly decision:{readonly ballotId:string;readonly earliestMs:number};
 readonly previous:{readonly tranche:number;readonly admitted:number};
}
export interface NormalizedMintAdmissionFacts {
 readonly authority:NormalizedMintAuthority;readonly stage:PublishedStageTerms;
 readonly sourceKind:'synthetic-local-operator-fixture';readonly stageAdmissionCount:number;
 readonly walletAdmissionCount:number;readonly founderSpentLamports:string;readonly commitmentUsed:boolean;
 readonly membership:{readonly wallet:string;readonly stageId:string;readonly eligible:boolean;readonly sourceId:string|null};
 readonly opening:NormalizedMintOpening|null;readonly fairPolicy:MintFairPolicy|null;
}
type MemberMintCommand={readonly operationKind:'collection.reserve-operation.v1';readonly principal:{readonly kind:'wallet';readonly wallet:string};readonly nowMs:number;readonly input:{readonly kind:'mint';readonly inventoryId:string;readonly stageId:string;readonly expectedTermsDigest:string}};
type FounderMintCommand={readonly operationKind:'collection.reserve-operation.v1';readonly principal:{readonly kind:'operator';readonly id:string};readonly nowMs:number;readonly input:{readonly kind:'mint';readonly inventoryId:string;readonly stageId:string;readonly expectedTermsDigest:string;readonly wallet:string}};
export interface NormalizedMintAdmissionPlan {
 readonly inventoryId:string;readonly expectedAuthorityRevision:number;readonly admission:NormalizedMintAdmission;
 readonly operationJson:string;readonly effects:{readonly admitted:number;readonly revision:number};
 readonly source:'local-fixture';readonly executable:false;
}
export function prepareNormalizedMintAdmission(value:{readonly command:MemberMintCommand|FounderMintCommand;readonly facts:NormalizedMintAdmissionFacts;readonly operationId:string;readonly commitment:string},crypto:CanonicalCrypto):Promise<NormalizedMintAdmissionPlan>;

export interface MintTraits {readonly model:string;readonly backdrop:string;readonly symbol:string}
type MintEventBinding={readonly inventoryId:string;readonly operationId:string;readonly commitment:string;readonly atMs:number};
export type NormalizedMintEvent=MintEventBinding&(
 {readonly provenance:'manual-fixture';readonly proof:{readonly proofId:string;readonly assetId:string;readonly ticket:number;readonly traits:MintTraits}}|
 {readonly provenance:'configured-offline-beacon';readonly proof:PinnedBeaconProof});
export interface NormalizedMintDrawInput {
 readonly authority:NormalizedMintAuthority;readonly admission:NormalizedMintAdmission;
 readonly event:NormalizedMintEvent;readonly nowMs:number;
 readonly fairness:{readonly policy:MintFairPolicy&{readonly traits:string};readonly request:{readonly target_round:number;readonly context_digest:string}}|null;
}
export interface NormalizedMintDraw {
 readonly inventoryId:string;readonly operationId:string;readonly commitment:string;readonly expectedAuthorityRevision:number;
 readonly proofId:string;readonly provenance:'manual-fixture'|'configured-offline-beacon';readonly atMs:number;
 readonly ticket:number;readonly traits:MintTraits;readonly level:number;readonly ordinal:number;readonly slotIndex:number;
 readonly assetId:string|null;readonly fairResult:{readonly proofId:string;readonly signedRoundJson:string;readonly settledMs:number}|null;
}
export function prepareNormalizedMintDraw(value:NormalizedMintDrawInput,crypto:CanonicalCrypto,beaconVerifier:PinnedBeaconVerifier|null):Promise<NormalizedMintDraw>;
export interface NormalizedMintFulfillmentInput extends NormalizedMintDrawInput {
 readonly reservedAsset:{readonly inventoryId:string;readonly slotIndex:number;readonly assetId:string}|null;
 readonly conflicts:{readonly assetCount:number;readonly slotCount:number;readonly proofCount:number;readonly snapshotCount:number};
}
export interface NormalizedMintFulfillmentPlan {
 readonly result:{readonly operationId:string;readonly inventoryId:string;readonly kind:'mint';readonly assetId:string;readonly at:number;readonly status:'fulfilled';readonly provenance:'manual-fixture'|'configured-offline-beacon';readonly source:'local-fixture';readonly executable:false};
 readonly effect:{readonly expectedAuthorityRevision:number;readonly admitted:number;readonly fulfilled:number;readonly remaining:readonly number[];readonly authorityRevision:number;readonly admissionOrdinal:number;
  readonly asset:{readonly id:string;readonly inventoryId:string;readonly owner:string;readonly bindMs:number;readonly observedMs:number;readonly revealMs:null;readonly slotJson:string;readonly assetJson:string};
  readonly vaultEventJson:string;readonly operationReceiptJson:string;readonly legacyEvidenceDigest:string;
  readonly fairResult:{readonly proofId:string;readonly signedRoundJson:string;readonly settledMs:number;readonly fixtureJson:string}|null;
  readonly history:readonly {readonly assetId:string;readonly effectiveMs:number;readonly level:number;readonly sourceRef:string}[]};
 readonly fixture:{readonly operationId:string;readonly commitment:string;readonly proofId:string;readonly at:number;readonly finalized:true;readonly traits:MintTraits;readonly ticket:number;readonly assetId:string};
}
export function prepareNormalizedMintFulfillment(value:NormalizedMintFulfillmentInput,crypto:CanonicalCrypto,beaconVerifier:PinnedBeaconVerifier|null):Promise<NormalizedMintFulfillmentPlan>;
