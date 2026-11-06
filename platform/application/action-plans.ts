import type {Principal} from './ports';
/** Local preparation vocabulary; no action authorizes signing or execution. */
export type ActionKind='launch'|'fund'|'claim'|'stake'|'unstake'|'harvest'|'swap'|'collection';
export type ActionRequestV1=Readonly<{format:'10x.action-request.v1';maximumFeeUnits:string}>&(
 Readonly<{action:'launch';parameters:Readonly<{launchId:string}>}>|
 Readonly<{action:'fund';parameters:Readonly<{campaignId:string;amountUnits:string}>}>|
 Readonly<{action:'claim';parameters:Readonly<{kind:'earn';tokenId:string;day:number}>|Readonly<{kind:'vault';assetId:string;tokenId:string}>}>|
 Readonly<{action:'stake'|'unstake';parameters:Readonly<{marketId:string;amountUnits:string}>}>|
 Readonly<{action:'harvest';parameters:Readonly<{marketId:string}>}>|
 Readonly<{action:'swap';parameters:Readonly<{marketId:string;direction:'buy-att'|'sell-att';inputUnits:string;slippageBps:number}>}>|
 Readonly<{action:'collection';parameters:Readonly<{kind:'mint';inventoryId:string;stageId:string;expectedTermsDigest:string}>|Readonly<{kind:'progression';operationId:string}>}>
);
export type BoundActionRequestV1=Readonly<{format:'10x.bound-action-request.v1';principal:Principal;request:ActionRequestV1;economicIntentDigest:string;requestDigest:string;financialExecution:false}>;
export type ActionEvidenceRequirement='registered-program-identity'|'typed-program-codec'|'recorded-unsigned-message'|'recorded-simulation'|'recorded-blockhash-lifetime'|'verified-funding-and-fees'|'registered-launch-source'|'original-supply-and-activation'|'complete-genesis-backing'|'activation-season-snapshot'|'launch-pool-and-fee-policy'|'reward-custody'|'registered-campaign'|'campaign-funding-plan'|'funding-destination-and-custody'|'original-earn-allocation'|'original-vesting-and-cumulative-claims'|'claim-custody'|'original-vault-manifest'|'original-slot-and-current-owner'|'registered-farm-policy'|'farm-deposit-permission'|'owner-stake-position'|'principal-withdrawal-permission'|'farm-harvest-permission'|'cumulative-harvest-state'|'verified-quote-source'|'current-quote-and-account-state'|'swap-account-derivation'|'captured-program-parity'|'published-stage-terms'|'current-stage-eligibility'|'collection-reservation-evidence'|'collection-program-policy'|'stored-progression-operation'|'current-participant-ownership-and-versions'|'retained-progression-outcome';
export type UnsupportedActionPlan=Readonly<{kind:'unsupported';reason:'unsupported-factory';action:ActionKind;requiredEvidence:readonly ActionEvidenceRequirement[];evidenceStatus:'not-evaluated';wire:null;executable:false;financialExecution:false;serverSigning:false;broadcast:false}>;
