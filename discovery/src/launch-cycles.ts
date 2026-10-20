import type {z} from "zod";
import {CYCLE_MATH_REVISION,CycleLaunchScenario,CycleLaunchResult,RouteLaunchScenario,type CycleLaunchInput,type RouteLaunchInput,type LaunchResult,type CycleProbeResult} from "./launch-model";
import {evaluateRouteLaunch} from "./launch-routes";
import {ceilDiv,U64_MAX} from "./launch-curve";

export function cycleRouteScenario(input:CycleLaunchInput):RouteLaunchInput {
  const {version:_v,probes:_p,...base}=input;
  return RouteLaunchScenario.parse({...base,version:"launch-route-lab-v3"});
}
function gcd(a:bigint,b:bigint):bigint {a=a<0n?-a:a;while(b){const r=a%b;a=b;b=r;}return a;}

// Every probe forks the same funded baseline. It never advances that state or another probe.
// The external CP venue is an explicit toy assumption, not a Meteora/DEX adapter.
export function evaluateCycleLaunch(raw:unknown,seed:z.infer<typeof LaunchResult>) {
  const input=CycleLaunchScenario.parse(raw),base=cycleRouteScenario(input),baseline=evaluateRouteLaunch(base,seed);
  const probes=input.probes.map((p):z.infer<typeof CycleProbeResult>=>{
    const a=p.route,before=structuredClone(baseline.traders.find(t=>t.id===a.trader)!.final);
    const result:z.infer<typeof CycleProbeResult>={id:p.id,trader:a.trader,from_pool:a.from_pool,to_pool:a.to_pool,status:"route_rejected",route_status:null,
      requested_input_raw:a.gross_input_raw,intermediate_attn_raw:"0",route_output_raw:"0",projected_route_fees:[],external:p.external,external_fee_raw:"0",external_net_input_raw:"0",cycle_output_raw:"0",
      minimum_cycle_output_raw:p.minimum_cycle_output_raw,network_cost_native_raw:p.network_cost_native_raw,minimum_profit_native_raw:p.minimum_profit_native_raw,
      profit_native:null,profit_native_floor_raw:null,before_balances:before,projected_balances:null};
    const gas=BigInt(p.network_cost_native_raw),gross=BigInt(a.gross_input_raw);
    if(BigInt(before.native)<gas+(a.from_pool==="native"?gross:0n))return {...result,status:"insufficient_network_balance"};
    const fork=evaluateRouteLaunch({...base,actions:[...base.actions,a]},seed),route=fork.actions.at(-1)!;
    result.route_status=route.status;
    if(route.status!=="simulated")return result;
    const legs=route.committed_step_indexes.map(i=>fork.steps[i]!);
    result.intermediate_attn_raw=legs[0]!.trader_output_raw;result.route_output_raw=route.trader_output_raw;
    result.projected_route_fees=legs.map(l=>({pool:l.pool,total_fee_raw:l.total_fee_raw}));
    const amount=BigInt(route.trader_output_raw),fee=ceilDiv(amount*BigInt(p.external.fee_bps),10000n),net=amount-fee;
    result.external_fee_raw=fee.toString();result.external_net_input_raw=net.toString();
    if(net===0n)return {...result,status:"external_fee_consumes_input"};
    const reserveIn=BigInt(p.external.reserve_input_raw),reserveOut=BigInt(p.external.reserve_output_raw);
    // Input fees stay in the modeled external reserve. Output is rounded down.
    if(reserveIn+amount>U64_MAX)return {...result,status:"external_u64_bound"};
    const output=net*reserveOut/(reserveIn+net);result.cycle_output_raw=output.toString();
    if(output===0n)return {...result,status:"external_zero_output"};
    const quote=input.pools[a.from_pool],den=BigInt(quote.quote_native.denominator)*10n**BigInt(quote.quote_decimals);
    const numerator=(output-gross)*BigInt(quote.quote_native.numerator)*1000000000n-gas*den,g=gcd(numerator,den);
    result.profit_native={numerator:(numerator/g).toString(),denominator:(den/g).toString()};
    // Floor negative fractions too: truncating toward zero would understate a loss.
    result.profit_native_floor_raw=(numerator>=0n?numerator/den:-ceilDiv(-numerator,den)).toString();
    if(output<BigInt(p.minimum_cycle_output_raw))return {...result,status:"cycle_minimum_not_met"};
    if(numerator<BigInt(p.minimum_profit_native_raw)*den)return {...result,status:"profit_minimum_not_met"};
    const projected=structuredClone(before);
    const next=BigInt(projected[a.from_pool])-gross+output-(a.from_pool==="native"?gas:0n);
    if(next>U64_MAX)return {...result,status:"trader_u64_bound"};
    projected[a.from_pool]=next.toString();if(a.from_pool!=="native")projected.native=(BigInt(before.native)-gas).toString();
    return {...result,status:"quote_passed",projected_balances:projected};
  });
  return CycleLaunchResult.parse({...baseline,version:input.version,math_revision:CYCLE_MATH_REVISION,scope:"independent_hypothetical_closed_cycle_quotes",
    probes_apply:false,external_execution_verified:false,probes,
    gaps:["independent_probes_do_not_advance_inventory_or_charge_costs","external_constant_product_reserves_and_fees_are_hypothetical","network_cost_and_quote_native_profit_conversion_are_assumed",...baseline.gaps]});
}

export function cycleExampleFromRoutes(route:RouteLaunchInput):CycleLaunchInput {
  const action={kind:"route" as const,trader:"competitor",from_pool:"native" as const,to_pool:"og" as const,gross_input_raw:"100000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:false};
  const probe=(id:string,out:string,input="1000000000000000",gas="5000000")=>({id,route:action,
    external:{model:"hypothetical_constant_product" as const,reserve_input_raw:input,reserve_output_raw:out,fee_bps:30},network_cost_native_raw:gas,minimum_cycle_output_raw:"0",minimum_profit_native_raw:"0"});
  return CycleLaunchScenario.parse({...route,version:"launch-cycle-lab-v4",actions:[route.actions[2]!],probes:[
    probe("unit_rate","1000000000000000"),probe("og_rate_rises","1500000000000000"),probe("og_rate_falls","500000000000000"),
    probe("thin_external_depth","150000000000","100000000000"),probe("high_network_cost","1500000000000000","1000000000000000","100000000000"),
  ]});
}
