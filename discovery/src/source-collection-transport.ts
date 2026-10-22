import { boundedJson } from "./rpc";
import { boundedJsonValue } from "./source-pilot";
import { hashJson } from "./solana";
import { sourceFetchDescriptor } from "./source-collection-request";
import { SOURCE_COLLECTION_LIMITS as L, type SourceReservation } from "./source-collection-store";
import { gmgnEnvelope } from "./gmgn-request";
import { normalizeGmgn } from "./gmgn-normalize";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { GmgnCandleError } from "./gmgn-candles";
import {GmgnActivityError} from "./gmgn-wallet-activity";
import {describeGmgnActivity,type GmgnActivityShapeResult} from "./gmgn-activity-shape";
import { normalizeShortlist } from "./shortlist-query-contract";
import { isAttentionRequest, normalizeAttention } from "./attention-feed-contract";

const owned = `id=?1 AND owner=?2 AND request_hash=?3 AND reserved_at<=?4 AND lease_until>?4 AND day=substr(?4,1,10)
  AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`;
const sourceAvailable = `EXISTS(SELECT 1 FROM tenx_source_transport_control WHERE id=1 AND (backoff_until IS NULL OR backoff_until<=?4))
  AND NOT EXISTS(SELECT 1 FROM tenx_market_control WHERE id=1 AND last_error IS NOT NULL AND next_refresh_at>?4)
  AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND (retry_after IS NULL OR retry_after<=?4))`;
// No default fetch: callers must supply transport. GMGN is connected through its
// authenticated controller; Jupiter/GeckoTerminal collection remains held.
export type SourceFetcher = (url: string, init: RequestInit) => Promise<Response>;
function backoff(response: Response, now: Date): string | null {
  let seconds = response.status === 429 ? 60 : response.status >= 500 ? 60 : 0;
  const retry = response.headers.get("retry-after");
  if (retry !== null) {
    const delay = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - now.getTime()) / 1000;
    if (!Number.isNaN(delay)) seconds = Math.max(seconds, delay);
  }
  const remaining = response.headers.get("x-ratelimit-remaining"), reset = response.headers.get("x-ratelimit-reset");
  if (remaining !== null && /^-?\d+$/.test(remaining) && Number(remaining) <= 0 && reset !== null && /^\d+$/.test(reset)) {
    const delay = Number(reset) - now.getTime() / 1000;
    if (!Number.isNaN(delay)) seconds = Math.max(seconds, delay);
  }
  // Out-of-policy huge server values hold collection; never clamp down to retry early.
  if (seconds > 86_400) return "9999-12-31T23:59:59.999Z";
  return seconds > 0 ? new Date(now.getTime() + Math.ceil(seconds) * 1000).toISOString() : null;
}
export interface GmgnTransportOptions { apiKey: string; mode: "access_probe" | "retained_research"; permissionReference?: string }
export async function executeReservedSource(db: D1Database, reservation: SourceReservation, fetcher: SourceFetcher, clock = () => new Date(), gmgn?: GmgnTransportOptions) {
  const args = (at: Date) => [reservation.id, reservation.owner, reservation.request_hash, at.toISOString()];
  // Claim once before IO. A repeated invocation can never send a second request.
  const started = clock();
  const claimed = await db.batch([
    db.prepare(`UPDATE tenx_source_reservations SET state='fetching' WHERE ${owned} AND state='reserved'
      AND ${sourceAvailable}`).bind(...args(started)),
    // A delayed claim must move pacing forward from its actual start, not just
    // its earlier reservation time. Only the successful claim can move it.
    db.prepare(`UPDATE tenx_source_transport_control SET next_at=CASE WHEN next_at IS NULL OR next_at<?5 THEN ?5 ELSE next_at END
      WHERE id=1 AND changes()=1 AND EXISTS(SELECT 1 FROM tenx_source_reservations WHERE ${owned} AND state='fetching')`)
      .bind(...args(started), new Date(started.getTime() + L.spacing_ms).toISOString()),
  ]);
  if (claimed[0]!.meta.changes !== 1) return { state: "held" as const, provider_requests: 0 as const };
  const row = await db.prepare("SELECT request,reserved_at FROM tenx_source_reservations WHERE id=?1 AND owner=?2").bind(reservation.id, reservation.owner).first<{request:string;reserved_at:string}>();
  let response: Response | undefined, responseBody: unknown = null, error: string | null = null, requests = 0;
  let accessProbe = false, accessAccepted = false, permissionReference: string | null = null;
  let validationFailure: GmgnCandleError["reason"] | GmgnActivityError["reason"] | null = null;
  let activityValidationFields:string[]=[];
  let activityShape:GmgnActivityShapeResult|undefined;
  const shortlistDiagnostics: { value: { stage: string; data_array?: boolean; rank_array?: boolean; list_array?: boolean; application_success?: boolean; rank_rows?: number; failure_kind?: string; data_fields?: string[]; root_fields?: string[] } | null } = { value: null };
  const shortlist = row ? ["gmgn_market_rank", "geckoterminal_trending_list", "dexscreener_token_crosscheck"].includes(JSON.parse(row.request).kind) || isAttentionRequest(JSON.parse(row.request)) : false;
  const gmgnBackoff: { until: string | null } = { until: null };
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!row || await hashJson(JSON.parse(row.request)) !== reservation.request_hash) throw new Error("invalid_stored_request");
    const descriptor = sourceFetchDescriptor(JSON.parse(row.request), clock());
    const url = new URL(descriptor.url), requestHeaders: Record<string, string> = { ...descriptor.headers };
    if (descriptor.provider === "gmgn") {
      if (!gmgn || !/^[\x21-\x7e]{8,512}$/.test(gmgn.apiKey)) throw new Error("gmgn_key_required");
      accessProbe = gmgn.mode === "access_probe";
      if (accessProbe && descriptor.request.kind !== "gmgn_token_info") throw new Error("gmgn_probe_info_only");
      if (!accessProbe && gmgn.permissionReference !== GMGN_USE_AUTHORITY) throw new Error("gmgn_research_permission_required");
      permissionReference = accessProbe ? null : gmgn.permissionReference!;
      requestHeaders["X-APIKEY"] = gmgn.apiKey;
    }
    const stillOwned = await db.prepare(`SELECT id FROM tenx_source_reservations WHERE ${owned} AND state='fetching' AND ${sourceAvailable}`).bind(...args(clock())).first();
    if (!stillOwned) return { state: "held" as const, provider_requests: 0 as const };
    const operation = async () => {
      if (descriptor.provider === "gmgn") {
        url.searchParams.set("timestamp", String(Math.floor(clock().getTime() / 1000)));
        url.searchParams.set("client_id", crypto.randomUUID());
      }
      requests = 1;
      response = await fetcher(url.href, { method: descriptor.method, ...("body" in descriptor ? { body: descriptor.body } : {}), headers: requestHeaders, redirect: "manual", credentials: "omit", signal: controller.signal });
      if (descriptor.provider === "gmgn" && [401, 403].includes(response.status)) gmgnBackoff.until = new Date(clock().getTime() + 86_400_000).toISOString();
      if (descriptor.provider === "gmgn" && !response.ok && /^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        const failure = await boundedJson(response, L.response_bytes);
        // Read only reset_at; never retain provider failure text or bodies.
        const reset = failure && typeof failure === "object" && "reset_at" in failure ? failure.reset_at : null;
        if (typeof reset === "number" && Number.isFinite(reset) && reset > clock().getTime() / 1000) {
          const resetAt = reset - clock().getTime() / 1000 > 86_400 ? "9999-12-31T23:59:59.999Z" : new Date(Math.ceil(reset) * 1000).toISOString();
          if (!gmgnBackoff.until || resetAt > gmgnBackoff.until) gmgnBackoff.until = resetAt;
        }
      }
      if (!response.ok) throw new Error("http_status");
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("content_type");
      const length = response.headers.get("content-length");
      if (length && /^\d+$/.test(length) && Number(length) > L.response_bytes) throw new Error("body_limit");
      const body = await boundedJson(response, L.response_bytes);
      if (shortlist) {
        const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data as Record<string, unknown> : {};
        const shapeFields = (value: Record<string, unknown>) => Object.keys(value).filter(key => ["data", "rank", "list", "tokens", "items", "rows", "result", "count", "total", "code", "msg"].includes(key)).map(key => `${key}:${Array.isArray(value[key]) ? "array" : value[key] === null ? "null" : typeof value[key]}`);
        shortlistDiagnostics.value = { stage: "parsed_json", application_success: root.code === 0 || root.code === "0", data_array: Array.isArray(root.data), rank_array: Array.isArray(data.rank), list_array: Array.isArray(data.list), data_fields: shapeFields(data), root_fields: shapeFields(root), ...(Array.isArray(data.rank) ? { rank_rows: data.rank.length } : {}) };
      }
      boundedJsonValue(body, L.response_bytes);
      if (shortlistDiagnostics.value) shortlistDiagnostics.value.stage = "bounded_json";
      if (descriptor.provider === "gmgn") {
        if (gmgn && JSON.stringify(body).includes(gmgn.apiKey)) throw new Error("gmgn_credential_echo");
        gmgnEnvelope(body);
        // Validate semantic/identity shape before accepting HTTP 200. Do not
        // persist a body which could not be normalized or an unknown-mint default.
        if (isAttentionRequest(descriptor.request)) normalizeAttention(descriptor.request, body, clock().toISOString());
        else if (descriptor.request.kind === "gmgn_market_rank") normalizeShortlist(descriptor.request, body, clock().toISOString());
        else if(descriptor.request.kind==="gmgn_wallet_activity"){
          try{normalizeGmgn(descriptor.request,body,clock().toISOString());}
          catch(cause){if(cause instanceof GmgnActivityError)activityShape=describeGmgnActivity(gmgnEnvelope(body),cause.checks);throw cause;}
        }else normalizeGmgn(descriptor.request, body, clock().toISOString());
        accessAccepted = true;
        if (accessProbe) return null; // No token data or token-data hash retained.
      }
      if (descriptor.request.kind === "geckoterminal_trending_list" || descriptor.request.kind === "dexscreener_token_crosscheck") normalizeShortlist(descriptor.request, body, clock().toISOString());
      if (descriptor.provider !== "gmgn" && isAttentionRequest(descriptor.request)) normalizeAttention(descriptor.request, body, clock().toISOString());
      return body;
    };
    responseBody = await Promise.race([operation(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, L.timeout_ms);
    })]);
  } catch (cause) {
    if (shortlistDiagnostics.value) shortlistDiagnostics.value.failure_kind = cause instanceof Error && ["source_pilot_input_complexity_limit", "source_pilot_size_limit", "gmgn_application_error", "gmgn_empty_data"].includes("code" in cause ? String(cause.code) : cause.message) ? String("code" in cause ? cause.code : cause.message) : "schema_or_transport_validation";
    if (cause instanceof GmgnCandleError) validationFailure = cause.reason;
    if(cause instanceof GmgnActivityError){validationFailure=cause.reason;activityValidationFields=cause.fields;}
    // Do not persist upstream bodies/headers/errors/locations from failures.
    error = controller.signal.aborted ? "source_collection_timeout" : response && !response.ok ? "source_collection_http_error" : "source_collection_response_unusable";
    controller.abort();
    try { await response?.body?.cancel(); } catch { /* Already consumed/cancelled. */ }
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
  const finished = clock();
  let until = response ? backoff(response, finished) : new Date(finished.getTime() + 60_000).toISOString();
  if (gmgnBackoff.until && (!until || gmgnBackoff.until > until)) until = gmgnBackoff.until;
  if (error && gmgn && (!until || until < new Date(finished.getTime() + 60_000).toISOString())) until = new Date(finished.getTime() + 60_000).toISOString();
  const receipt = { version: "source-fetch-receipt-v1", request_hash: reservation.request_hash, response_hash: await hashJson(responseBody), reserved_at: row?.reserved_at ?? null,
    received_at: finished.toISOString(), status: response?.status ?? null, error, response: responseBody,
    ...(gmgn ? { access_probe: accessProbe, access_accepted: accessAccepted, research_permission_reference: permissionReference, validation_failure: validationFailure } : {}),
    ...(activityValidationFields.length?{activity_validation_fields:activityValidationFields}:{}),
    ...(activityShape?{activity_validation_shape:activityShape}:{}),
    ...(shortlistDiagnostics.value ? { shortlist_diagnostic: shortlistDiagnostics.value } : {}),
    // HTTP receipt is not chain identity, provider signature or semantic validation.
    semantic_validation: accessAccepted ? "gmgn_selected_fields_v2" : "not_checked", canonical_pool_proof: "not_checked", scoring_effect: "none" };
  const payload = JSON.stringify(receipt), bytes = new TextEncoder().encode(payload).length, receipt_hash = await hashJson(receipt);
  const results = await db.batch([
    // Backoff survives pause/lease loss, and a late success cannot clear newer backoff.
    db.prepare("UPDATE tenx_source_transport_control SET backoff_until=?1 WHERE id=1 AND ?1 IS NOT NULL AND (backoff_until IS NULL OR backoff_until<?1)").bind(until),
    db.prepare(`UPDATE tenx_source_reservations SET state=?5,bytes=?6,receipt=?7,receipt_hash=?8 WHERE ${owned} AND state='fetching' AND ?6<=bytes`)
      .bind(...args(clock()), error ? "failed" : "succeeded", bytes, payload, receipt_hash),
  ]);
  return { state: results[1]!.meta.changes === 1 ? error ? "failed" as const : "retained" as const : "held" as const, provider_requests: requests };
}
export async function readSourceReceiptWithRequest(db: D1Database, id: string) {
  const row = await db.prepare("SELECT request,request_hash,receipt,receipt_hash,bytes FROM tenx_source_reservations WHERE id=?1 AND state IN ('succeeded','failed')").bind(id)
    .first<{request:string;request_hash:string;receipt:string;receipt_hash:string;bytes:number}>();
  if (!row) return null;
  if (new TextEncoder().encode(row.receipt).length !== row.bytes || row.bytes > L.reserved_bytes) throw new Error("source_collection_receipt_mismatch");
  const receipt = JSON.parse(row.receipt);
  boundedJsonValue(receipt, L.reserved_bytes);
  if (await hashJson(JSON.parse(row.request)) !== row.request_hash || receipt.request_hash !== row.request_hash ||
    await hashJson(receipt) !== row.receipt_hash || await hashJson(receipt.response) !== receipt.response_hash)
    throw new Error("source_collection_receipt_mismatch");
  return { replay: "verified" as const, source_authenticity: "not_independently_verified" as const, provider_requests: 0 as const, receipt, request: JSON.parse(row.request) };
}
export async function readSourceReceipt(db: D1Database, id: string) {
  const saved=await readSourceReceiptWithRequest(db,id);
  if(!saved)return null;
  const {request: _request,...result}=saved;
  return result;
}
