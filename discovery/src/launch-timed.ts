import type {z} from "zod";
import {OpeningFeeConfig,TimedLaunchScenario,TimedLaunchResult,FeeLaunchScenario,TIMED_MATH_REVISION,type LaunchResult,type FeeLaunchInput,type TimedLaunchInput,type TimedLaunchActionResult,type TimedLaunchStep,type RouteLaunchInput} from "./launch-model";
import {evaluateFeeLaunch} from "./launch-fees";
import {U64_MAX} from "./launch-curve";

// Pinned SDK 1.5.1 feeTimeScheduler.ts / feeScheduler.ts, MIT (Meteora, 2026).
// License: ../protocol/meteora-MIT-LICENSE.txt. No exponential/volatility scheduler.
// SDK quote math returns the terminal fee before activation; that is NOT trading permission.
export function openingFeeAt(raw:z.infer<typeof OpeningFeeConfig>,point:bigint,activation:bigint):bigint {
  const f=OpeningFeeConfig.parse(raw),period=point<activation?BigInt(f.number_of_periods):(point-activation)/BigInt(f.period_frequency);
  const bounded=period>BigInt(f.number_of_periods)?BigInt(f.number_of_periods):period;
  return BigInt(f.cliff_fee_numerator)-bounded*BigInt(f.reduction_factor);
}
export function timedFeeScenario(input:TimedLaunchInput,point=BigInt(input.activation_point)):FeeLaunchInput {
  const {version:_v,traders:_t,actions:_a,activation_point:_p,activation_type:_type,pools,...base}=input;
  const pool=(p:TimedLaunchInput["pools"]["native"])=>{
    const {cliff_fee_numerator:_c,number_of_periods:_n,period_frequency:_f,reduction_factor:_r,base_fee_schedule:_s,...fees}=p.fees;
    return {...p,fees:{...fees,base_fee_schedule:"static",fee_numerator:openingFeeAt(p.fees,point,BigInt(input.activation_point)).toString()}};
  };
  return FeeLaunchScenario.parse({...base,version:"launch-fee-lab-v2",pools:{native:pool(pools.native),og:pool(pools.og),tenx:pool(pools.tenx)},trades:[]});
}

export function evaluateTimedLaunch(raw:unknown,seed:z.infer<typeof LaunchResult>) {
  const input=TimedLaunchScenario.parse(raw),traders=input.traders.map(t=>({id:t.id,initial:structuredClone(t.balances),final:structuredClone(t.balances) as z.infer<typeof TimedLaunchActionResult>["after_balances"]}));
  let state=evaluateFeeLaunch(timedFeeScenario(input),seed);
  const steps:z.infer<typeof TimedLaunchStep>[]=[],actions=input.actions.map(({point,action:a},index):z.infer<typeof TimedLaunchActionResult>=>{
    const trader=traders.find(t=>t.id===a.trader)!,before=structuredClone(trader.final),route=a.kind==="route";
    const from=route?a.from_pool:a.direction==="quote_to_attn"?a.pool:"attn",to=route?a.to_pool:a.direction==="quote_to_attn"?"attn":a.pool;
    const result:z.infer<typeof TimedLaunchActionResult>={index,point,kind:a.kind,trader:a.trader,status:"not_active",input_asset:from,output_asset:to,requested_input_raw:a.gross_input_raw,trader_debit_raw:"0",trader_output_raw:"0",minimum_output_raw:a.minimum_output_raw,before_balances:before,after_balances:structuredClone(before),attempted_leg_statuses:[],rejected_leg_index:null,committed_step_indexes:[],attempted_fees:[]};
    if(BigInt(point)<BigInt(input.activation_point))return result;
    if(BigInt(before[from])<BigInt(a.gross_input_raw))return {...result,status:"insufficient_balance"};
    const feeBase=timedFeeScenario(input,BigInt(point));let candidate=structuredClone(state);
    const pending:z.infer<typeof TimedLaunchStep>[]=[];
    function leg(trade:FeeLaunchInput["trades"][number]) {
      // Quote exactly one leg against current principal. Never reprice prior legs at the new fee.
      const currentSeed={...seed,pools:candidate.pools.map(({fees:_f,fee_totals:_t,...p})=>({...p,initial:structuredClone(p.final)}))};
      const one=evaluateFeeLaunch({...feeBase,trades:[trade]},currentSeed),step={...one.steps[0]!,index:steps.length+pending.length,point,effective_fee_numerator:feeBase.pools[trade.pool].fees.fee_numerator};
      result.attempted_leg_statuses.push(step.status);result.attempted_fees.push({pool:trade.pool,fee_numerator:step.effective_fee_numerator});
      if(step.status==="simulated"){
        candidate.pools=candidate.pools.map((p,i)=>{const next=one.pools[i]!,totals={...p.fee_totals};for(const key of Object.keys(totals) as (keyof typeof totals)[])totals[key]=(BigInt(totals[key])+BigInt(next.fee_totals[key])).toString();
          return {...p,final:next.final,fee_totals:totals,remaining_net_quote_to_upper_raw:next.remaining_net_quote_to_upper_raw,remaining_net_attn_to_lower_raw:next.remaining_net_attn_to_lower_raw};});
        pending.push(step);
      }
      return step;
    }
    let quoted=leg(route?{pool:a.from_pool,direction:"quote_to_attn",gross_input_raw:a.gross_input_raw,minimum_output_raw:a.minimum_attn_raw,has_referral:a.has_referral}
      :{pool:a.pool,direction:a.direction,gross_input_raw:a.gross_input_raw,minimum_output_raw:a.minimum_output_raw,has_referral:a.has_referral});
    result.status=quoted.status;if(quoted.status!=="simulated")return {...result,rejected_leg_index:0};
    if(route){quoted=leg({pool:a.to_pool,direction:"attn_to_quote",gross_input_raw:quoted.trader_output_raw,minimum_output_raw:a.minimum_output_raw,has_referral:a.has_referral});result.status=quoted.status;if(quoted.status!=="simulated")return {...result,rejected_leg_index:1};}
    const output=BigInt(before[to])+BigInt(quoted.trader_output_raw);if(output>U64_MAX)return {...result,status:"trader_u64_bound"};
    trader.final[from]=(BigInt(before[from])-BigInt(a.gross_input_raw)).toString();trader.final[to]=output.toString();
    state=candidate;steps.push(...pending);
    return {...result,trader_debit_raw:a.gross_input_raw,trader_output_raw:quoted.trader_output_raw,after_balances:structuredClone(trader.final),committed_step_indexes:pending.map(p=>p.index)};
  });
  return TimedLaunchResult.parse({...state,version:input.version,math_revision:TIMED_MATH_REVISION,scope:"hypothetical_funded_linear_opening_fees",activation_type:input.activation_type,activation_point:input.activation_point,activation_verified:false,route_execution_verified:false,
    pools:state.pools.map(p=>({...p,fees:input.pools[p.pool].fees})),steps,traders,actions,
    gaps:["hypothetical_prices_inventory_timestamps_and_linear_fee_parameters","preactivation_rejection_is_a_model_guard_not_verified_program_access","linear_time_fee_math_only_not_deployable_pool_configuration","volatility_dynamic_exponential_marketcap_and_rate_limiters_not_modeled","atomic_route_rollback_not_verified_execution","gas_transfer_extensions_and_actual_activation_unverified","fee_totals_are_accruals_not_vault_balances_or_entitlements","pool_creation_locks_and_claim_rights_unverified","same_chain_10x_issuance_and_viability_unverified","no_transaction_simulation_or_signer","D08_D09_D10_D14_D15_D16_open"]});
}

export function timedExampleFromRoutes(route:RouteLaunchInput):TimedLaunchInput {
  const {version:_v,pools,actions:_a,...base}=route,activation=1800000000n;
  const pool=(p:RouteLaunchInput["pools"]["native"])=>{const {fee_numerator:_f,base_fee_schedule:_s,...fees}=p.fees;return {...p,fees:{...fees,base_fee_schedule:"linear_time",cliff_fee_numerator:"500000000",number_of_periods:4,period_frequency:"60",reduction_factor:"122500000"}};};
  const buy={kind:"swap" as const,trader:"early_holder",pool:"native" as const,direction:"quote_to_attn" as const,gross_input_raw:"100000000000",minimum_output_raw:"90000000000",has_referral:false};
  const at=(offset:bigint,action:RouteLaunchInput["actions"][number])=>({point:(activation+offset).toString(),action});
  return TimedLaunchScenario.parse({...base,version:"launch-timed-lab-v5",activation_type:"timestamp",activation_point:activation.toString(),pools:{native:pool(pools.native),og:pool(pools.og),tenx:pool(pools.tenx)},actions:[
    at(-1n,buy),at(0n,buy),at(59n,{...buy,minimum_output_raw:"0"}),at(60n,{...buy,minimum_output_raw:"0"}),
    at(240n,buy),at(240n,route.actions[2]!),at(240n,{kind:"route",trader:"competitor",from_pool:"native",to_pool:"og",gross_input_raw:"100000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:true}),
  ]});
}
