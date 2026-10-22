import {z} from "zod";
const Count=z.number().int().safe().nonnegative();
export const DiscoveryYield=z.object({
  version:z.literal("discovery-yield-v1"),cutoff:z.string().datetime(),scope:z.literal("retained_pipeline_not_market"),
  candidates:z.object({retained:Count,active:Count,active_creation_unknown:Count,created_24h:Count,graduated_24h:Count,graduated_24h_creation_unknown:Count,with_market:Count,fresh_market:Count,fresh_reported_volume:Count,active_fresh_market:Count,active_fresh_reported_volume:Count,invalid_cached_identity:Count}).strict(),
  leads:z.object({observed:Count,unchecked:Count,graduated_24h:Count,unchecked_graduated_24h:Count,invalid_cached_json:Count}).strict(),
  signatures:z.object({observed:Count,pending:Count,oldest_pending_at:z.string().nullable()}).strict(),
  harvest:z.object({checkpoint:z.enum(["migration_required","idle","continuing","invalid"]),page_size:z.literal(30),exhaustive:z.literal(false)}).strict(),
  market_recall:z.literal("not_measured"),ranking:z.literal("v4_structural_support"),qualified_attention_in_rank:z.literal(false),
  receipt_payloads_replayed:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),evidence_gates_changed:z.literal(false),
}).strict().refine(r=>r.candidates.active<=r.candidates.retained&&r.candidates.active_creation_unknown<=r.candidates.active&&r.candidates.created_24h<=r.candidates.retained&&r.candidates.graduated_24h<=r.candidates.retained&&r.candidates.graduated_24h_creation_unknown<=r.candidates.graduated_24h&&r.candidates.fresh_reported_volume<=r.candidates.fresh_market&&r.candidates.fresh_market<=r.candidates.with_market&&r.candidates.with_market<=r.candidates.retained&&r.candidates.active_fresh_market<=Math.min(r.candidates.active,r.candidates.fresh_market)&&r.candidates.active_fresh_reported_volume<=Math.min(r.candidates.active_fresh_market,r.candidates.fresh_reported_volume)&&r.candidates.invalid_cached_identity<=r.candidates.retained&&r.leads.unchecked<=r.leads.observed&&r.leads.graduated_24h<=r.leads.observed&&r.leads.unchecked_graduated_24h<=r.leads.graduated_24h&&r.leads.unchecked_graduated_24h<=r.leads.unchecked&&r.leads.invalid_cached_json<=r.leads.observed&&r.signatures.pending<=r.signatures.observed,"yield_denominator_mismatch");
export type DiscoveryYieldReport=z.infer<typeof DiscoveryYield>;
