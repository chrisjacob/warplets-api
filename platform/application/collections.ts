import type {OperatorPrincipal,Principal,Revisions} from './ports';
export type CollectionOperationKind='collection.publish-stage.v1'|'collection.freeze-eligibility.v1'|'collection.reserve-operation.v1'|'collection.fulfill-operation.v1'|'collection.observe-asset.v1'|'governance.publish-ballot.v1'|'governance.cast-vote.v1'|'governance.record-decision.v1';
export type CollectionCommand<K extends CollectionOperationKind,I,P extends Principal|OperatorPrincipal=Principal|OperatorPrincipal>=Readonly<{
 principal:P;operationKind:K;businessIdentity:string;requestKey:string;requestDigest:string;expectedRevisions:Revisions;nowMs:number;input:Readonly<I>;
}>;
export type MintReservationInput=Readonly<{kind:'mint';inventoryId:string;stageId:string;expectedTermsDigest:string}>;
export type MintReservationCommand=CollectionCommand<'collection.reserve-operation.v1',MintReservationInput,Principal>;
export type ProgressionReservationInput=Readonly<{kind:'upgrade'|'visual';inventoryId:string;targetId:string;materialId:string|null;expectedTargetVersion:number;expectedMaterialVersion:number|null;quoteId:string;bindingDigest:string;policyVersion:string;reviewedFeeLamports:string;reviewedMaxTotalLamports:string;quoteExpiresMs:number}>;
export type ProgressionReservationCommand=CollectionCommand<'collection.reserve-operation.v1',ProgressionReservationInput,Principal>;
/** Operator DTOs name immutable staged evidence; a boolean cannot seal coverage. */
export interface StagePublicationInput {
 readonly inventoryId:string;readonly stageId:string;readonly type:'whitelist'|'public'|'free'|'founder';
 readonly publishedAt:number;readonly opensAt:number;readonly closesAt:number;
 readonly priceLamports:string;readonly costLamports:string;readonly allocation:number;readonly walletLimit:number|null;
 readonly founderApproved:boolean;readonly approvedSpendLamports:string|null;readonly ballotId:string|null;
 readonly inventoryOverrideReason:string|null;readonly eligibilityListId:string|null;readonly sourceKind:'synthetic-local-operator-fixture';
}
export type PublishCollectionStageCommand=CollectionCommand<'collection.publish-stage.v1',StagePublicationInput,OperatorPrincipal>;
export type FreezeCollectionEligibilityCommand=CollectionCommand<'collection.freeze-eligibility.v1',{inventoryId:string;stageId:string;publishedOpeningMs:number;sourceId:string;sourceDigest:string;expectedInventoryRevision:string},OperatorPrincipal>;
export type FulfillCollectionOperationCommand=CollectionCommand<'collection.fulfill-operation.v1',{operationId:string;evidenceReceiptId:string;evidenceDigest:string},OperatorPrincipal>;
export type ObserveCollectionAssetCommand=CollectionCommand<'collection.observe-asset.v1',{assetId:string;kind:'reveal'|'transfer';from:string|null;to:string|null;observedMs:number;evidenceReceiptId:string;evidenceDigest:string;expectedAssetVersion:number},OperatorPrincipal>;
export type PublishGenesisBallotCommand=CollectionCommand<'governance.publish-ballot.v1',{ballotId:string;opensMs:number;previousTrancheOpeningMs:number;electorateSourceId:string;electorateDigest:string},OperatorPrincipal>;
export type CastGenesisVoteCommand=CollectionCommand<'governance.cast-vote.v1',{ballotId:string;choice:'ASAP'|'7'|'14'|'30'},Principal>;
export type RecordGenesisDecisionCommand=CollectionCommand<'governance.record-decision.v1',{ballotId:string;choice:'ASAP'|'7'|'14'|'30';decidedMs:number;noticeMs:number;rationale:string},OperatorPrincipal>;
export type PublishedStageTerms=Readonly<{id:string;type:'whitelist'|'free'|'public'|'founder';opensAt:number;closesAt:number;allocation:number;walletLimit:number;priceLamports:string;costLamports:string;approvedSpendLamports:string|null;termsDigest:string}>;
export type MintAdmission=Readonly<{operationId:string;wallet:string;stageId:string;drawCommitment:string;admittedAt:number;costLamports:string;level:number|null;proofId:string|null;ticket:number|null}>;
/** All facts come from one repository revision. The eventual SQL claim must
 * assert them again; none are accepted from a member request. */
export type MintAdmissionFacts=Readonly<{
 inventoryId:string;inventoryRevision:string;stage:PublishedStageTerms;slots:number;admissionCount:number;stageAdmissionCount:number;walletAdmissionCount:number;founderSpentLamports:string;
 membership:Readonly<{wallet:string;stageId:string;eligible:boolean;sourceId:string|null}>;
 priorOperation:MintAdmission|null;commitmentUsed:boolean;
}>;
export type MintAdmissionPlan=Readonly<{status:'ready';replayed:boolean;inventoryId:string;inventoryRevision:string;stageId:string;termsDigest:string;membershipSourceId:string|null;admission:MintAdmission;
 effects:Readonly<{inventoryAdmissionDelta:0|1;stageAdmissionDelta:0|1;walletAdmissionDelta:0|1}>}>;
export type ProgressionQuoteOutcomes=Readonly<{targetAfter:Readonly<{level:number;expiresAtMs:number}>;historicalAllocationsChange:false}> & (
 Readonly<{materialOutcomes:readonly Readonly<{level:number;probabilityNumerator:number;probabilityDenominator:1000;expiresAtMs:number;remainingMs:number}>[];visualTraitsChange:false}> |
 Readonly<{fields:readonly ['Model','Backdrop','Symbol'];completedRerolls:number;cooldownMs:number;visualTraitsChange:true}>);
/** Immutable quote DTO shared by the stored issuer and atomic local reservation.
 * maxTotalLamports caps disclosed local components only; total network cost is unknown. */
export type ImmutableProgressionQuote=Readonly<{format:'collection-progression-quote-v1';id:string;bindingDigest:string;wallet:string;kind:'upgrade'|'visual';inventoryId:string;targetId:string;materialId:string|null;targetVersion:number;materialVersion:number|null;policyVersion:string;asOfMs:number;expiresMs:number;seasonStartMs:number;feeLamports:string;maxTotalLamports:string;costStatus:'local-preview-only';ceilingScope:'disclosed-local-components-only';networkCost:'unknown';totalCost:'unknown';costQuote:Readonly<{payer:'wallet';items:readonly Readonly<{kind:'protocol-fee';amountLamports:string}>[];network:Readonly<{status:'unknown';amountLamports:null}>}>;sourceDigest:string;outcomesDigest:string;outcomes:ProgressionQuoteOutcomes;historicalAllocationsChange:false;executable:false}>;
