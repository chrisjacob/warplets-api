import { z } from "zod";
import { SOURCE_PILOT_LIMITS } from "./source-pilot-limits";

export const SourcePilotReadinessSchema = z.object({
  version: z.literal("source-pilot-readiness-v1"), mode: z.literal("offline_only"), live_collection_enabled: z.literal(false),
  provider_requests: z.literal(0), database_writes: z.literal(0), scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false),
  blockers: z.array(z.enum(["api_specific_usage_rights_unresolved", "free_endpoint_access_unverified", "authenticated_fixtures_not_collected", "atomic_shared_budget_admission_not_connected", "transport_not_connected", "canonical_pool_binding_not_connected", "collector_not_connected"])).length(5),
  prepared_collection: z.object({ atomic_shared_reservations: z.literal(true), bounded_transport: z.literal(true), pool_trade_review: z.literal(true), runtime_connected: z.literal(false) }).strict().optional(),
  providers: z.array(z.object({ id: z.enum(["jupiter", "geckoterminal_public"]), data: z.string().max(100), rights: z.string().max(250), access: z.string().max(250) }).strict()).length(2),
  limits: z.object({ mints: z.literal(10), response_rows: z.literal(100), candles: z.literal(360), window_seconds: z.literal(21600), input_bytes: z.literal(1000000), record_bytes: z.literal(1900000), provider_age_seconds: z.literal(300), proposed_market_daily_subset: z.literal(20) }).strict(),
  future_admission: z.object({ market_daily_subset: z.literal(20), shared_market_daily_default: z.literal(600), subset_is_additional: z.literal(false),
    shared_research_records: z.literal(100), shared_research_bytes: z.literal(10000000), captures_per_pass: z.literal(3), finalizations_per_pass: z.literal(5),
    reservations_made: z.literal(false), remaining_capacity: z.null() }).strict(),
}).strict();
export type SourcePilotReadiness = z.infer<typeof SourcePilotReadinessSchema>;
export function sourcePilotReadiness(): SourcePilotReadiness {
  return SourcePilotReadinessSchema.parse({
    version: "source-pilot-readiness-v1", mode: "offline_only", live_collection_enabled: false,
    provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false,
    blockers: ["api_specific_usage_rights_unresolved", "free_endpoint_access_unverified", "authenticated_fixtures_not_collected", "canonical_pool_binding_not_connected", "collector_not_connected"],
    prepared_collection: { atomic_shared_reservations: true, bounded_transport: true, pool_trade_review: true, runtime_connected: false },
    providers: [
      { id: "jupiter", data: "Tokens V2 organic activity", rights: "Tokens-only comparison, mixed-source scoring, retention, display and export need clarification", access: "Free/keyless access requires verification; no key configured by this work" },
      { id: "geckoterminal_public", data: "token info, minute pool candles and sampled trades", rights: "Verify the public API contract separately from CoinGecko Demo", access: "No Demo/Pro host or paid fallback; exact field coverage needs real fixtures" },
    ],
    limits: SOURCE_PILOT_LIMITS,
    future_admission: { market_daily_subset: 20, shared_market_daily_default: 600, subset_is_additional: false,
      shared_research_records: 100, shared_research_bytes: 10_000_000, captures_per_pass: 3, finalizations_per_pass: 5,
      reservations_made: false, remaining_capacity: null },
  });
}
