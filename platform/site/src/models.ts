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
    ballotHours:count,votesPerWallet:count,mintsPerEligibleWalletPerStage:count}),
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
  walletReservations:count.nullable(),openingHold:text.nullable(),
});
export const inventoryModel=z.object({
  id:text,kind:z.enum(['genesis','season']),stages:z.array(stageModel),
  counts:z.object({paid:count,free:count,founder:count,pending:count,unsold:count,unmintedReserve:count}),
});
export const assetModel=z.object({
  id:text,inventoryId:text,owner:text,revealStatus:z.enum(['revealed','unrevealed']),
  level:count.optional(),traits:z.object({model:text,backdrop:text,symbol:text}).optional(),
  version:count.optional(),rerolls:count.optional(),nextRerollAt:nullableDate.optional(),
  expiresAt:nullableDate.optional(),operationPending:z.boolean().optional(),
});
export const receiptModel=z.object({
  id:text,kind:text,inventoryId:text,owner:text,status:text,createdAt:date,stageId:text.nullable(),
  targetId:text.nullable(),materialId:text.nullable(),assetId:text.nullable(),
  priceLamports:units.nullable(),feeLamports:units.nullable(),costLamports:units.nullable(),
});
export const quoteModel=z.object({
  kind:z.enum(['visual','upgrade']),feeLamports:units,materialId:text.nullable(),targetId:text,
  nextTargetLevel:count.optional(),nextTargetExpiry:date.optional(),cooldownMs:count.optional(),
  materialProbabilities:z.array(z.object({level:count,count,total:count})).optional(),
  fields:z.array(text).optional(),
});
export const boardModel=z.object({
  status:z.enum(['pending','final']),date:text,
  items:z.array(z.object({rank:count,wallet:text,contentScore:count,multiplierTenths:count,pointsTenths:count})),
});
export const submissionModel=z.object({id:text,url:text,tokenId:text,status:text,score:count.nullable(),reason:text.nullable()});
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
