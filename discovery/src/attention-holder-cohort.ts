import { z } from "zod";
import { AttentionQueue } from "./attention-queue-model";
import { attentionAddress } from "./attention-feed-contract";
import { CandidateSchema } from "./model";
import { createdWithinWindow } from "./priority";
import { hashJson } from "./solana";

export const ATTENTION_HOLDER_COHORT_POLICY = {
  version: "attention-holder-cohort-policy-v1", scope: "returned_attention_queue_not_market_population",
  chain: "solana", maximum_members: 3, fresh_seconds: 7200, lower_position_starts_at: 11,
  slots: ["attention_lead", "provider_adverse_control", "lower_position_control"],
  selection: "first_matching_original_queue_position_without_replacement_or_fallback",
  holder_snapshot_reference_rpc_ceiling: 4, observations_per_member: 2,
  intake_and_wallet_cost: "unknown", collection_enabled: false, scoring_effect: "none",
  existing_quality_reference: { minimum_liquidity_usd: 25000, minimum_market_cap_usd: 100000, creation_age_hours: 24 },
} as const;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
export async function planAttentionHolderCohort(raw: unknown) {
  if (bytes(raw) > 8_000_000) throw Error("attention_cohort_source_bytes");
  const queue = AttentionQueue.parse(raw), cutoff = Date.parse(queue.as_of), seen = new Set<string>();
  const rows = queue.rows.map((row, index) => {
    const identity = `${row.chain}:${row.address}`;
    if (attentionAddress(row.chain, row.address) !== row.address || seen.has(identity)) throw Error("attention_cohort_identity");
    seen.add(identity); const windows = new Set<string>(), families = new Set<string>();
    for (const source of row.sources) {
      const key = `${source.provider}:${source.window}`, time = Date.parse(source.received_at);
      if (windows.has(key) || time > cutoff || source.fresh !== (time >= cutoff - ATTENTION_HOLDER_COHORT_POLICY.fresh_seconds * 1000)) throw Error("attention_cohort_source_context");
      windows.add(key); if (source.provider !== "dexscreener" && source.fresh) families.add(source.provider);
    }
    if (row.attention_families !== families.size) throw Error("attention_cohort_family_count");
    return { row, position: index + 1, fresh: families.size > 0 };
  });
  const solana = rows.filter(r => r.row.chain === "solana"), fresh = solana.filter(r => r.fresh), selected = new Set<string>();
  const rules = [
    { role: "attention_lead", test: (r: typeof rows[number]) => r.row.checks === "review" },
    { role: "provider_adverse_control", test: (r: typeof rows[number]) => r.row.checks === "adverse" },
    { role: "lower_position_control", test: (r: typeof rows[number]) => r.position >= ATTENTION_HOLDER_COHORT_POLICY.lower_position_starts_at },
  ];
  const slots = [];
  for (const rule of rules) {
    const found = fresh.find(r => !selected.has(r.row.address) && rule.test(r));
    if (found) selected.add(found.row.address);
    slots.push({ role: rule.role, member: found ? { address: found.row.address, position: found.position, symbol: found.row.symbol, checks: found.row.checks } : null,
      gap: found ? null : "no_matching_unselected_member_in_returned_view" });
  }
  const body = { version: "attention-holder-cohort-plan-v1", cutoff_at: queue.as_of, policy_hash: await hashJson(ATTENTION_HOLDER_COHORT_POLICY), source_hash: await hashJson(queue),
    population: { returned: rows.length, solana: solana.length, other_chains: rows.length - solana.length, fresh_solana: fresh.length,
      stale_solana: solana.length - fresh.length, provider_adverse_fresh_solana: fresh.filter(r => r.row.checks === "adverse").length,
      selected: selected.size, unselected_fresh_solana: fresh.length - selected.size, view_truncated: queue.history_truncated, gaps: queue.gaps }, slots,
    selected_addresses: [...selected], source_proof: "saved_queue_projection_not_independent_provider_attestation", provider_requests: 0, database_writes: 0,
    rpc_dispatch_allowed: false, scoring_effect: "none", evidence_gates_changed: false } as const;
  return { queue, plan: { ...body, plan_hash: await hashJson(body) } };
}
export type AttentionHolderCohort = Awaited<ReturnType<typeof planAttentionHolderCohort>>;
const ReadinessRow = z.object({ address: z.string(), candidate_bytes: z.number().int().nonnegative().nullable(), payload: z.string().nullable(), lead_at: z.string().datetime().nullable() }).strict();
export async function readAttentionHolderReadiness(db: D1Database, cohort: AttentionHolderCohort) {
  const verified = await planAttentionHolderCohort(cohort.queue);
  if (JSON.stringify(verified.plan) !== JSON.stringify(cohort.plan)) throw Error("attention_cohort_plan_mismatch");
  if (!cohort.plan.selected_addresses.length) return [];
  const rows = await db.prepare(`WITH wanted AS (SELECT value AS address FROM json_each(?1))
    SELECT w.address,length(CAST(c.payload AS BLOB)) AS candidate_bytes,
      CASE WHEN length(CAST(c.payload AS BLOB))<=1600000 THEN c.payload ELSE NULL END AS payload,l.first_seen_at AS lead_at
    FROM wanted w LEFT JOIN tenx_candidates c ON c.address=w.address AND c.mode='live'
    LEFT JOIN tenx_leads l ON l.address=w.address ORDER BY w.address LIMIT 3`).bind(JSON.stringify(cohort.plan.selected_addresses)).all();
  return z.array(ReadinessRow).max(3).parse(rows.results);
}
export async function assessAttentionHolderCohort(cohort: AttentionHolderCohort, rawRows: unknown) {
  const verified = await planAttentionHolderCohort(cohort.queue);
  if (JSON.stringify(verified.plan) !== JSON.stringify(cohort.plan)) throw Error("attention_cohort_plan_mismatch");
  if (bytes(rawRows) > 4_900_000) throw Error("attention_cohort_readiness_bytes");
  const rows = z.array(ReadinessRow).max(3).parse(rawRows), addresses = cohort.plan.selected_addresses, at = new Date(cohort.plan.cutoff_at);
  if (rows.length !== addresses.length || new Set(rows.map(r => r.address)).size !== rows.length || rows.some(r => !addresses.includes(r.address))) throw Error("attention_cohort_readiness_identity");
  const members = addresses.map(address => {
    const row = rows.find(r => r.address === address)!, gaps: string[] = [];
    let candidate: z.infer<typeof CandidateSchema> | null = null;
    if (row.candidate_bytes === null) { if (row.payload !== null) throw Error("attention_cohort_readiness_projection"); gaps.push("candidate_not_in_saved_inventory"); }
    else if (row.candidate_bytes > 1_600_000) { if (row.payload !== null) throw Error("attention_cohort_readiness_projection"); gaps.push("candidate_exceeds_existing_read_bound"); }
    else if (row.payload === null || new TextEncoder().encode(row.payload).length !== row.candidate_bytes) throw Error("attention_cohort_readiness_projection");
    else try {
      candidate = CandidateSchema.parse(JSON.parse(row.payload));
      if (candidate.address !== address || candidate.mode !== "live") throw Error("identity");
      const times = [candidate.first_seen_at, candidate.checked_at, candidate.risk.observed_at, candidate.creation?.block_time, candidate.graduation?.block_time,
        candidate.market?.fetched_at, candidate.holders?.observed_at, candidate.wallet_analysis?.observed_at];
      if (times.some(t => t && Date.parse(t) > at.getTime())) { candidate = null; gaps.push("latest_candidate_has_observations_after_cutoff"); }
    } catch { candidate = null; gaps.push("candidate_record_unusable"); }
    if (candidate) {
      if (!candidate.creation) gaps.push("creation_reference_missing");
      if (!candidate.graduation) gaps.push("graduation_reference_missing");
      if (!createdWithinWindow(candidate, at)) gaps.push("outside_existing_creation_window");
      if (candidate.verification === "rejected") gaps.push("candidate_rejected");
      if ((candidate.market?.liquidity_usd ?? 0) < ATTENTION_HOLDER_COHORT_POLICY.existing_quality_reference.minimum_liquidity_usd) gaps.push("below_existing_quality_liquidity_screen");
      if (candidate.market?.market_cap_usd != null && candidate.market.market_cap_usd < ATTENTION_HOLDER_COHORT_POLICY.existing_quality_reference.minimum_market_cap_usd) gaps.push("below_existing_quality_market_cap_screen");
    }
    if (!row.lead_at || Date.parse(row.lead_at) > at.getTime()) gaps.push("migration_lead_missing_or_after_cutoff");
    return { address, recorded_quality_fields_match: candidate !== null && gaps.length === 0, gaps,
      source_proof_replayed: false, dispatch_admitted: false, recorded_verification: candidate?.verification ?? null };
  });
  const body = { version: "attention-holder-cohort-readiness-v1", plan_hash: cohort.plan.plan_hash, readiness_input_hash: await hashJson(rows), members,
    cost: { conditional_isolated_holder_snapshot_rpc_ceiling: 4, two_snapshot_reference_rpc_ceiling: addresses.length * 8,
      intake_rpc_cost: null, wallet_followup_rpc_cost: null, total_qualification_rpc_cost: null, free_budget_admitted: false },
    limitations: ["recorded_fields_not_independent_migration_proof", "current_quality_top_ten_selection_not_reproduced", "shared_usage_backoff_and_leases_not_reserved", "native_minimum_and_retention_policy_unchanged", "personal_familiarity_and_meme_relevance_unknown"],
    provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false, rpc_dispatch_allowed: false } as const;
  return { ...body, report_hash: await hashJson(body) };
}
