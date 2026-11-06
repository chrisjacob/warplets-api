import { z } from 'zod';

const count=z.number().int().nonnegative();
const units=z.string().regex(/^\d+$/);
const text=z.string();
const date=text.datetime();
const nullableDate=date.nullable();
const cursor=z.union([text,count]).nullable();
export const policyModel=z.object({
  mode:text,version:text,
  launch:z.object({allocationBps:z.object({liquidity:count,earn:count,stake:count,genesisVault:count,seasonVault:count}),
    campaignDays:count,clock:text,feeStartBps:count,feeFloorBps:count}),
  vault:z.object({cliffHours:count,vestHours:count}),
  earn:z.object({maxWinners:count,maxMultiplierTenths:count,minimumCorrespondingStakeUsd:text}),
  genesis:z.object({cap:count,trancheSize:count,firstWhitelistPriceSol:text,choices:z.array(text),
    ballotHours:count,noticeHours:count,votesPerWallet:count,mintsPerEligibleWalletPerStage:count}),
  season:z.object({monthlyCap:count,freeStageRequires:text,freeMintsPerEligibleWallet:count}),
});
export type Policy=z.infer<typeof policyModel>;
export const ballotModel=z.object({
  id:text,status:z.enum(['scheduled','open','closed']),opensAt:date,closesAt:date,choices:z.array(text),
  eligibleWallets:count,votesCast:count,counts:z.record(text,count).nullable(),
  decision:z.object({choice:text,rationale:text,earliestOpening:date}).nullable(),
});
export const stageModel=z.object({
  id:text,type:text,status:text,opensAt:date,closesAt:date,priceLamports:units,costLamports:units,
  allocation:count,available:count,walletLimit:count,eligible:z.boolean().nullable(),
  walletReservations:count.nullable(),openingHold:text.nullable(),publishedAt:date.optional(),termsDigest:text.optional(),
  eligibility:z.object({status:z.enum(['eligible','ineligible','unknown']),reason:text,cutoffAt:nullableDate}).optional(),
  reservationStatus:z.object({status:z.enum(['available','unavailable','unknown']),reason:z.enum(['eligible','not-signed-in','opening-hold','stage-scheduled','stage-closed','sold-out','snapshot-pending','not-on-list','wallet-limit','operator-only']),
    snapshotId:text.nullable(),used:count.nullable(),remaining:count.nullable(),stageStatus:text,asOf:date,source:z.literal('local-fixture'),executable:z.literal(false)}).optional(),
});
export const inventoryModel=z.object({
  id:text,kind:z.enum(['genesis','season']),stages:z.array(stageModel),
  capacity:count,seasonStart:nullableDate,tranche:count.nullable(),source:text.optional(),asOf:date.optional(),
  initialLevelQuotas:z.array(count).optional(),revealedLevelCounts:z.array(count).optional(),concealedCount:count.optional(),
  seasonExpiries:z.array(z.object({level:count,expiresAt:date,remainingMs:count})).nullable().optional(),
  counts:z.object({paid:count,free:count,founder:count,pending:count,unsold:count,unmintedReserve:count}),
});
export const assetModel=z.object({
  revealedAt:nullableDate.optional(),ownerObservedAt:nullableDate.optional(),evidenceStatus:text.optional(),
  id:text,inventoryId:text,owner:text,revealStatus:z.enum(['revealed','unrevealed']),
  level:count.optional(),traits:z.object({model:text,backdrop:text,symbol:text}).optional(),
  version:count.optional(),rerolls:count.optional(),nextRerollAt:nullableDate.optional(),
  expiresAt:nullableDate.optional(),operationPending:z.boolean().optional(),
});
export const receiptModel=z.object({
  id:text,kind:text,inventoryId:text,owner:text,status:text,createdAt:date,stageId:text.nullable(),
  targetId:text.nullable(),materialId:text.nullable(),assetId:text.nullable(),
  priceLamports:units.nullable(),feeLamports:units.nullable(),costLamports:units.nullable(),
  quoteId:text.optional(),bindingDigest:text.regex(/^[a-f0-9]{64}$/).optional(),
  reconciliation:z.object({status:z.literal('held'),reason:z.literal('external-transfer'),observedAt:date}).optional(),
});
export const quoteModel=z.object({
  asOf:date,source:z.literal('local-fixture'),inventoryId:text,
  quoteId:text,bindingDigest:text.regex(/^[a-f0-9]{64}$/),policyVersion:text,
  targetVersion:count,materialVersion:count.nullable(),maxTotalLamports:units,quoteExpiresMs:count,expiresAt:date,
  costStatus:z.literal('local-preview-only'),ceilingScope:z.literal('disclosed-local-components-only'),
  networkCost:z.literal('unknown'),totalCost:z.literal('unknown'),executable:z.literal(false),
  kind:z.enum(['visual','upgrade']),feeLamports:units,materialId:text.nullable(),targetId:text,
  nextTargetLevel:count.optional(),nextTargetExpiry:date.optional(),cooldownMs:count.optional(),
  materialProbabilities:z.array(z.object({level:count,count,total:count,expiresAt:date.optional(),remainingMs:count.optional()})).optional(),
  fields:z.array(text).optional(),
});
export const boardModel=z.object({
  status:z.enum(['pending','final']),date:text,
  items:z.array(z.object({rank:count,wallet:text,contentScore:count,multiplierTenths:count,pointsTenths:count})),
});
export const submissionModel=z.object({id:text,url:text,tokenId:text,status:text,score:count.nullable(),reason:text.nullable(),
  eligible:z.boolean().nullable().optional(),entryStakeMicroUsd:units.optional(),closingStakeMicroUsd:units.nullable().optional(),
  components:z.object({actionTenths:count,streakDays:count,highestEligibleLevel:count,purchaseTokenDays:count,sourceRef:text}).nullable().optional(),
});
export const awardModel=z.object({tokenId:text,day:count,awardUnits:units,vestedUnits:units});
export const positionModel=z.object({marketId:text,principalUnits:units,earnedGrossUnits:units,claimableGrossUnits:units,harvestedGrossUnits:units});
export const farmModel=z.object({marketId:text,status:text,fundedUnits:units,totalStakedUnits:units.optional(),treasuryFeeBps:count,emissionEnd:date});

export const pageOf=<T extends z.ZodType>(item:T)=>z.object({items:z.array(item),nextCursor:cursor});
export const dataOf=<T extends z.ZodType>(item:T)=>z.object({data:item});
export type Asset=z.infer<typeof assetModel>;
export type Ballot=z.infer<typeof ballotModel>;
export type Stage=z.infer<typeof stageModel>;
export type Inventory=z.infer<typeof inventoryModel>;
export type Receipt=z.infer<typeof receiptModel>;
export type ProgressQuote=z.infer<typeof quoteModel>;

export const vaultAllocationModel=z.object({marketId:text,allocated:units,vested:units,claimed:units,claimable:units,manifestDigest:text,
  activatedAt:date.optional(),cliffEndsAt:date.optional(),fullyVestedAt:date.optional()});
export const vaultHoldingsModel=z.object({items:z.array(z.object({id:text,detail:text,ownerObservedAt:nullableDate.optional()})),nextCursor:cursor,asOf:date,
  summary:z.object({source:text,asOf:date,status:z.enum(['complete','unavailable']),reason:text.nullable(),assetCount:count.nullable(),items:z.array(vaultAllocationModel)}).optional()});
export const nftVaultModel=z.object({items:z.array(vaultAllocationModel),nextCursor:cursor,asOf:date,ownerObservedAt:nullableDate.optional()});

export const earnMemberStatusModel=z.object({mode:text,asOf:date,epoch:count,
  admission:z.object({status:text,reason:text.nullable(),items:z.array(z.object({tokenId:text,status:text,reason:text.nullable(),stakeMicroUsd:units.nullable(),stakeObservedAt:nullableDate,sourceRef:text.nullable()}))}),
  actions:z.object({status:text,reason:text.nullable(),items:z.array(z.object({actionId:text,label:text,verifier:text,startEpoch:count,status:text,verifiedAt:nullableDate,sourceRef:text.nullable()}))}),
  currentCutoff:z.object({status:text,reason:text,cutoffAt:date}),
  latestFinalComponents:z.object({epoch:count,cutoffAt:date,actionTenths:count,streakDays:count,highestEligibleLevel:count,purchaseTokenDays:count,multiplierTenths:count,sourceRef:text,snapshotDigest:text}).nullable(),
  multiplierBounds:z.object({minimumTenths:count,maximumTenths:count}),
});
export const submissionsPageModel=pageOf(submissionModel).extend({memberStatus:earnMemberStatusModel.optional()});
export type EarnMemberStatus=z.infer<typeof earnMemberStatusModel>;
