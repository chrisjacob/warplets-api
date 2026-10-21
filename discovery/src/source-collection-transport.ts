import { boundedJson } from "./rpc";
import { boundedJsonValue } from "./source-pilot";
import { hashJson } from "./solana";
import { sourceFetchDescriptor } from "./source-collection-request";
import { SOURCE_COLLECTION_LIMITS as L, type SourceReservation } from "./source-collection-store";

const owned = `id=?1 AND owner=?2 AND request_hash=?3 AND reserved_at<=?4 AND lease_until>?4 AND day=substr(?4,1,10)
  AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`;
const sourceAvailable = `EXISTS(SELECT 1 FROM tenx_source_transport_control WHERE id=1 AND (backoff_until IS NULL OR backoff_until<=?4))
  AND NOT EXISTS(SELECT 1 FROM tenx_market_control WHERE id=1 AND last_error IS NOT NULL AND next_refresh_at>?4)
  AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND (retry_after IS NULL OR retry_after<=?4))`;
// No default fetch, route, CLI or scheduler calls this adapter. Wiring it requires
// the documented rights/access/retention preflight; fake transport is used in tests.
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
export async function executeReservedSource(db: D1Database, reservation: SourceReservation, fetcher: SourceFetcher, clock = () => new Date()) {
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
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!row || await hashJson(JSON.parse(row.request)) !== reservation.request_hash) throw new Error("invalid_stored_request");
    const descriptor = sourceFetchDescriptor(JSON.parse(row.request), clock());
    const stillOwned = await db.prepare(`SELECT id FROM tenx_source_reservations WHERE ${owned} AND state='fetching' AND ${sourceAvailable}`).bind(...args(clock())).first();
    if (!stillOwned) return { state: "held" as const, provider_requests: 0 as const };
    const operation = async () => {
      requests = 1;
      response = await fetcher(descriptor.url, { method: "GET", headers: descriptor.headers, redirect: "manual", credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error("http_status");
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("content_type");
      const length = response.headers.get("content-length");
      if (length && /^\d+$/.test(length) && Number(length) > L.response_bytes) throw new Error("body_limit");
      const body = await boundedJson(response, L.response_bytes);
      boundedJsonValue(body, L.response_bytes);
      return body;
    };
    responseBody = await Promise.race([operation(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, L.timeout_ms);
    })]);
  } catch {
    // Do not persist upstream bodies/headers/errors/locations from failures.
    error = controller.signal.aborted ? "source_collection_timeout" : response && !response.ok ? "source_collection_http_error" : "source_collection_response_unusable";
    controller.abort();
    try { await response?.body?.cancel(); } catch { /* Already consumed/cancelled. */ }
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
  const finished = clock(), until = response ? backoff(response, finished) : new Date(finished.getTime() + 60_000).toISOString();
  const receipt = { version: "source-fetch-receipt-v1", request_hash: reservation.request_hash, response_hash: await hashJson(responseBody), reserved_at: row?.reserved_at ?? null,
    received_at: finished.toISOString(), status: response?.status ?? null, error, response: responseBody,
    // HTTP receipt is not chain identity, provider signature or semantic validation.
    semantic_validation: "not_checked", canonical_pool_proof: "not_checked", scoring_effect: "none" };
  const payload = JSON.stringify(receipt), bytes = new TextEncoder().encode(payload).length, receipt_hash = await hashJson(receipt);
  const results = await db.batch([
    // Backoff survives pause/lease loss, and a late success cannot clear newer backoff.
    db.prepare("UPDATE tenx_source_transport_control SET backoff_until=?1 WHERE id=1 AND ?1 IS NOT NULL AND (backoff_until IS NULL OR backoff_until<?1)").bind(until),
    db.prepare(`UPDATE tenx_source_reservations SET state=?5,bytes=?6,receipt=?7,receipt_hash=?8 WHERE ${owned} AND state='fetching' AND ?6<=bytes`)
      .bind(...args(clock()), error ? "failed" : "succeeded", bytes, payload, receipt_hash),
  ]);
  return { state: results[1]!.meta.changes === 1 ? error ? "failed" as const : "retained" as const : "held" as const, provider_requests: requests };
}
export async function readSourceReceipt(db: D1Database, id: string) {
  const row = await db.prepare("SELECT request,request_hash,receipt,receipt_hash,bytes FROM tenx_source_reservations WHERE id=?1 AND state IN ('succeeded','failed')").bind(id)
    .first<{request:string;request_hash:string;receipt:string;receipt_hash:string;bytes:number}>();
  if (!row) return null;
  if (new TextEncoder().encode(row.receipt).length !== row.bytes || row.bytes > L.reserved_bytes) throw new Error("source_collection_receipt_mismatch");
  const receipt = JSON.parse(row.receipt);
  boundedJsonValue(receipt, L.reserved_bytes);
  if (await hashJson(JSON.parse(row.request)) !== row.request_hash || receipt.request_hash !== row.request_hash ||
    await hashJson(receipt) !== row.receipt_hash || await hashJson(receipt.response) !== receipt.response_hash)
    throw new Error("source_collection_receipt_mismatch");
  return { replay: "verified" as const, source_authenticity: "not_independently_verified" as const, provider_requests: 0 as const, receipt };
}
