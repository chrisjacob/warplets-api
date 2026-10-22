import { z } from "zod";
import { ShortlistQueryRequest, normalizeShortlist } from "./shortlist-query-contract";
import { reserveSourceFetch } from "./source-collection-store";
import { executeReservedSource, readSourceReceipt, type SourceFetcher } from "./source-collection-transport";
import type { GmgnSettings } from "./gmgn";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";

// Explicit admin experiment only: no candidate writes, schedule or score adoption.
export async function runShortlistQuery(settings: GmgnSettings, raw: unknown, fetcher: SourceFetcher, clock = () => new Date()) {
  const input = z.object({ request_id: z.uuid(), reason: z.string().min(3).max(300), request: ShortlistQueryRequest }).strict().parse(raw);
  const gmgn = input.request.kind === "gmgn_market_rank";
  if (gmgn && (!settings.apiKey || settings.permissionReference !== GMGN_USE_AUTHORITY)) return { state: "held", reason: "gmgn_configuration_required", provider_requests: 0 };
  const reservation = await reserveSourceFetch(settings.db, input.request_id, input.request, settings.marketDailyLimit, clock(), settings.researchMode);
  if (!reservation) return { state: "held", reason: "shared_admission_or_duplicate", provider_requests: 0, request_id: input.request_id };
  const result = await executeReservedSource(settings.db, reservation, fetcher, clock,
    gmgn ? { apiKey: settings.apiKey!, mode: "retained_research", permissionReference: settings.permissionReference } : undefined);
  const saved = await readSourceReceipt(settings.db, input.request_id), receipt = saved?.receipt;
  return { ...result, request_id: input.request_id, status: receipt?.status ?? null, error: receipt?.error ?? null,
    diagnostic: receipt?.shortlist_diagnostic ?? null,
    observation: receipt && receipt.error === null && receipt.response !== null ? normalizeShortlist(input.request, receipt.response, receipt.received_at) : null,
    scoring_effect: "none", evidence_gates_changed: false };
}
