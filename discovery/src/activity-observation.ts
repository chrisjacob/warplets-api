import {z} from "zod";
import {Address} from "./model";
import {hashJson} from "./solana";

const Time=z.string().datetime(),Hash=z.string().regex(/^[a-f0-9]{64}$/),Count=z.number().int().safe().nonnegative();
export const ActivityMetric=z.enum(["pool_reported_volume_24h","token_reported_volume_24h","token_reported_volume_1h","token_reported_holders","candle_window_volume","candle_max_adjacent_move","candle_longest_rising_run","raw_owner_net_change","wallet_reported_buy_usd","wallet_reported_sell_usd","organic_volume_24h","meaningful_holder_growth_24h","attention_momentum"]);
export const ActivityReference=z.object({kind:z.enum(["market_history_snapshot","gmgn_receipt","holder_inventory"]),id:z.string().min(1).max(200),hash:Hash,integrity:z.enum(["archived_hash_verified","content_hash_only"])}).strict();
export const ActivityObservation=z.object({version:z.literal("activity-observation-v1"),chain:z.literal("solana"),address:Address,cutoff_at:Time,
  metric:ActivityMetric,source:z.enum(["dexscreener","geckoterminal","gmgn","solana-finalized-rpc","unavailable","simulation"]),
  scope:z.object({kind:z.enum(["token","pool","wallet","unknown"]),address:Address.nullable(),canonical_pool_verified:z.literal(false)}).strict(),
  value:z.number().finite().nullable(),unit:z.enum(["USD","owners","percent","count","index"]),
  window:z.object({kind:z.enum(["reported_rolling","requested_candles","observed_interval","point","unavailable"]),start_at:Time.nullable(),end_at:Time.nullable(),duration_seconds:z.number().finite().nonnegative().nullable()}).strict(),
  fetched_at:Time.nullable(),provider_observed_at:Time.nullable(),freshness:z.enum(["fresh","stale","unknown"]),
  coverage:z.object({status:z.enum(["reported","complete_requested_window","partial","unknown","unavailable"]),observed:Count.nullable(),expected:Count.nullable(),denominator:z.string().min(1).max(100),denominator_value:z.number().finite().nonnegative().nullable()}).strict(),
  qualification:z.enum(["reported_only","supported_sample","held","missing","rejected"]),references:z.array(ActivityReference).max(8),gaps:z.array(z.string().max(100)).max(48),
  organic_demand_certified:z.literal(false),scoring_effect:z.literal("none")}).strict().refine(r=>{
    if(["held","missing","rejected"].includes(r.qualification)&&r.value!==null)return false;
    if(["organic_volume_24h","meaningful_holder_growth_24h","attention_momentum"].includes(r.metric)&&r.value!==null)return false;
    if(r.window.start_at&&r.window.end_at&&Date.parse(r.window.start_at)>Date.parse(r.window.end_at))return false;
    if(r.value!==null&&[r.fetched_at,r.provider_observed_at,r.window.end_at].some(t=>t!==null&&Date.parse(t)>Date.parse(r.cutoff_at)))return false;
    if(r.freshness==="fresh"&&(!r.fetched_at||Date.parse(r.fetched_at)>Date.parse(r.cutoff_at)))return false;
    return true;
  },"activity_observation_inconsistent");
export type ActivityObservation=z.infer<typeof ActivityObservation>;
export type ActivityRef=z.infer<typeof ActivityReference>;
type Dimensions=Pick<ActivityObservation,"address"|"cutoff_at"|"metric"|"source"|"unit">;
export function activityObservation(base:Dimensions,patch:Partial<Omit<ActivityObservation,keyof Dimensions>>={}):ActivityObservation{
  return ActivityObservation.parse({version:"activity-observation-v1",chain:"solana",...base,
    scope:{kind:"token",address:base.address,canonical_pool_verified:false},value:null,
    window:{kind:"unavailable",start_at:null,end_at:null,duration_seconds:null},fetched_at:null,provider_observed_at:null,freshness:"unknown",
    coverage:{status:"unavailable",observed:null,expected:null,denominator:"unknown",denominator_value:null},qualification:"missing",references:[],gaps:[],organic_demand_certified:false,scoring_effect:"none",...patch});
}
export function activityFreshness(cutoff:string,fetched:string|null,measurementEnd:string|null=null,maximumSeconds=180):ActivityObservation["freshness"]{
  if(!fetched)return "unknown";const dates=[fetched,...measurementEnd?[measurementEnd]:[]].map(Date.parse),at=Date.parse(cutoff);
  return dates.every(t=>t<=at&&at-t<=maximumSeconds*1000)?"fresh":"stale";
}
export async function activityRecordKey(r:ActivityObservation){return hashJson({chain:r.chain,address:r.address,cutoff_at:r.cutoff_at,source:r.source,scope:r.scope,metric:r.metric});}
