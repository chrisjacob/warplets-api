import{z}from"zod";
import{activityForCorroboration,replayGmgnCorroboration}from"./gmgn-corroboration";
import{GmgnCorroborationInputSchema,GMGN_CORROBORATION_BYTES}from"./gmgn-corroboration-model";
import{GmgnQuoteReportSchema,type GmgnQuoteReport}from"./gmgn-quote-model";
import{gmgnActivityUsd}from"./gmgn-wallet-activity";
import{WalletTransactionSchema}from"./wallet-rpc";
import{canonicalPool}from"./pump";
import{verifiedTrades}from"./wallet-trades";
import{tradingFeesForTransaction}from"./trading-fees";
import{hashJson}from"./solana";
import{boundedJsonValue}from"./source-pilot";
export * from"./gmgn-quote-model";
export async function reviewGmgnQuote(raw:unknown){
  const comparison=await replayGmgnCorroboration(raw),{inputs}=z.object({inputs:GmgnCorroborationInputSchema}).parse(raw),source=await activityForCorroboration(inputs.activity_record);
  const pool=(await canonicalPool(source.request.address)).pool,events=source.receipt.response.data.activities.filter(row=>["buy","sell"].includes(row.event_type??row.type??""));
  const grouped=new Map<string,typeof events>();for(const row of events){const key=row.tx_hash+":"+(row.event_type??row.type);grouped.set(key,[...(grouped.get(key)??[]),row]);}
  const groups:GmgnQuoteReport["groups"]=[];let index=0,supported=0;
  for(const rows of grouped.values()){
    const first=rows[0]!,side=(first.event_type??first.type)as"buy"|"sell",matched=comparison.groups[index++]!;
    const costs=rows.map(row=>gmgnActivityUsd(row.cost_usd)),gaps:string[]=[];
    let reported=costs.every(c=>c.value!==null&&c.value>=0)?costs.reduce((sum,c)=>sum+c.value!,0):null;
    if(reported!==null&&!Number.isFinite(reported))reported=null;
    if(reported===null)gaps.push("provider_usd_missing_unusable_or_signed");
    const group:GmgnQuoteReport["groups"][number]={side,events:rows.length,token_match:matched.status,quote_kinds:[],pool_quote_transfer_raw:null,reported_usd:reported,implied_usd_per_sol:null,fee_rows:0,fee_status:"unavailable",event_quote_raw:null,known_fee_raw:null,wallet_swap_cashflow_raw:null,gaps};
    if(comparison.status==="held"||!["exact_instruction_quantities","aggregate_quantity_only"].includes(matched.status))gaps.push("token_comparison_not_supported");
    else{
      const body=inputs.transactions.find(row=>row.signature===first.tx_hash)!;
      const tx=WalletTransactionSchema.parse(body.transaction),parsed=await verifiedTrades(tx,source.request.address,pool,{temporaryWsol:true}),own=parsed.trades.filter(t=>t.wallet===source.request.wallet&&t.side===side);
      if(own.length!==matched.parsed_instructions||new Set(own.map(t=>t.instruction_index)).size!==own.length)throw Error("gmgn_quote_instruction_mismatch");
      group.quote_kinds=[...new Set(own.map(t=>t.quote_kind))].sort();
      if(own.length&&own.every(t=>t.quote_amount_raw!==null&&BigInt(t.quote_amount_raw)>0n)){
        const quote=own.reduce((sum,t)=>sum+BigInt(t.quote_amount_raw!),0n);group.pool_quote_transfer_raw=quote.toString();supported+=rows.length;
        if(reported!==null){const implied=reported/(Number(quote)/1e9);if(Number.isFinite(implied))group.implied_usd_per_sol=implied;else gaps.push("implied_conversion_out_of_range");}
      }else gaps.push("pool_quote_transfer_unknown");
      const fees=await tradingFeesForTransaction(tx,source.request.address,pool).catch(()=>({rows:[],unverified:[]}));
      const selected=own.map(t=>fees.rows.find(f=>f.instruction_index===t.instruction_index&&f.wallet===t.wallet&&f.side===side));
      group.fee_rows=selected.filter(f=>f!==undefined).length;
      for(const fee of selected)if(fee)gaps.push(...fee.gaps);
      if(selected.length&&selected.every(f=>f!==undefined)){
        const quote=selected.reduce((sum,f)=>sum+BigInt(f!.quote_amount_raw),0n),fee=selected.reduce((sum,f)=>sum+BigInt(f!.total_fee_raw),0n);
        group.event_quote_raw=quote.toString();group.known_fee_raw=fee.toString();
        group.fee_status=selected.every(f=>!f!.gaps.length)?"known_layout_complete":"partial";
        if(group.fee_status==="known_layout_complete"){
          const cash=side==="buy"?quote+fee:quote-fee;if(cash<0n)throw Error("gmgn_quote_negative_cashflow");group.wallet_swap_cashflow_raw=cash.toString();
        }
      }else{
        if(group.fee_rows)group.fee_status="partial";
        gaps.push("fee_coverage_incomplete",...fees.unverified.filter(f=>own.some(t=>t.instruction_index===f.instruction_index)).map(f=>f.reason));
      }
      if(group.wallet_swap_cashflow_raw===null)gaps.push("wallet_swap_cashflow_withheld");
    }
    group.gaps=[...new Set(gaps)].slice(0,20);groups.push(group);
  }
  const total=(side:"buy"|"sell")=>{const rows=groups.filter(g=>g.side===side);return rows.length&&rows.every(g=>g.pool_quote_transfer_raw!==null)?rows.reduce((sum,g)=>sum+BigInt(g.pool_quote_transfer_raw!),0n).toString():null;};
  const result={version:"gmgn-quote-review-v1" as const,activity_id:comparison.activity_id,address:comparison.address,cutoff_at:comparison.cutoff_at,comparison_hash:comparison.report_hash,status:comparison.status==="held"?"held":"reviewed_sample",reported_trade_events:events.length,supported_events:supported,quote_decimals:9,buy_pool_quote_transfer_raw:total("buy"),sell_pool_quote_transfer_raw:total("sell"),groups,
    gaps:["provider_implied_conversion_not_historical_sol_price","pool_transfer_and_event_quote_have_different_fee_bases","network_fees_rent_tips_and_unrelated_flows_excluded","independent_finality_and_population_coverage_unknown","organic_volume_and_scoring_held"],historical_usd_verified:false,organic_volume_usd:null,scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0};
  return GmgnQuoteReportSchema.parse({...result,report_hash:await hashJson(result)});
}
export async function replayGmgnQuote(raw:unknown){
  boundedJsonValue(raw,GMGN_CORROBORATION_BYTES+200_000);const record=z.object({version:z.literal("gmgn-quote-replay-v1"),comparison:z.unknown(),report:GmgnQuoteReportSchema}).strict().parse(raw),report=await reviewGmgnQuote(record.comparison);
  if(await hashJson(report)!==await hashJson(record.report))throw Error("gmgn_quote_report_mismatch");return report;
}
