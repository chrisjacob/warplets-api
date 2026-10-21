import {z} from "zod";
import {Address} from "./model";
import {CandidateCardSchema} from "./candidate-card";
import {ActivityObservation,activityRecordKey} from "./activity-observation";
import {hashJson} from "./solana";
import {RecentActivity} from "./recent-activity-model";
import {verifyRecentActivity} from "./recent-activity";

export const ComparisonAddresses=z.array(Address).min(1).max(3).refine(a=>new Set(a).size===a.length,"comparison_duplicate_mints");
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ComparisonRow=z.object({address:Address,state:z.enum(["available","not_found","held"]),candidate:CandidateCardSchema.nullable(),candidate_hash:Hash.nullable(),observations:z.array(ActivityObservation).max(20),gaps:z.array(z.string().max(100)).max(12),recent_activity:RecentActivity.optional()}).strict();
export const DiscoveryComparison=z.object({version:z.literal("discovery-comparison-v1"),cutoff_at:z.string().datetime(),mode:z.enum(["live","fixture"]),addresses:ComparisonAddresses,
  rows:z.array(ComparisonRow).min(1).max(3),report_hash:Hash,alignment:z.literal("shared_read_cutoff_source_windows_differ"),source_authenticity:z.literal("not_independently_verified"),
  scoring_model:z.literal("discovery-score-v4"),activity_scoring_effect:z.literal("none"),evidence_gates_changed:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0)}).strict();
export type DiscoveryComparison=z.infer<typeof DiscoveryComparison>;
// Verify this exact saved projection, not the truth of upstream sources.
export async function verifyDiscoveryComparison(raw:unknown){
  const report=DiscoveryComparison.parse(raw),{report_hash,...payload}=report;
  if(await hashJson(payload)!==report_hash||report.rows.map(r=>r.address).join(",")!==report.addresses.join(","))throw Error("comparison_report_mismatch");
  for(const row of report.rows){
    if(row.recent_activity){const recent=await verifyRecentActivity(row.recent_activity);if(recent.address!==row.address||recent.cutoff_at!==report.cutoff_at||(report.mode==="fixture"?recent.state!=="simulation":recent.state==="simulation"))throw Error("comparison_recent_activity_mismatch");}
    if(row.candidate&&(row.candidate.address!==row.address||row.candidate.mode!==report.mode||row.candidate.discovery_rank!==undefined||row.candidate.discovery_score?.version!=="discovery-score-v4"||row.candidate.discovery_score.as_of!==report.cutoff_at))throw Error("comparison_candidate_mismatch");
    const keys=new Set<string>();
    for(const observation of row.observations){
      if(observation.address!==row.address||observation.cutoff_at!==report.cutoff_at)throw Error("comparison_observation_mismatch");
      const key=await activityRecordKey(observation);if(keys.has(key))throw Error("comparison_duplicate_observation");keys.add(key);
    }
  }
  return report;
}
