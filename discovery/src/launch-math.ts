import { AnyLaunchScenario, LaunchResult, LaunchScenario, LAUNCH_MATH_REVISION, METEORA_REVISION, type LaunchInput } from "./launch-model";
import {evaluateFeeLaunch,feeSeedScenario} from "./launch-fees";
import {evaluateRouteLaunch,routeFeeScenario} from "./launch-routes";
import {evaluateCycleLaunch,cycleRouteScenario} from "./launch-cycles";
import {evaluateTimedLaunch,timedFeeScenario} from "./launch-timed";
import { amountA, amountB, curveSwap, liquidityFromA, LaunchError, MAX_SQRT, MIN_SQRT, Q128, Q64, U128_MAX, U64_MAX } from "./launch-curve";
export { LaunchError } from "./launch-curve";
type Pool = "native" | "og" | "tenx";
const order: Pool[] = ["native", "og", "tenx"];
const allocation = {native:5000n,og:2000n,tenx:2000n};
const quoteAsset = {native:"SIM-SOL" as const,og:"SIM-OG" as const,tenx:"SIM-10X" as const};
function gcd(a:bigint,b:bigint):bigint {while(b){const r=a%b;a=b;b=r;}return a;}
function fraction(n:bigint,d:bigint){const g=gcd(n,d);return {numerator:(n/g).toString(),denominator:(d/g).toString()};}
function fixed(n:bigint,d:bigint){const sign=n<0n?"-":"",v=(n<0n?-n:n)*100000000n/d;return `${sign}${v/100000000n}.${(v%100000000n).toString().padStart(8,"0")}`;}
function price(sqrt:bigint,p:LaunchInput["pools"][Pool],decimals:number){return fraction(sqrt*sqrt*10n**BigInt(decimals)*BigInt(p.quote_native.numerator),Q128*10n**BigInt(p.quote_decimals)*BigInt(p.quote_native.denominator));}
const raw=(n:bigint)=>{if(n<0n||n>U64_MAX)throw new LaunchError("launch_u64_inventory_bound");return n.toString();};
export function evaluateNetLaunch(rawInput:unknown){
  const input=LaunchScenario.parse(rawInput),supply=BigInt(input.supply_raw);
  if(supply%10n!==0n)throw new LaunchError("launch_supply_requires_exact_tenths");
  if(input.pools.native.quote_decimals!==9||input.pools.native.quote_native.numerator!=="1"||input.pools.native.quote_native.denominator!=="1")throw new LaunchError("launch_native_quote_must_be_sol");
  const pools=order.map(pool=>{
    const p=input.pools[pool],lower=BigInt(p.sqrt_min),current=BigInt(p.sqrt_initial),upper=BigInt(p.sqrt_max);
    if(lower<MIN_SQRT||upper>MAX_SQRT||lower>current||current>=upper)throw new LaunchError("launch_sqrt_range_invalid");
    if(pool!=="native"&&current!==lower)throw new LaunchError("launch_og_and_tenx_must_start_attn_only");
    const allocated=supply*allocation[pool]/10000n,liquidity=liquidityFromA(allocated,current,upper);
    if(liquidity<=0n||liquidity>U128_MAX)throw new LaunchError("launch_liquidity_u128_bound");
    const a=amountA(current,upper,liquidity,true),b=amountB(lower,current,liquidity,true);
    if(a>allocated||a===0n)throw new LaunchError("launch_seed_allocation_mismatch");
    const marginal=price(current,p,input.attn_decimals),ref=input.reference_attn_native;
    const delta=BigInt(marginal.numerator)*BigInt(ref.denominator)-BigInt(ref.numerator)*BigInt(marginal.denominator),den=BigInt(marginal.denominator)*BigInt(ref.numerator);
    const initial={sqrt_price:current.toString(),attn_raw:raw(a),quote_raw:raw(b),marginal_native_per_attn:marginal};
    return {pool,quote_asset:quoteAsset[pool],quote_decimals:p.quote_decimals,allocation_bps:Number(allocation[pool]),allocated_attn_raw:raw(allocated),unseeded_attn_raw:raw(allocated-a),liquidity_q64:liquidity.toString(),sqrt_min:lower.toString(),sqrt_max:upper.toString(),initial,final:structuredClone(initial),opening_deviation_bps:fixed(delta*10000n,den),opening_divergence_exceeded:(delta<0n?-delta:delta)*10000n>BigInt(input.max_opening_divergence_bps)*den,remaining_net_quote_to_upper_raw:"0",remaining_net_attn_to_lower_raw:"0"};
  });
  const required=pools[0]!.initial.quote_raw;
  if(BigInt(required)>BigInt(input.native_quote_budget_raw))throw new LaunchError("launch_native_quote_budget_exceeded");
  const steps=input.trades.map((trade,index)=>{
    const p=pools.find(p=>p.pool===trade.pool)!,before=structuredClone(p.final),amount=BigInt(trade.net_input_raw),aForB=trade.direction==="attn_to_quote";
    const swap=curveSwap(BigInt(p.sqrt_min),BigInt(p.sqrt_max),BigInt(before.sqrt_price),BigInt(p.liquidity_q64),amount,aForB);
    let status:"simulated"|"range_exhausted"|"zero_output"|"inventory_or_u64_bound"=swap?swap.output===0n?"zero_output":"simulated":"range_exhausted";
    if(swap&&status==="simulated"){
      const a=BigInt(before.attn_raw)+(aForB?amount:-swap.output),b=BigInt(before.quote_raw)+(aForB?-swap.output:amount);
      if(a<0n||b<0n||a>U64_MAX||b>U64_MAX||swap.output>U64_MAX)status="inventory_or_u64_bound";
      else p.final={sqrt_price:swap.next.toString(),attn_raw:a.toString(),quote_raw:b.toString(),marginal_native_per_attn:price(swap.next,input.pools[p.pool],input.attn_decimals)};
    }
    return {index,pool:trade.pool,direction:trade.direction,net_input_raw:trade.net_input_raw,curve_output_raw:status==="simulated"?swap!.output.toString():"0",status,before,after:structuredClone(p.final)};
  });
  for(const p of pools){
    const l=BigInt(p.liquidity_q64),s=BigInt(p.final.sqrt_price),quote=amountB(s,BigInt(p.sqrt_max),l,true),attn=amountA(BigInt(p.sqrt_min),s,l,true);
    p.remaining_net_quote_to_upper_raw=(quote>U64_MAX?U64_MAX:quote).toString();p.remaining_net_attn_to_lower_raw=(attn>U64_MAX?U64_MAX:attn).toString();
  }
  return LaunchResult.parse({version:input.version,math_revision:LAUNCH_MATH_REVISION,sdk_version:"1.5.1",source_commit:METEORA_REVISION,as_of:input.as_of,source:"hypothetical_operator_inputs",scope:"concentrated_liquidity_net_curve_only",supply_raw:input.supply_raw,attn_decimals:input.attn_decimals,campaign_reserve_raw:raw(supply/10n),native_quote_required_raw:required,native_quote_budget_raw:input.native_quote_budget_raw,pools,steps,launch_enabled:false,transfers_enabled:false,policy_approved:false,fees_modeled:false,locks_verified:false,external_prices_verified:false,provider_requests:0,
    gaps:["hypothetical_prices_and_inventory","net_curve_inputs_after_unmodeled_fees","fee_modes_dynamic_fees_and_transfer_extensions_not_certified","pool_creation_activation_and_locks_not_verified","same_chain_10x_issuance_and_viability_unverified","no_transaction_simulation_or_signer","cross_pool_routes_and_arbitrage_profit_not_certified","D08_D09_D10_D14_D15_D16_open"]});
}
export function exampleLaunch():LaunchInput{
  const q=Q64,range=(lower:bigint,start:bigint,upper:bigint,decimals=9,numerator="1",denominator="1")=>({quote_decimals:decimals,quote_native:{numerator,denominator},sqrt_min:lower.toString(),sqrt_initial:start.toString(),sqrt_max:upper.toString()});
  return LaunchScenario.parse({version:"launch-curve-lab-v1",as_of:new Date().toISOString(),chain:"solana",attn_asset:"SIM-ATTN",attn_decimals:9,supply_raw:"1000000000000000",native_quote_budget_raw:"1000000000000000",reference_attn_native:{numerator:"1",denominator:"1"},max_opening_divergence_bps:100,
    pools:{native:range(q/2n,q,q*2n),og:range(q,q,q*2n,9),tenx:range(q,q,q*2n,9)},
    trades:[{pool:"og",direction:"attn_to_quote",net_input_raw:"1000000000"},{pool:"og",direction:"quote_to_attn",net_input_raw:"1000000000000"},{pool:"og",direction:"attn_to_quote",net_input_raw:"500000000000"},{pool:"tenx",direction:"quote_to_attn",net_input_raw:"1000000000000"},{pool:"native",direction:"quote_to_attn",net_input_raw:"1000000000000"},{pool:"tenx",direction:"quote_to_attn",net_input_raw:"1000000000000000"}]});
}
export function evaluateLaunch(rawInput:unknown){
  const input=AnyLaunchScenario.parse(rawInput);
  if(input.version==="launch-curve-lab-v1")return evaluateNetLaunch(input);
  if(input.version==="launch-timed-lab-v5")return evaluateTimedLaunch(input,evaluateNetLaunch(feeSeedScenario(timedFeeScenario(input))));
  if(input.version==="launch-cycle-lab-v4")return evaluateCycleLaunch(input,evaluateNetLaunch(feeSeedScenario(routeFeeScenario(cycleRouteScenario(input)))));
  if(input.version==="launch-route-lab-v3")return evaluateRouteLaunch(input,evaluateNetLaunch(feeSeedScenario(routeFeeScenario(input))));
  return evaluateFeeLaunch(input,evaluateNetLaunch(feeSeedScenario(input)));
}
