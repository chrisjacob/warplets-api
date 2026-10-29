import {networkFetchJson} from './source';
import {bounded,reserveRequest,type NetworkEnv} from './store';

const costs = {eth_getBalance:20,alchemy_getTokenBalances:20,alchemy_getTokenMetadata:10} as const;
type Method = keyof typeof costs;
export interface AlchemyEnv extends NetworkEnv {ALCHEMY_API_KEY?:string;NETWORK_ALCHEMY_CU?:string}
const ADDRESS=/^0x[a-f0-9]{40}$/i;
const UINT=/^0x[0-9a-f]{1,64}$/i;
export async function alchemyRead(env:AlchemyEnv,method:Method,params:unknown[]):Promise<unknown> {
  if(!env.ALCHEMY_API_KEY||!/^[-_a-zA-Z0-9]{10,200}$/.test(env.ALCHEMY_API_KEY))throw Error('Alchemy key is missing or invalid');
  const cost=costs[method];
  if(!cost)throw Error('Unsupported Alchemy method');
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10),month=day.slice(0,7);
  const limit=bounded(env.NETWORK_ALCHEMY_CU,10_000_000,10_000_000);
  const dailyLimit=bounded(env.NETWORK_ALCHEMY_CU_PER_DAY,1_500_000,4_000_000);
  // Reserve before every attempt, including failures. One conditional write
  // prevents concurrent callers from exceeding either the daily or monthly cap.
  const budget=await env.WARPLETS.prepare(`INSERT INTO network_alchemy_budgets(period,reserved)
    SELECT ?,? WHERE COALESCE((SELECT reserved FROM network_alchemy_budgets WHERE period=?),0)+?<=? AND COALESCE((SELECT SUM(reserved) FROM network_alchemy_budgets WHERE substr(period,1,7)=?),0)+?<=?
    ON CONFLICT(period) DO UPDATE SET reserved=network_alchemy_budgets.reserved+excluded.reserved RETURNING reserved`)
    .bind(day,cost,day,cost,dailyLimit,month,cost,limit).first();
  if(!budget)throw Error('Alchemy CU budget exhausted');
  await reserveRequest(env,'alchemy-base');
  let acquired=false;
  for(let i=0;i<40;i++) {
    const at=Date.now();
    const row=await env.WARPLETS.prepare(`INSERT INTO network_alchemy_rate(name,next_at) VALUES('base',?) ON CONFLICT(name) DO UPDATE SET next_at=excluded.next_at WHERE network_alchemy_rate.next_at<=? RETURNING next_at`).bind(at+100,at).first();
    if(row){acquired=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!acquired)throw Error('Alchemy rate pause');
  let payload:unknown;
  try {
    payload=await networkFetchJson(`https://base-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  } catch(error) {
    // RPC keys live in the URL: never propagate fetch causes, URLs or provider
    // error messages into logs, sync state, or public responses.
    const status=error instanceof Error?error.message.match(/^Network source HTTP (\d{3})$/)?.[1]:null;
    throw Error(status?`Alchemy HTTP ${status}`:'Alchemy request failed');
  }
  const result=payload as {jsonrpc?:string;id?:number;result?:unknown;error?:{code?:number}};
  if(result?.error)throw Error('Alchemy RPC request rejected');
  if(result?.jsonrpc!=='2.0'||result.id!==1||!Object.hasOwn(result,'result'))throw Error('Invalid Alchemy response');
  return result.result;
}

export async function alchemyWalletBalances(env:AlchemyEnv,address:string) {
  if(!ADDRESS.test(address))throw Error('Invalid wallet address');
  const tokens:{address:string;balance:string}[]=[];const unavailable:string[]=[];
  const seen=new Set<string>(),cursors=new Set<string>();let pageKey='';let done=false;
  // Large public wallets can contain over 10,000 token records, including spam.
  // Still bounded: at most 100,000 records / 20,000 CU in balance pages per scan.
  // Every page uses the same atomic daily/monthly reservations and RPC gate.
  for(let page=0;page<1000;page++) {
    const result=await alchemyRead(env,'alchemy_getTokenBalances',[address,'erc20',{maxCount:100,...(pageKey?{pageKey}:{})}]) as {address:string;tokenBalances:{contractAddress:string;tokenBalance:string;error?:unknown}[];pageKey?:string};
    if(result?.address?.toLowerCase()!==address.toLowerCase()||!Array.isArray(result.tokenBalances)||result.tokenBalances.length>100)throw Error('Invalid Alchemy wallet page');
    for(const row of result.tokenBalances) {
      if(!ADDRESS.test(row.contractAddress))throw Error('Invalid Alchemy token address');
      const contract=row.contractAddress.toLowerCase();
      if(seen.has(contract))throw Error('Duplicate Alchemy token');seen.add(contract);
      if(typeof row.error==='string'&&row.error.length>0){unavailable.push(contract);continue;}
      if(typeof row.tokenBalance!=='string'||!UINT.test(row.tokenBalance)||row.error)throw Error('Invalid Alchemy token balance');
      if(BigInt(row.tokenBalance)>0n)tokens.push({address:contract,balance:BigInt(row.tokenBalance).toString()});
    }
    if(result.pageKey===undefined||result.pageKey===''){done=true;break;}
    if(typeof result.pageKey!=='string'||result.pageKey.length>2000||cursors.has(result.pageKey))throw Error('Invalid Alchemy pagination');
    cursors.add(result.pageKey);pageKey=result.pageKey;
  }
  if(!done)throw Error('Alchemy pagination cap reached');
  const native=await alchemyRead(env,'eth_getBalance',[address,'latest']);
  if(typeof native!=='string'||!UINT.test(native))throw Error('Invalid Alchemy native balance');
  return {native:BigInt(native).toString(),tokens,unavailable};
}
export async function alchemyTokenMetadata(env:AlchemyEnv,address:string) {
  const cached=await env.WARPLETS.prepare('SELECT payload,observed_at FROM network_alchemy_metadata WHERE asset=?').bind(address).first<{payload:string;observed_at:number}>();
  if(cached&&cached.observed_at>Date.now()-30*86_400_000)return JSON.parse(cached.payload) as {decimals:number;symbol:string;name:string}|null;
  const raw=await alchemyRead(env,'alchemy_getTokenMetadata',[address]) as {decimals:number;symbol?:string;name?:string};
  const metadata=raw&&Number.isSafeInteger(raw.decimals)&&raw.decimals>=0&&raw.decimals<=36?{decimals:raw.decimals,symbol:String(raw.symbol??'').slice(0,24),name:String(raw.name??'').slice(0,100)}:null;
  await env.WARPLETS.prepare('INSERT INTO network_alchemy_metadata(asset,payload,observed_at) VALUES(?,?,?) ON CONFLICT(asset) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at').bind(address,JSON.stringify(metadata),Date.now()).run();
  return metadata;
}
