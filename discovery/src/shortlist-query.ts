import { z } from "zod";
import { ShortlistQueryRequest, normalizeShortlist } from "./shortlist-query-contract";
import { reserveSourceFetch } from "./source-collection-store";
import { executeReservedSource, readSourceReceipt, type SourceFetcher } from "./source-collection-transport";
import type { GmgnSettings } from "./gmgn";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { AttentionRequest, isAttentionRequest, normalizeAttention } from "./attention-feed-contract";

// Explicit admin experiment only: no candidate writes, schedule or score adoption.
export async function runShortlistQuery(settings: GmgnSettings, raw: unknown, fetcher: SourceFetcher, clock = () => new Date()) {
  const input = z.object({ request_id: z.uuid(), reason: z.string().min(3).max(300), request: z.union([ShortlistQueryRequest, AttentionRequest]) }).strict().parse(raw);
  return executeShortlistQuery(settings,input.request_id,input.request,fetcher,clock);
}
export async function executeShortlistQuery(settings: GmgnSettings, requestId: string, request: unknown, fetcher: SourceFetcher, clock = () => new Date()) {
  const parsed=z.union([ShortlistQueryRequest,AttentionRequest]).parse(request);
  const gmgn = parsed.kind === "gmgn_market_rank" || parsed.kind === "gmgn_hot_searches";
  if (gmgn && (!settings.apiKey || settings.permissionReference !== GMGN_USE_AUTHORITY)) return { state: "held", reason: "gmgn_configuration_required", provider_requests: 0 };
  const reservation = await reserveSourceFetch(settings.db, requestId, parsed, settings.marketDailyLimit, clock(), settings.researchMode);
  if (!reservation) return { state: "held", reason: "shared_admission_or_duplicate", provider_requests: 0, request_id: requestId };
  const result = await executeReservedSource(settings.db, reservation, fetcher, clock,
    gmgn ? { apiKey: settings.apiKey!, mode: "retained_research", permissionReference: settings.permissionReference } : undefined);
  const saved = await readSourceReceipt(settings.db, requestId), receipt = saved?.receipt;
  return { ...result, request_id: requestId, status: receipt?.status ?? null, error: receipt?.error ?? null,
    diagnostic: receipt?.shortlist_diagnostic ?? null,
    observation: receipt && receipt.error === null && receipt.response !== null ? isAttentionRequest(parsed) ? normalizeAttention(parsed,receipt.response,receipt.received_at) : normalizeShortlist(parsed, receipt.response, receipt.received_at) : null,
    scoring_effect: "none", evidence_gates_changed: false };
}
