import {FeeLaunchScenario,FeeLaunchResult,FEE_MATH_REVISION,LaunchScenario,type FeeLaunchInput, type LaunchResult} from "./launch-model";
import type {z} from "zod";
import {amountA,amountB,U64_MAX} from "./launch-curve";
import {quoteOnlySwap} from "./launch-fee-kernel";
export function feeSeedScenario(input:FeeLaunchInput){
  const {version:_v,trades:_t,pools,...base}=input;
  const strip=({fees:_fees,...pool}:FeeLaunchInput["pools"]["native"])=>pool;
  return LaunchScenario.parse({...base,version:"launch-curve-lab-v1",pools:{native:strip(pools.native),og:strip(pools.og),tenx:strip(pools.tenx)},trades:[]});
}
function nextPrice(initial:{numerator:string;denominator:string},initialSqrt:bigint,next:bigint){
  const n=BigInt(initial.numerator)*next*next,d=BigInt(initial.denominator)*initialSqrt*initialSqrt;let a=n,b=d;while(b){const r=a%b;a=b;b=r;}
  return {numerator:(n/a).toString(),denominator:(d/a).toString()};
}
export function evaluateFeeLaunch(raw:unknown,seed:z.infer<typeof LaunchResult>){
  const input=FeeLaunchScenario.parse(raw),pools=seed.pools.map(p=>({...p,final:structuredClone(p.initial),fees:input.pools[p.pool].fees,fee_totals:{total_fee_raw:"0",lp_claiming_fee_raw:"0",protocol_fee_raw:"0",referral_fee_raw:"0"}}));
  const steps=input.trades.map((trade,index)=>{
    const p=pools.find(p=>p.pool===trade.pool)!,before=structuredClone(p.final),aForB=trade.direction==="attn_to_quote",gross=BigInt(trade.gross_input_raw),f=p.fees;
    const quote=quoteOnlySwap(BigInt(p.sqrt_min),BigInt(p.sqrt_max),BigInt(before.sqrt_price),BigInt(p.liquidity_q64),gross,aForB,BigInt(f.fee_numerator),f.protocol_fee_percent,f.referral_fee_percent,trade.has_referral);
    let status:"simulated"|"range_exhausted"|"fee_consumes_input"|"zero_output"|"inventory_or_u64_bound"|"minimum_output_not_met"=quote.status==="quoted"?quote.traderOutput===0n?"zero_output":"simulated":quote.status;
    if(quote.status==="quoted"&&status==="simulated"){
      if(quote.traderOutput<BigInt(trade.minimum_output_raw))status="minimum_output_not_met";
      const a=BigInt(before.attn_raw)+(aForB?quote.netInput:-quote.curveOutput),b=BigInt(before.quote_raw)+(aForB?-quote.curveOutput:quote.netInput);
      if(a<0n||b<0n||a>U64_MAX||b>U64_MAX||quote.curveOutput>U64_MAX||quote.traderOutput>U64_MAX)status="inventory_or_u64_bound";
      if(status==="simulated"){
        p.final={sqrt_price:quote.next.toString(),attn_raw:a.toString(),quote_raw:b.toString(),marginal_native_per_attn:nextPrice(p.initial.marginal_native_per_attn,BigInt(p.initial.sqrt_price),quote.next)};
        p.fee_totals.total_fee_raw=(BigInt(p.fee_totals.total_fee_raw)+quote.totalFee).toString();p.fee_totals.lp_claiming_fee_raw=(BigInt(p.fee_totals.lp_claiming_fee_raw)+quote.lpClaiming).toString();
        p.fee_totals.protocol_fee_raw=(BigInt(p.fee_totals.protocol_fee_raw)+quote.protocol).toString();p.fee_totals.referral_fee_raw=(BigInt(p.fee_totals.referral_fee_raw)+quote.referral).toString();
      }
    }
    const charged=status==="simulated"&&quote.status==="quoted"?quote:null;
    return {index,pool:trade.pool,direction:trade.direction,status,before,after:structuredClone(p.final),gross_input_raw:trade.gross_input_raw,trader_debit_raw:charged?trade.gross_input_raw:"0",trader_output_raw:charged?charged.traderOutput.toString():"0",minimum_output_raw:trade.minimum_output_raw,fees_on_input:!aForB,
      net_input_raw:charged?charged.netInput.toString():"0",curve_output_raw:charged?charged.curveOutput.toString():"0",total_fee_raw:charged?charged.totalFee.toString():"0",lp_claiming_fee_raw:charged?charged.lpClaiming.toString():"0",protocol_fee_raw:charged?charged.protocol.toString():"0",referral_fee_raw:charged?charged.referral.toString():"0"};
  });
  for(const p of pools){const l=BigInt(p.liquidity_q64),s=BigInt(p.final.sqrt_price),q=amountB(s,BigInt(p.sqrt_max),l,true),a=amountA(BigInt(p.sqrt_min),s,l,true);p.remaining_net_quote_to_upper_raw=(q>U64_MAX?U64_MAX:q).toString();p.remaining_net_attn_to_lower_raw=(a>U64_MAX?U64_MAX:a).toString();}
  return FeeLaunchResult.parse({...seed,version:input.version,math_revision:FEE_MATH_REVISION,scope:"concentrated_liquidity_static_only_quote_exact_input",fees_modeled:true,program_execution_verified:false,pools,steps,
    gaps:["hypothetical_prices_and_trader_inventory","static_only_quote_fee_math_not_deployable_configuration","dynamic_opening_fees_rate_limiters_and_compounding_not_modeled","transfer_extensions_gas_activation_and_funded_routes_not_certified","fee_beneficiaries_and_claim_rights_unverified","fee_totals_are_modeled_accruals_not_vault_balances_or_founder_income","pool_creation_and_locks_not_verified","same_chain_10x_issuance_and_viability_unverified","no_transaction_simulation_or_signer","D08_D09_D10_D14_D15_D16_open"]});
}
export function feeExampleFromNet(net:z.infer<typeof LaunchScenario>):FeeLaunchInput{
  const {version:_v,pools,trades,...base}=net,fees={collect_fee_mode:"only_quote",fee_version:1,base_fee_schedule:"static",dynamic_fee_enabled:false,fee_numerator:"10000000",protocol_fee_percent:20,referral_fee_percent:20,compounding_fee_bps:0};
  return FeeLaunchScenario.parse({...base,version:"launch-fee-lab-v2",pools:{native:{...pools.native,fees},og:{...pools.og,fees},tenx:{...pools.tenx,fees}},trades:[...trades.map((t,i)=>({pool:t.pool,direction:t.direction,gross_input_raw:t.net_input_raw,minimum_output_raw:"0",has_referral:i===1})),{pool:"native",direction:"quote_to_attn",gross_input_raw:"1000000000",minimum_output_raw:"18446744073709551615",has_referral:false}]});
}
