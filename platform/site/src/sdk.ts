import { createClient, PlatformApiError } from '../../contracts/client.mjs';
import { z } from 'zod';
import {
  assetModel, awardModel, ballotModel, boardModel, farmModel, inventoryModel, pageOf, policyModel,
  positionModel, quoteModel, receiptModel, submissionModel,
} from './models';

export const client=createClient();
export { PlatformApiError };
const queryCursor=(cursor?:string)=>cursor?{cursor}:{};
const rows=<T extends z.ZodType>(type:T,payload:unknown)=>pageOf(type).parse(payload);
const one=<T extends z.ZodType>(type:T,payload:unknown):z.output<T>=>
  type.parse(z.object({data:z.unknown()}).parse(payload).data);

export const sdk={
  policy:async(signal?:AbortSignal)=>one(policyModel,await client.getPolicy({signal})),
  markets:(cursor?:string,signal?:AbortSignal)=>client.listMarkets({query:{...queryCursor(cursor),limit:25},signal}),
  market:async(id:string,signal?:AbortSignal)=>(await client.getMarket({path:{id},signal})).data,
  curve:async(signal?:AbortSignal)=>(await client.getFeeSchedule({signal})).data.points,
  profile:async(signal?:AbortSignal)=>{
    try{return (await client.getProfile({signal})).data;}
    catch(err){if(err instanceof PlatformApiError && err.status===401)return null;throw err;}
  },
  inventories:async(cursor?:string,signal?:AbortSignal)=>{
    const options={signal,query:queryCursor(cursor)};
    return rows(inventoryModel,await client.listLocalInventories(options));
  },
  assets:async(cursor?:string,signal?:AbortSignal)=>{
    const options={signal,query:queryCursor(cursor)};
    return rows(assetModel,await client.listMyCollectionAssets(options));
  },
  asset:async(id:string,signal?:AbortSignal)=>one(assetModel,await client.readLocalAsset({path:{id},signal})),
  receipts:async(cursor?:string,signal?:AbortSignal)=>{
    const options={signal,query:queryCursor(cursor)};
    return rows(receiptModel,await client.listMyCollectionOperations(options));
  },
  receipt:async(id:string,signal?:AbortSignal)=>one(receiptModel,await client.readMyCollectionOperation({path:{id},signal})),
  ballots:async(signal?:AbortSignal)=>rows(ballotModel,await client.listGenesisBallots({signal})),
  board:async(epoch:string,signal?:AbortSignal)=>boardModel.parse(await client.getEarnLeaderboard({path:{epoch},signal})),
  submissions:async(cursor?:string,signal?:AbortSignal)=>rows(submissionModel,await client.getMyEarnSubmissions({
    query:cursor?{cursor:Number(cursor)}:{},signal})),
  awards:async(cursor?:string,signal?:AbortSignal)=>rows(awardModel,await client.getMyEarnClaims({
    query:cursor?{cursor:Number(cursor)}:{},signal})),
  myVault:(cursor?:string,signal?:AbortSignal)=>{const options={signal,query:queryCursor(cursor)};return client.getMyVault(options);},
  nftVault:(id:string,cursor?:string,signal?:AbortSignal)=>{const options={path:{id},query:queryCursor(cursor),signal};return client.getNftVault(options);},
  positions:async(cursor?:string,signal?:AbortSignal)=>{const options={signal,query:queryCursor(cursor)};
    return rows(positionModel,await client.getStakePositions(options));},
  farm:async(id:string,signal?:AbortSignal)=>one(farmModel,await client.getFarm({path:{id},signal})),
  mint:async(id:string,stage:string,idempotencyKey:string)=>{
    const options={path:{id,stage},idempotencyKey,body:{}};
    return one(z.object({operation:receiptModel}),await client.reserveLocalMint(options)).operation;
  },
  quote:async(id:string,body:ProgressionRequest)=>{
    const options={path:{id},body};
    return one(quoteModel,await client.quoteLocalProgression(options));
  },
  progress:async(id:string,body:ProgressionRequest,idempotencyKey:string)=>{
    const options={path:{id},body,idempotencyKey};
    return one(z.object({operation:receiptModel}),await client.reserveLocalProgression(options)).operation;
  },
};
export type ProgressionRequest={kind:'upgrade'|'visual';targetId:string;expectedTargetVersion:number;
  materialId?:string;expectedMaterialVersion?:number};
