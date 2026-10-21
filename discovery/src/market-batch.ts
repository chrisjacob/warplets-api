import {z} from "zod";
import {Address,MarketSchema,type Market} from "./model";
import {WSOL} from "./pump";
import {safeTokenImage} from "./images";
import {SourceError} from "./rpc";
import {hashJson} from "./solana";
import {MarketBatchInputSchema,MarketBatchRecordSchema,MarketBatchReportSchema,type MarketBatchInput,type MarketBatchReport,type MarketBatchRecord} from "./market-batch-model";

const Locator=z.object({chainId:z.string().max(100),pairAddress:z.string().min(1).max(200)});
// Keep the existing quote/identity/metric validation for each requested pool.
const Pair=z.object({chainId:z.string(),pairAddress:Address,baseToken:z.object({address:Address}),quoteToken:z.object({address:Address}),priceUsd:z.unknown().optional(),marketCap:z.unknown().optional(),fdv:z.unknown().optional(),liquidity:z.object({usd:z.unknown().optional()}).nullish(),volume:z.object({h24:z.unknown().optional()}).optional(),info:z.object({imageUrl:z.unknown().optional()}).optional()});
const number=(v:unknown)=>(typeof v==="number"||typeof v==="string"&&v.trim()!=="")&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
export function validateMarketRows(rows:MarketBatchInput["rows"]) {
  if(!rows.length||rows.length>30||new Set(rows.map(r=>r.address)).size!==rows.length||new Set(rows.map(r=>r.pool)).size!==rows.length)throw new SourceError("invalid_market_batch");
  rows.forEach(r=>{Address.parse(r.address);Address.parse(r.pool);});
}
export function decodeMarketBatch(raw:MarketBatchInput) {
  const inputs=MarketBatchInputSchema.parse(raw);validateMarketRows(inputs.rows);
  const markets=new Map<string,Market>(),groups=new Map<string,unknown[]>(),pools=new Set(inputs.rows.map(r=>r.pool));
  let ignored=0,unscoped=0;
  for(const value of inputs.pairs){
    const id=Locator.safeParse(value);
    // An unassignable identity could hide a conflicting target record. Hold
    // every target rather than assuming that the malformed row is unrelated.
    if(!id.success){unscoped++;continue;}
    if(id.data.chainId!=="solana"){ignored++;continue;}
    if(!Address.safeParse(id.data.pairAddress).success){unscoped++;continue;}
    if(!pools.has(id.data.pairAddress)){ignored++;continue;}
    const group=groups.get(id.data.pairAddress)??[];group.push(value);groups.set(id.data.pairAddress,group);
  }
  const decisions:MarketBatchReport["rows"]=inputs.rows.map(row=>{
    const result={...row,state:"rejected" as const,code:null as MarketBatchReport["rows"][number]["code"],fields:[] as string[]};
    if(unscoped)return {...result,code:"market_unscoped_pair_identity"};
    const matches=groups.get(row.pool)??[];
    if(!matches.length)return {...result,state:"not_reported" as const,code:"market_pool_not_reported"};
    if(matches.length>1)return {...result,code:"market_duplicate_pool"};
    const parsed=Pair.safeParse(matches[0]);
    if(!parsed.success)return {...result,code:"market_pair_schema_invalid",fields:[...new Set(parsed.error.issues.map(i=>i.path.join(".").slice(0,80)))].sort().slice(0,6)};
    const p=parsed.data;
    if(p.baseToken.address!==row.address||p.quoteToken.address!==WSOL)return {...result,code:"market_identity_mismatch"};
    markets.set(row.address,MarketSchema.parse({source:"dexscreener",fetched_at:inputs.at,observed_at:null,price_usd:number(p.priceUsd),market_cap_usd:number(p.marketCap),fdv_usd:number(p.fdv),liquidity_usd:number(p.liquidity?.usd),volume_24h_usd:number(p.volume?.h24),image_url:safeTokenImage(p.info?.imageUrl)}));
    return {...result,state:"accepted" as const};
  });
  const report=MarketBatchReportSchema.parse({version:"dex-market-report-v1",at:inputs.at,provider:"dexscreener",requested:inputs.rows.length,accepted:markets.size,not_reported:decisions.filter(r=>r.state==="not_reported").length,rejected:decisions.filter(r=>r.state==="rejected").length,response_pairs:inputs.pairs.length,ignored_pairs:ignored,unscoped_pairs:unscoped,rows:decisions});
  return {markets,report};
}
const metadata=(r:{input_hash:string;report_hash:string})=>({version:"dex-market-report-v1",input_hash:r.input_hash,report_hash:r.report_hash});
export async function freezeMarketBatch(raw:MarketBatchInput) {
  const inputs=MarketBatchInputSchema.parse(raw);
  if(new TextEncoder().encode(JSON.stringify(inputs)).length>1_020_000)throw new SourceError("market_batch_snapshot_size_limit");
  const {markets,report}=decodeMarketBatch(inputs),hashes={input_hash:await hashJson(inputs),report_hash:await hashJson(report)};
  const record=MarketBatchRecordSchema.parse({...hashes,inputs,report,record_hash:await hashJson(metadata(hashes))});
  if(new TextEncoder().encode(JSON.stringify(record)).length>1_100_000)throw new SourceError("market_batch_snapshot_size_limit");
  return {markets,record};
}
export async function replayMarketBatch(raw:MarketBatchRecord) {
  const r=MarketBatchRecordSchema.parse(raw),replayed=await freezeMarketBatch(r.inputs);
  if(await hashJson(replayed.record)!==await hashJson(r))throw new SourceError("market_batch_replay_mismatch");
  return {status:"verified" as const,provider_requests:0 as const,report:r.report};
}
