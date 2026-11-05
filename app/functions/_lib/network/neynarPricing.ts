import { networkFetchJson } from './source';
import { reserveRequest, syncGet, syncSet, type NetworkEnv } from './store';

type Prices=Record<string,number>;
export function parseNeynarPrices(input:unknown):Prices{
 const rest=(input as {pricing?:{products?:{api?:{rest?:Record<string,{GET?:Record<string,{price?:{amount?:unknown};is_free_tier_eligible?:boolean}>}>}}}})?.pricing?.products?.api?.rest;
 if(!rest||typeof rest!=='object')throw Error('Invalid Neynar pricing feed');
 const prices:Prices={};
 for(const category of Object.values(rest))for(const[path,row]of Object.entries(category.GET??{})){
  const amount=row.price?.amount;
  if(row.is_free_tier_eligible===true&&typeof amount==='number'&&Number.isSafeInteger(amount)&&amount>=0&&amount<=100_000)prices[path.replace(/\/$/,'')]=amount;
 }
 if(Object.keys(prices).length<5)throw Error('Incomplete Neynar pricing feed');
 return prices;
}
export async function neynarReservation(env:NetworkEnv,path:string){
 let cached=await syncGet<{at:number;prices:Prices}|null>(env.WARPLETS,'neynar_pricing',null);
 if(!cached||cached.at<Date.now()-86_400_000){
  await reserveRequest(env,'neynar-pricing');
  // The provider's own pricing page reads this public, credential-free feed.
  const prices=parseNeynarPrices(await networkFetchJson('https://dev.neynar.com/api/pricing'));
  cached={at:Date.now(),prices};await syncSet(env.WARPLETS,'neynar_pricing',cached);
 }
 const url=new URL(path,'https://api.neynar.com'),canonical=url.pathname.replace(/\/$/,'');
 const rate=cached.prices[canonical];
 if(rate===undefined)throw Error('Neynar endpoint has no verified free-tier tariff');
 const objects=canonical==='/v2/farcaster/user/bulk'?url.searchParams.get('fids')?.split(',').length:canonical.startsWith('/v2/')?Number(url.searchParams.get('limit')??1):1;
 if(!objects||!Number.isSafeInteger(objects)||objects<1||objects>150)throw Error('Invalid Neynar tariff multiplier');
 return rate*objects;
}
