import { z } from "zod";

export const RewardRaw = z.string().regex(/^(0|[1-9]\d*)$/).max(20).refine(v => /^(0|[1-9]\d*)$/.test(v) && v.length <= 20 && BigInt(v) <= 18446744073709551615n, "Requires an unsigned u64 integer");
const Alias = z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/);
export const RewardScenario = z.object({
  version: z.literal("attention-lab-v1"), as_of: z.iso.datetime(),
  combined_cap_bps: z.number().int().min(10000).max(50000), bonus_pool_bps: z.number().int().min(0).max(10000),
  spotlight_id: z.uuid().nullable(),
  campaigns: z.array(z.object({ id: z.uuid(), asset: z.string().regex(/^SIM-[A-Z0-9-]{1,24}$/), starts_at: z.iso.datetime(), supply_raw: RewardRaw, decimals: z.number().int().min(0).max(9), daily_weights_bps: z.array(z.number().int().min(0).max(10000)).length(10) }).strict()).min(1).max(10),
  scores: z.array(z.object({ campaign_id: z.uuid(), day: z.number().int().min(0).max(9), participant: Alias, raw_points: RewardRaw.nullable(), raw_observed_at: z.iso.datetime().nullable(), boost_bps: z.number().int().min(10000).max(50000).nullable(), boost_observed_at: z.iso.datetime().nullable(), disposition: z.enum(["included", "quarantined", "rejected"]) }).strict()).max(80),
}).strict();
export const RewardRequest = z.object({ request_id: z.uuid(), reason: z.string().min(3).max(300), scenario: RewardScenario }).strict();
const Amount = z.string().regex(/^(0|[1-9]\d*)$/).max(24);
export const RewardPeriod = z.object({
  day: z.number().int().min(0).max(9), starts_at: z.iso.datetime(), ends_at: z.iso.datetime(), tranche_raw: Amount,
  status: z.enum(["scheduled", "raw_evidence_gap", "boost_evidence_gap", "no_eligible_points", "projected"]),
  included: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(), option_a_raw: Amount, option_b_raw: Amount, unallocated_a_raw: Amount, unallocated_b_raw: Amount,
  participants: z.array(z.object({ participant: Alias, rank: z.number().int().positive().nullable(), raw_points: RewardRaw.nullable(), effective_boost_bps: z.number().int().nullable(), base_b_raw: Amount, option_a_raw: Amount, option_b_raw: Amount, reasons: z.array(z.string()).max(5) }).strict()).max(80),
}).strict();
export const RewardCampaignResult = z.object({ id: z.uuid(), asset: z.string(), decimals: z.number().int(), starts_at: z.iso.datetime(), ends_at: z.iso.datetime(), state: z.enum(["future", "active", "past"]), supply_raw: Amount, reserve_raw: Amount, schedule_dust_raw: Amount, option_a_raw: Amount, option_b_raw: Amount, periods: z.array(RewardPeriod).length(10) }).strict();
export const RewardResult = z.object({ version: z.literal("attention-lab-v1"), as_of: z.iso.datetime(), source: z.literal("hypothetical_operator_inputs"), max_overlap: z.number().int().min(1).max(10), active_campaigns: z.number().int().min(0).max(10), spotlight_id: z.uuid().nullable(), combined_cap_bps: z.number().int(), bonus_pool_bps: z.number().int(), policy_approved: z.literal(false), claims_enabled: z.literal(false), transfers_enabled: z.literal(false), provider_requests: z.literal(0), campaigns: z.array(RewardCampaignResult).min(1).max(10) }).strict();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const RewardRecord = z.object({ id: z.uuid(), created_at: z.iso.datetime(), reason: z.string().min(3).max(300), request_hash: Hash, input_hash: Hash, result_hash: Hash, record_hash: Hash, inputs: RewardScenario, result: RewardResult }).strict();
export const RewardSummary = RewardRecord.omit({ inputs: true, result: true, reason: true, request_hash: true, input_hash: true }).extend({ result: RewardResult.extend({ campaigns: z.array(RewardCampaignResult.extend({ periods: z.array(RewardPeriod.omit({ participants: true })).length(10) })).max(10) }) }).strict();
export const RewardList = z.object({ scope: z.literal("local_hypothetical_attention_lab"), runs: z.array(RewardSummary).max(5) }).strict();
export type Scenario = z.infer<typeof RewardScenario>;
