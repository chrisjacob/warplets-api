import {z} from "zod";
import {Address} from "./model";

// Fixed before any outcome review. Descriptive measurements, no learned weights.
export const RECENT_ACTIVITY_POLICY = {
  version:"recent-candle-policy-v1", window_minutes:[5,60,360], previous_minutes:[5,60],
  freshness_seconds:180, maximum_receipt_span_ms:300000,
  missing_minutes:"withhold_whole_interval", price_basis:"first_open_to_last_close",
  volume_basis:"price_consistent_usd_field_all_pairs_present", zero_baseline:"ratio_unknown",
  scope:"provider_token_request_not_canonical_pool", scoring_effect:"none"
} as const;
const Time=z.string().datetime(),Hash=z.string().regex(/^[a-f0-9]{64}$/),Nonnegative=z.number().finite().nonnegative();
export const RecentActivityInterval=z.object({start_at:Time,end_at:Time,minutes:z.union([z.literal(5),z.literal(60),z.literal(360)]),
  status:z.enum(["complete","partial","held"]),observed_minutes:z.number().int().min(0).max(360),
  price_change_pct:z.number().finite().nullable(),reported_volume_usd:Nonnegative.nullable(),
  positive_volume_minutes:z.number().int().min(0).max(360).nullable(),gaps:z.array(z.string().max(100)).max(16)
}).strict().refine(r=>Date.parse(r.end_at)-Date.parse(r.start_at)===r.minutes*60000&&r.observed_minutes<=r.minutes&&
  (r.status==="complete"?r.observed_minutes===r.minutes:[r.price_change_pct,r.reported_volume_usd,r.positive_volume_minutes].every(v=>v===null))&&
  (r.positive_volume_minutes===null||r.positive_volume_minutes<=r.observed_minutes),"recent_interval_inconsistent");
const Period=z.object({minutes:z.union([z.literal(5),z.literal(60),z.literal(360)]),recent:RecentActivityInterval,
  previous:RecentActivityInterval.nullable(),reported_volume_ratio:Nonnegative.nullable(),gaps:z.array(z.string().max(100)).max(12)
}).strict().refine(r=>r.recent.minutes===r.minutes&&(r.previous===null||r.previous.minutes===r.minutes&&r.previous.end_at===r.recent.start_at)&&
  (r.reported_volume_ratio===null||r.previous?.reported_volume_usd!==null&&r.previous?.reported_volume_usd!==undefined&&r.previous.reported_volume_usd>0&&r.recent.reported_volume_usd!==null&&r.reported_volume_ratio===r.recent.reported_volume_usd/r.previous.reported_volume_usd),"recent_period_inconsistent");
export const RecentActivity=z.object({version:z.literal("recent-candle-activity-v1"),address:Address,cutoff_at:Time,
  state:z.enum(["available","missing","rejected","simulation"]),anchor_at:Time.nullable(),fetched_at:Time.nullable(),
  freshness:z.enum(["fresh","stale","unknown"]),receipt_span_ms:Nonnegative.nullable(),
  policy:z.literal(RECENT_ACTIVITY_POLICY.version),policy_hash:Hash,parent_window_hash:Hash.nullable(),
  usd_field:z.enum(["volume","amount"]).nullable(),periods:z.array(Period).max(3),
  references:z.array(z.object({request_id:z.uuid(),receipt_hash:Hash}).strict()).max(4),gaps:z.array(z.string().max(100)).max(20),
  participant_breadth:z.null(),qualified_attention_momentum:z.null(),organic_demand_certified:z.literal(false),
  canonical_pool_verified:z.literal(false),scoring_effect:z.literal("none"),provider_requests:z.literal(0),database_writes:z.literal(0),report_hash:Hash
}).strict().refine(r=>{
  if(r.state!=="available")return r.periods.length===0&&r.anchor_at===null&&r.parent_window_hash===null;
  if(!r.anchor_at||!r.fetched_at||!r.parent_window_hash||!r.references.length||r.periods.map(p=>p.minutes).join(",")!=="5,60,360")return false;
  if([r.anchor_at,r.fetched_at].some(t=>Date.parse(t)>Date.parse(r.cutoff_at)))return false;
  if(r.periods.some(p=>p.recent.end_at!==r.anchor_at))return false;
  if(r.periods.some(p=>p.minutes===360?p.previous!==null:p.previous===null))return false;
  if(r.usd_field===null&&r.periods.some(p=>[p.recent,p.previous].some(w=>w&&(w.reported_volume_usd!==null||w.positive_volume_minutes!==null))))return false;
  if(r.freshness==="fresh"&&[r.anchor_at,r.fetched_at].some(t=>Date.parse(r.cutoff_at)-Date.parse(t)>RECENT_ACTIVITY_POLICY.freshness_seconds*1000))return false;
  return true;
},"recent_activity_inconsistent");
export type RecentActivity=z.infer<typeof RecentActivity>;
export type RecentActivityInterval=z.infer<typeof RecentActivityInterval>;
