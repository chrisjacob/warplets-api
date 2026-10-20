import type {z} from "zod";
import {FeeLaunchScenario,RouteLaunchScenario,RouteLaunchResult,ROUTE_MATH_REVISION,type FeeLaunchInput,type LaunchResult,type LaunchBalances,type LaunchActionResult,type RouteLaunchInput} from "./launch-model";
import {evaluateFeeLaunch} from "./launch-fees";
import {U64_MAX} from "./launch-curve";

export function routeFeeScenario(input:RouteLaunchInput):FeeLaunchInput {
  const {version:_version,traders:_traders,actions:_actions,...base}=input;
  return FeeLaunchScenario.parse({...base,version:"launch-fee-lab-v2",trades:[]});
}

// Reuse the frozen v2 evaluator. Only a wholly accepted action advances its trace.
// At most twelve actions/twenty-four legs; no RPC, credit, external conversion or signer.
export function evaluateRouteLaunch(raw:unknown,seed:z.infer<typeof LaunchResult>) {
  const input=RouteLaunchScenario.parse(raw),base=routeFeeScenario(input);
  const traders=input.traders.map(t=>({id:t.id,initial:structuredClone(t.balances) as z.infer<typeof LaunchBalances>,final:structuredClone(t.balances) as z.infer<typeof LaunchBalances>}));
  let accepted:FeeLaunchInput["trades"]=[],state=evaluateFeeLaunch(base,seed);
  const actions=input.actions.map((a,index):z.infer<typeof LaunchActionResult>=>{
    const trader=traders.find(t=>t.id===a.trader)!,before=structuredClone(trader.final),isRoute=a.kind==="route";
    const inputAsset=isRoute?a.from_pool:a.direction==="quote_to_attn"?a.pool:"attn";
    const outputAsset=isRoute?a.to_pool:a.direction==="quote_to_attn"?"attn":a.pool;
    let status:z.infer<typeof LaunchActionResult>["status"]="insufficient_balance",rejected:number|null=null;
    let debit="0",receipt="0",legStatuses:z.infer<typeof LaunchActionResult>["attempted_leg_statuses"]=[],committed:number[]=[];
    if(BigInt(before[inputAsset])>=BigInt(a.gross_input_raw)) {
      const first:FeeLaunchInput["trades"][number]=isRoute?{pool:a.from_pool,direction:"quote_to_attn",gross_input_raw:a.gross_input_raw,minimum_output_raw:a.minimum_attn_raw,has_referral:a.has_referral}
        :{pool:a.pool,direction:a.direction,gross_input_raw:a.gross_input_raw,minimum_output_raw:a.minimum_output_raw,has_referral:a.has_referral};
      let proposed=[...accepted,first],candidate=evaluateFeeLaunch({...base,trades:proposed},seed),leg=candidate.steps.at(-1)!;
      legStatuses.push(leg.status);status=leg.status;
      if(status!=="simulated")rejected=0;
      else if(isRoute) {
        // Feed this action's actual net first receipt, never an assumed amount or prior ATTN balance.
        proposed=[...proposed,{pool:a.to_pool,direction:"attn_to_quote",gross_input_raw:leg.trader_output_raw,minimum_output_raw:a.minimum_output_raw,has_referral:a.has_referral}];
        candidate=evaluateFeeLaunch({...base,trades:proposed},seed);leg=candidate.steps.at(-1)!;
        legStatuses.push(leg.status);status=leg.status;if(status!=="simulated")rejected=1;
      }
      if(status==="simulated") {
        const nextOutput=BigInt(before[outputAsset])+BigInt(leg.trader_output_raw);
        if(nextOutput>U64_MAX)status="trader_u64_bound";
        else {
          debit=a.gross_input_raw;receipt=leg.trader_output_raw;
          trader.final[inputAsset]=(BigInt(before[inputAsset])-BigInt(debit)).toString();trader.final[outputAsset]=nextOutput.toString();
          committed=proposed.slice(accepted.length).map((_,i)=>accepted.length+i);accepted=proposed;state=candidate;
        }
      }
    }
    return {index,kind:a.kind,trader:a.trader,status,input_asset:inputAsset,output_asset:outputAsset,requested_input_raw:a.gross_input_raw,trader_debit_raw:debit,trader_output_raw:receipt,minimum_output_raw:a.minimum_output_raw,
      before_balances:before,after_balances:structuredClone(trader.final),attempted_leg_statuses:legStatuses,rejected_leg_index:rejected,committed_step_indexes:committed};
  });
  return RouteLaunchResult.parse({...state,version:input.version,math_revision:ROUTE_MATH_REVISION,scope:"hypothetical_funded_static_quote_routes",route_execution_verified:false,traders,actions,
    gaps:["hypothetical_opening_prices_and_trader_quote_balances","atomic_route_rollback_is_a_model_not_verified_program_execution","ordered_actions_not_a_mempool_or_priority_fee_model",...state.gaps.filter(g=>g!=="hypothetical_prices_and_trader_inventory")]});
}

export function routeExampleFromFees(fee:FeeLaunchInput,race=true):RouteLaunchInput {
  const {version:_v,trades:_t,...base}=fee,swap=(trader:string,pool:"native"|"og"|"tenx",gross:string,minimum="0")=>({kind:"swap" as const,trader,pool,direction:"quote_to_attn" as const,gross_input_raw:gross,minimum_output_raw:minimum,has_referral:false});
  return RouteLaunchScenario.parse({...base,version:"launch-route-lab-v3",
    traders:[{id:"early_holder",balances:{attn:"0",native:"1000000000000",og:"1000000000000",tenx:"0"}},{id:"competitor",balances:{attn:"0",native:"100000000000000",og:"0",tenx:"1000000000000"}}],
    actions:[
      {kind:"route",trader:"early_holder",from_pool:"tenx",to_pool:"og",gross_input_raw:"1000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:false},
      {kind:"route",trader:"competitor",from_pool:"native",to_pool:"og",gross_input_raw:"1000000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:false},
      swap("early_holder","og","1000000000000"),
      {kind:"route",trader:"competitor",from_pool:"native",to_pool:"og",gross_input_raw:"500000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:true},
      ...(race?[swap("competitor","native","50000000000000")]:[]),
      swap("early_holder","native","1000000000000","950000000000"),
      swap("competitor","tenx","1000000000000"),
      {kind:"route",trader:"competitor",from_pool:"native",to_pool:"tenx",gross_input_raw:"500000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:false},
    ]});
}
