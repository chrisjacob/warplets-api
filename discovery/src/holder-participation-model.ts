import {z} from "zod";
import {Address} from "./model";
import {hashJson} from "./solana";

export const HOLDER_PARTICIPATION_POLICY={version:"holder-participation-policy-v1",minimum_quote_raw:"10000000",quote_unit:"SOL_or_WSOL_1e9",
  minimum_retention_seconds:1800,endpoint_retention:"entire_sampled_net_acquisition",retention_clock:"latest_buy_to_collector_endpoint",
  inventory_fresh_seconds:1800,wallet_fresh_seconds:3600,link_screen:"creator_fee_payer_transaction_direct_and_second_hop_sample",
  coverage:"bounded_sample_not_population",scoring_effect:"none"} as const;
export const HOLDER_PARTITIONS=["no_sampled_buy","missing_finalized_history","sampled_sell","unknown_quote","mixed_net_flow","insufficient_endpoint_balance","observed_creator_or_link","below_native_size","retention_not_mature","supported"] as const;
const Count=z.number().int().min(0).max(5000),Hash=z.string().regex(/^[a-f0-9]{64}$/),Time=z.string().datetime();
export const HolderParticipationInterval=z.object({status:z.enum(["measured_sample","held"]),start_at:Time,end_at:Time,start_hash:Hash,end_hash:Hash,
  raw_entrants:Count.nullable(),signed_net_buy_entrants:Count.nullable(),screened_retained_entrants:Count.nullable(),
  partitions:z.record(z.enum(HOLDER_PARTITIONS),Count).nullable(),gaps:z.array(z.string().max(100)).max(20)
}).strict().refine(r=>(Date.parse(r.end_at)>Date.parse(r.start_at)||r.status==="held"&&r.end_at===r.start_at)&&(r.status==="held"?
  r.signed_net_buy_entrants===null&&r.screened_retained_entrants===null&&r.partitions===null:
  r.raw_entrants!==null&&r.signed_net_buy_entrants!==null&&r.screened_retained_entrants!==null&&r.partitions!==null&&
  Object.values(r.partitions).reduce((a,b)=>a+b,0)===r.raw_entrants&&r.partitions.supported===r.screened_retained_entrants&&
  r.signed_net_buy_entrants===r.partitions.observed_creator_or_link+r.partitions.below_native_size+r.partitions.retention_not_mature+r.partitions.supported),"holder_participation_partition_mismatch");
export const HolderParticipation=z.object({version:z.literal("holder-participation-v1"),address:Address,cutoff_at:Time,state:z.enum(["available","missing","rejected","simulation"]),
  policy:z.literal(HOLDER_PARTICIPATION_POLICY.version),policy_hash:Hash,history_hash:Hash.nullable(),acquisition_hash:Hash.nullable(),input_hash:Hash.nullable(),
  wallet_hash:Hash.nullable(),wallet_observed_at:Time.nullable(),latest_inventory_at:Time.nullable(),freshness:z.enum(["fresh","stale","unknown"]),
  since_first:HolderParticipationInterval.nullable(),recent:HolderParticipationInterval.nullable(),inventory_hashes:z.array(Hash).max(3),gaps:z.array(z.string().max(100)).max(24),
  meaningful_holder_growth_24h:z.null(),beneficial_independence_verified:z.literal(false),continuous_retention_verified:z.literal(false),organic_demand_certified:z.literal(false),
  population_trade_coverage:z.literal("unknown"),scoring_effect:z.literal("none"),evidence_gates_changed:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),report_hash:Hash
}).strict().refine(r=>{
  if(r.state!=="available")return !r.since_first&&!r.recent&&!r.history_hash&&!r.acquisition_hash&&!r.input_hash&&!r.wallet_hash&&r.inventory_hashes.length===0&&r.freshness==="unknown";
  if(!r.history_hash||!r.acquisition_hash||!r.input_hash)return false;
  if([r.wallet_observed_at,r.latest_inventory_at,r.since_first?.end_at,r.recent?.end_at].some(t=>t&&Date.parse(t)>Date.parse(r.cutoff_at)))return false;
  if([r.since_first,r.recent].some(p=>p&&(!r.inventory_hashes.includes(p.start_hash)||!r.inventory_hashes.includes(p.end_hash))))return false;
  if(r.freshness==="fresh"&&(!r.wallet_observed_at||!r.latest_inventory_at||Date.parse(r.cutoff_at)-Date.parse(r.wallet_observed_at)>HOLDER_PARTICIPATION_POLICY.wallet_fresh_seconds*1000||Date.parse(r.cutoff_at)-Date.parse(r.latest_inventory_at)>HOLDER_PARTICIPATION_POLICY.inventory_fresh_seconds*1000))return false;
  return true;
},"holder_participation_inconsistent");
export type HolderParticipation=z.infer<typeof HolderParticipation>;
export type HolderParticipationInterval=z.infer<typeof HolderParticipationInterval>;
export async function freezeHolderParticipation(payload:Omit<HolderParticipation,"report_hash">){const parsed=HolderParticipation.parse({...payload,report_hash:"0".repeat(64)}),{report_hash:_,...body}=parsed;return HolderParticipation.parse({...body,report_hash:await hashJson(body)});}
export async function verifyHolderParticipation(raw:unknown){const report=HolderParticipation.parse(raw),{report_hash,...body}=report;if(await hashJson(body)!==report_hash||report.policy_hash!==await hashJson(HOLDER_PARTICIPATION_POLICY))throw Error("holder_participation_hash_or_policy_mismatch");return report;}
