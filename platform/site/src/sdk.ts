import { createClient, PlatformApiError } from '../../contracts/client.mjs';
import { z } from 'zod';
import { capabilityTransport } from './capability-transport.mjs';
import {
  assetModel, awardModel, ballotModel, boardModel, farmModel, inventoryModel, pageOf, policyModel,
  positionModel, quoteModel, receiptModel, vaultHoldingsModel, nftVaultModel, submissionsPageModel,
} from './models';

export const runtimeTransport=capabilityTransport();
export const client=createClient({fetchImpl:async(input,init)=>{
  const response=await runtimeTransport.fetch(input,init);
  const path=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,'http://local.invalid').pathname;
  if(response.status===401 && path!=='/api/v1/me' && !path.startsWith('/api/v1/auth/') && typeof window!=='undefined')
    window.dispatchEvent(new Event('10x:session-expired'));
  return response;
}});
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
  inventory:async(id:string,signal?:AbortSignal)=>one(inventoryModel,await client.readLocalInventory({path:{id},signal})),
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
  submissions:async(cursor?:string,signal?:AbortSignal)=>submissionsPageModel.parse(await client.getMyEarnSubmissions({
    query:cursor?{cursor:Number(cursor)}:{},signal})),
  awards:async(cursor?:string,signal?:AbortSignal)=>rows(awardModel,await client.getMyEarnClaims({
    query:cursor?{cursor:Number(cursor)}:{},signal})),
  myVault:async(cursor?:string,signal?:AbortSignal)=>{const options={signal,query:queryCursor(cursor)};return vaultHoldingsModel.parse(await client.getMyVault(options));},
  nftVault:async(id:string,cursor?:string,signal?:AbortSignal)=>{const options={path:{id},query:queryCursor(cursor),signal};return nftVaultModel.parse(await client.getNftVault(options));},
  positions:async(cursor?:string,signal?:AbortSignal)=>{const options={signal,query:queryCursor(cursor)};
    return rows(positionModel,await client.getStakePositions(options));},
  farm:async(id:string,signal?:AbortSignal)=>one(farmModel,await client.getFarm({path:{id},signal})),
  mint:async(id:string,stage:string,idempotencyKey:string)=>{
    const options={path:{id,stage},idempotencyKey,body:{}};
    return one(z.object({operation:receiptModel}),await client.reserveLocalMint(options)).operation;
  },
  quote:async(id:string,body:ProgressionRequest,idempotencyKey:string,signal?:AbortSignal)=>{
    const options={path:{id},body,idempotencyKey,signal};
    return one(quoteModel,await client.quoteLocalProgression(options));
  },
  progress:async(id:string,body:ProgressionReservationRequest,idempotencyKey:string)=>{
    const options={path:{id},body,idempotencyKey};
    return one(z.object({operation:receiptModel}),await client.reserveLocalProgression(options)).operation;
  },
};
export type ProgressionRequest={kind:'upgrade'|'visual';targetId:string;expectedTargetVersion:number;
  materialId?:string;expectedMaterialVersion?:number};
export type ProgressionReservationRequest=ProgressionRequest&{quoteId:string;bindingDigest:string;policyVersion:string;
  reviewedFeeLamports:string;reviewedMaxTotalLamports:string;quoteExpiresMs:number};
