import { z } from "zod";
import { AssessedCandidateSchema, PolicySchema } from "../../../discovery/src/model";
import { HistorySchema, ReviewSchema } from "../../../discovery/src/research-model";
import { ElectionRecordSchema, ElectionReplaySchema, ElectionSummarySchema } from "../../../discovery/src/election-model";
import { CoverageSchema } from "../../../discovery/src/coverage-model";
import { ActivitySchema } from "../../../discovery/src/activity-model";
import { PublicPolicySchema } from "../../../discovery/src/policy-model";

const Common = z.object({
  api_version: z.literal("10x-discovery-v1"), trace_id: z.string(), as_of: z.string().nullable(), served_at: z.string(),
  policy_version: z.string(),
  source_freshness: z.object({ last_harvest: z.string().nullable(), last_success: z.string().nullable(), stale: z.boolean() }),
  coverage: z.object({ exhaustive: z.literal(false), scope: z.string(), history_limit: z.number(), quote_support: z.string(), holder_classification: z.string(), market_enabled: z.boolean() }),
});
export const ListResponse = Common.extend({ data: z.object({ candidates: z.array(AssessedCandidateSchema).max(100), mode: z.enum(["live", "fixture"]), counts: z.object({ eligible: z.number(), provisional: z.number(), excluded: z.number() }) }), next_cursor: z.string().nullable() });
export const DetailResponse = Common.extend({ data: AssessedCandidateSchema });
export const CoverageResponse = Common.extend({ data: CoverageSchema });
export const ActivityResponse = Common.extend({ data: ActivitySchema });
export const PoliciesResponse = Common.extend({ data: PublicPolicySchema });
const ElectionAutomationSchema = z.object({ last_error: z.string().nullable(), latest_id: z.string().nullable(), last_snapshot_at: z.string().nullable() });
export const ElectionsResponse = Common.extend({ data: z.object({ runs: z.array(ElectionSummarySchema).max(10), automation: ElectionAutomationSchema, schedule: z.string(), voting_enabled: z.literal(false), launch_enabled: z.literal(false) }) });
export const ElectionDetailResponse = Common.extend({ data: z.object({ record: ElectionRecordSchema, replay: ElectionReplaySchema }) });
export const HistoryResponse = Common.extend({ data: HistorySchema });
export const ReviewsResponse = Common.extend({ data: z.object({ reports: z.array(ReviewSchema).max(7), automatic_policy_changes: z.literal(false), collection: z.object({ day: z.string(), tokens: z.number(), recommended: z.number(), wallet_samples: z.number().default(0), last_snapshot_at: z.string().nullable() }) }) });
export const StatusResponse = Common.extend({ data: z.object({
  local_only: z.literal(true), paused: z.boolean(), running: z.boolean(), last_error: z.string().nullable(), retry_after: z.string().nullable(),
  pending_signatures: z.number(), usage: z.array(z.object({ provider: z.string(), used: z.number() })),
  daily_limits: z.object({ rpc: z.number(), market: z.number(), artwork: z.number().optional(), wallet_catchup: z.number().optional() }), adapter_version: z.string(), policy: PolicySchema,
  capabilities: z.object({ discovery: z.boolean(), voting: z.literal(false), launches: z.literal(false), signing: z.literal(false), rewards: z.literal(false), social_publishing: z.literal(false) }),
  automation: z.object({ heartbeat_at: z.string().nullable(), next_refresh_at: z.string().nullable(), reviewed_at: z.string().nullable(), review_timezone: z.string(), review_cadence: z.string(), refresh_cadence: z.string() }).optional(),
  wallet_automation: z.object({ enabled: z.boolean(), daily_limit: z.number(), daily_used: z.number(), last_success: z.string().nullable(), next_refresh_at: z.string().nullable(), last_error: z.string().nullable() }).optional(),
  election_automation: ElectionAutomationSchema.optional(),
  market_provider: z.enum(["geckoterminal", "dexscreener"]).optional(),
  artwork_automation: z.object({ next_refresh_at: z.string().nullable(), last_error: z.string().nullable() }).optional(),
  quality_automation: z.object({ enabled: z.boolean(), daily_limit: z.number(), daily_used: z.number(), last_success: z.string().nullable(), next_refresh_at: z.string().nullable(), last_error: z.string().nullable(), targets: z.number() }).optional(),
}) });
export type ListData = z.infer<typeof ListResponse>;
export type StatusData = z.infer<typeof StatusResponse>;
export const marketSource = (source: string) => source === "dexscreener" ? "DEX Screener" : source === "mixed" ? "GeckoTerminal + DEX Screener" : "GeckoTerminal";
export async function getJson<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Discovery service unavailable (${response.status}).`);
  const result = schema.safeParse(await response.json());
  if (!result.success) throw new Error("Discovery data could not be verified. Reload this page or check Data status.");
  return result.data;
}
export const readableReason = (code: string) => ({
  fee_event_extension_uninterpreted: "The event has appended fields outside the pinned layout; known fee components reconcile, but extension coverage is incomplete",
  fee_additional_transfers_unclassified: "Additional transfers, such as account funding, are excluded from fee totals",
  fee_other_program_events_uninterpreted: "Other program events are outside this fee decoder; the known fee components are shown separately",
  fee_quote_flow_unreconciled: "Additional or unchecked quote transfers prevent fee and LP-retention reconciliation",
  fee_special_routing_unsupported: "Cashback, holder-reward or fee-sharing routing needs separate certification",
  fee_native_sell_balance_attribution_unsupported: "Native Pump sell fees need independent balance-attribution support",
  fee_instruction_layout_unsupported: "This swap's fee account layout is not yet certified",
  fee_event_missing_or_unsupported: "No supported fee event was found inside this swap",
  fee_event_ambiguous: "Multiple fee events prevent unambiguous swap attribution",
  fee_transfer_missing_or_ambiguous: "A fee payment could not be reconciled to one exact transfer",
  fee_buyback_transfer_missing_or_ambiguous: "The buyback portion could not be reconciled to one exact remaining payment",
  fee_event_or_execution_invalid: "Fee event or execution data could not be certified",
  fee_arithmetic_mismatch: "Fee amounts do not match emitted rates or quote-flow arithmetic",
  fee_verified_trade_sample_unavailable: "No verified swaps are available for fee analysis",
  trading_fee_coverage_partial: "Some fee layouts, events or transfers remain unverified",
  trading_fees_unavailable: "Trading fees cannot yet be verified from the saved transactions",
  bounded_local_candidate_inventory: "Only candidates retained by the bounded local discovery scan were considered",
  proposed_local_policy: "Thresholds are local proposals awaiting review",
  community_backing_not_enabled: "Wallet-backed community voting is not enabled",
  launch_adapters_not_certified: "Launch adapters and same-chain $10X prerequisites are not certified",
  no_onchain_execution: "This rehearsal cannot sign, launch or move funds",
  shared_upstream_creation_and_buyer_source: "Creation and early-buyer paths share an upstream source",
  creation_wallet_to_early_buyer_via_funder: "Signed creation wallet transferred to an early buyer through a funder",
  second_hop_coverage_partial: "Second-hop history is incomplete",
  second_hop_history_partial: "Some selected funder histories remain partial or unexamined",
  funding_sequence_not_coin_provenance: "Transfer sequences do not establish which coins funded the later transfer",
  single_outflow_anchor_per_funder: "Each funder uses one sampled outflow anchor; other windows can be missed",
  second_hop_same_slot_order_unknown: "Transfers in separate transactions in the same slot have no verified order",
  pre_buy_funding_coverage_partial: "Pre-buy funding coverage is still partial",
  funding_paging_pending: "Older funding pages remain to be scanned",
  funding_transactions_pending: "Returned transactions remain to be examined",
  provider_history_ended_before_window_boundary: "Provider history ended before a dated one-hour boundary; coverage is uncertain",
  funding_transaction_missing_or_unsupported: "Some funding transactions are unavailable, unsupported or omitted from this snapshot",
  shared_creation_and_buyer_funder: "Creation and buyer wallets share an observed direct funder",
  wallet_analysis_unavailable: "Wallet analysis is not yet available",
  wallet_analysis_stale: "Wallet sample needs refreshing",
  verified_buyer_sample_too_small: "Too few verified buyers in the sample",
  wallet_sample_coverage_incomplete: "Transaction or buyer funding coverage is incomplete",
  wallet_exposure_unverified: "Creation-wallet exposure cannot be verified",
  holder_concentration_unknown: "Holder concentration has not been verified",
  creation_history_scan_limit: "Creation is beyond the bounded history scan",
  creation_history_unavailable: "Creation history is unavailable",
  creation_unverified: "Original token creation is not verified",
  graduation_unverified: "Pump graduation is not verified",
  market_data_unavailable: "Market data is unavailable",
  market_cap_unknown_not_fdv: "Market cap is unknown; FDV is not a substitute",
  token_older_than_24h: "Token was created more than 24 hours ago",
  market_data_stale: "Market snapshot is stale",
  risk_evidence_stale: "Onchain risk snapshot needs refreshing",
  chain_verification_incomplete: "Chain verification is incomplete",
  holder_evidence_stale: "Holder inventory needs refreshing",
  top_holder_concentration_high: "Largest owner exceeds the concentration limit",
  top10_concentration_high: "Top ten owners exceed the concentration limit",
  creator_concentration_high: "Creation user holds more than the allowed share",
  too_few_holders: "Fewer holders than the local policy requires",
} as Record<string, string>)[code] ?? code.replaceAll("_", " ");
