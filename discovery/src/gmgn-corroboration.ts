import{z}from"zod";
import{Signature}from"./model";
import{replayGmgnActivityRecord}from"./gmgn-activity-replay";
import{WalletTransactionSchema,signer}from"./wallet-rpc";
import{canonicalPool}from"./pump";
import{verifiedTrades}from"./wallet-trades";
import{hashJson}from"./solana";
import{boundedJsonValue}from"./source-pilot";
import{GmgnCorroborationInputSchema,GmgnCorroborationReportSchema,GmgnCorroborationStatusSchema as Status,GMGN_CORROBORATION_BYTES,GMGN_CORROBORATION_CACHE_BYTES}from"./gmgn-corroboration-model";
export * from "./gmgn-corroboration-model";
const Time=z.string().datetime();
export async function activityForCorroboration(raw:unknown){
  const verified=await replayGmgnActivityRecord(raw);
  const record=z.object({request:z.object({address:z.string(),wallet:z.string()}),receipt:z.object({received_at:Time,response:z.object({data:z.object({activities:z.array(z.object({tx_hash:Signature,event_type:z.string().optional(),type:z.string().optional(),timestamp:z.union([z.number(),z.string().transform(Number)]).nullable().optional(),token_amount:z.unknown()}).passthrough()).max(20)})})})}).parse(raw);
  return{...record,report_hash:verified.report_hash,signatures:[...new Set(record.receipt.response.data.activities.map(row=>row.tx_hash))].sort()};
}
function rawQuantity(value:unknown,decimals:number):bigint|null{
  const text=typeof value==="string"?value:typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?String(value):"";
  if(text.length>100||!/^\d+(?:\.\d+)?$/.test(text))return null;
  const[whole,fraction=""]=text.split(".");if(fraction.slice(decimals).replaceAll("0","").length)return null;
  return BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.slice(0,decimals).padEnd(decimals,"0")||"0");
}
export async function reviewGmgnCorroboration(raw:unknown){
  boundedJsonValue(raw,GMGN_CORROBORATION_BYTES);const input=GmgnCorroborationInputSchema.parse(raw),source=await activityForCorroboration(input.activity_record),cutoff=Date.parse(input.cutoff_at);
  if(Date.parse(source.receipt.received_at)>cutoff)throw Error("gmgn_rpc_source_from_future");
  if(new Set(input.transactions.map(row=>row.signature)).size!==input.transactions.length)throw Error("gmgn_rpc_duplicate_cache_entry");
  const cache=new Map<string,z.infer<typeof WalletTransactionSchema>>();let bytes=0;
  for(const row of input.transactions){
    if(!source.signatures.includes(row.signature)||Date.parse(row.fetched_at)>cutoff)throw Error("gmgn_rpc_cache_scope_or_time");
    bytes+=new TextEncoder().encode(JSON.stringify(row.transaction)).length;if(bytes>GMGN_CORROBORATION_CACHE_BYTES)throw Error("gmgn_rpc_cache_bytes");
    const tx=WalletTransactionSchema.parse(row.transaction);
    if(await hashJson(row.transaction)!==row.raw_hash||await hashJson(tx)!==row.payload_hash||tx.transaction.signatures[0]!==row.signature)throw Error("gmgn_rpc_cache_hash_mismatch");
    if(tx.blockTime===null||tx.blockTime*1000>Date.parse(row.fetched_at))throw Error("gmgn_rpc_transaction_time");cache.set(row.signature,tx);
  }
  const held=source.signatures.length>2,gaps=["rpc_body_not_independent_finality_attestation","usd_valuation_unverified","population_trade_coverage_unknown","later_evidence_does_not_enrich_archived_scores"];
  if(held)gaps.push("two_signature_bound_exceeded");if(!cache.size)gaps.push("matching_rpc_bodies_missing");
  const events=source.receipt.response.data.activities,tradeEvents=events.filter(row=>["buy","sell"].includes(row.event_type??row.type??""));
  const grouped=new Map<string,typeof tradeEvents>();for(const row of tradeEvents){const key=row.tx_hash+":"+(row.event_type??row.type);grouped.set(key,[...(grouped.get(key)??[]),row]);}
  const pool=(await canonicalPool(source.request.address)).pool,groups:z.infer<typeof GmgnCorroborationReportSchema>["groups"]=[];let exact=0,aggregate=0;
  for(const rows of grouped.values()){
    const first=rows[0]!,side=first.event_type??first.type!,tx=cache.get(first.tx_hash);let status:z.infer<typeof Status>="cache_missing",count=0;
    if(tx&&!held){
      if(!tx.meta||tx.meta.err!==null)status="transaction_failed";
      else if(rows.some(row=>!row.timestamp||row.timestamp!==tx.blockTime))status="time_conflict";
      else{
        const parsed=await verifiedTrades(tx,source.request.address,pool,{temporaryWsol:true}).catch(()=>({trades:[],gaps:["parser_unusable"]}));
        const own=parsed.trades.filter(t=>t.wallet===source.request.wallet&&t.side===side);count=own.length;
        if(count>100)throw Error("gmgn_rpc_instruction_bound");
        if(parsed.gaps.some(g=>g!=="native_quote_amount_unmeasured"))status="parser_held";
        else if(!signer(tx,source.request.wallet)||!own.length)status="wallet_or_side_not_supported";
        else{
          const decimals=[...new Set([...tx.meta.preTokenBalances,...tx.meta.postTokenBalances].filter(b=>b.mint===source.request.address).map(b=>b.uiTokenAmount.decimals))];
          const amounts=decimals.length===1?rows.map(row=>rawQuantity(row.token_amount,decimals[0]!)):[];
          if(!amounts.length||amounts.some(n=>n===null))status="quantity_unknown";
          else{
            const raw=amounts as bigint[],chain=own.map(t=>BigInt(t.base_amount_raw)),order=(a:bigint,b:bigint)=>a<b?-1:a>b?1:0;
            raw.sort(order);chain.sort(order);
            if(raw.length===chain.length&&raw.every((n,i)=>n===chain[i])){status="exact_instruction_quantities";exact+=rows.length;}
            else if(raw.reduce((a,b)=>a+b,0n)===chain.reduce((a,b)=>a+b,0n)){status="aggregate_quantity_only";aggregate+=rows.length;}
            else status="quantity_conflict";
          }
        }
      }
    }
    groups.push({events:rows.length,parsed_instructions:count,status});
  }
  const report={version:"gmgn-rpc-comparison-v1" as const,address:source.request.address,cutoff_at:input.cutoff_at,activity_received_at:source.receipt.received_at,activity_report_hash:source.report_hash,status:held?"held":"compared_sample",required_transactions:source.signatures.length,cached_transactions:cache.size,reported_trade_events:tradeEvents.length,non_trade_events:events.length-tradeEvents.length,exact_quantity_events:exact,aggregate_only_events:aggregate,groups,gaps,finality_independently_attested:false,usd_volume_verified:false,organic_volume_usd:null,scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0,input_hash:await hashJson(input)};
  const identified={...report,activity_id:input.activity_id};return GmgnCorroborationReportSchema.parse({...identified,report_hash:await hashJson(identified)});
}
export async function replayGmgnCorroboration(raw:unknown){
  boundedJsonValue(raw,GMGN_CORROBORATION_BYTES+100_000);const record=z.object({inputs:GmgnCorroborationInputSchema,report:GmgnCorroborationReportSchema}).strict().parse(raw),report=await reviewGmgnCorroboration(record.inputs);
  if(await hashJson(report)!==await hashJson(record.report))throw Error("gmgn_rpc_report_mismatch");return report;
}
