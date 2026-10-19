import { z } from "zod";
import { AssessedCandidateSchema, PolicySchema } from "../../../discovery/src/model";

const Common = z.object({
  api_version: z.literal("10x-discovery-v1"), trace_id: z.string(), as_of: z.string().nullable(), served_at: z.string(),
  policy_version: z.string(),
  source_freshness: z.object({ last_harvest: z.string().nullable(), last_success: z.string().nullable(), stale: z.boolean() }),
  coverage: z.object({ exhaustive: z.literal(false), scope: z.string(), history_limit: z.number(), quote_support: z.string(), holder_classification: z.string(), market_enabled: z.boolean() }),
});
export const ListResponse = Common.extend({ data: z.object({ candidates: z.array(AssessedCandidateSchema).max(100), mode: z.enum(["live", "fixture"]), counts: z.object({ eligible: z.number(), provisional: z.number(), excluded: z.number() }) }), next_cursor: z.string().nullable() });
export const DetailResponse = Common.extend({ data: AssessedCandidateSchema });
export const StatusResponse = Common.extend({ data: z.object({
  local_only: z.literal(true), paused: z.boolean(), running: z.boolean(), last_error: z.string().nullable(), retry_after: z.string().nullable(),
  pending_signatures: z.number(), usage: z.array(z.object({ provider: z.string(), used: z.number() })),
  daily_limits: z.object({ rpc: z.number(), market: z.number() }), adapter_version: z.string(), policy: PolicySchema,
  capabilities: z.object({ discovery: z.boolean(), voting: z.literal(false), launches: z.literal(false), signing: z.literal(false), rewards: z.literal(false), social_publishing: z.literal(false) }),
}) });
export type ListData = z.infer<typeof ListResponse>;
export type StatusData = z.infer<typeof StatusResponse>;
export async function getJson<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Discovery service unavailable (${response.status}).`);
  return schema.parse(await response.json());
}
export const readableReason = (code: string) => ({
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
} as Record<string, string>)[code] ?? code.replaceAll("_", " ");
