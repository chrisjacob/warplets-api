import { z } from "zod";
import { hashJson } from "./solana";
import { sourceFetchDescriptor } from "./source-collection-request";
import { SCORE_RESEARCH_LIMITS as L } from "./score-research-model";
import { sharedResearchRecords, sharedResearchBytes } from "./research-budget";
export { sharedResearchUsage } from "./research-budget";

export const SOURCE_COLLECTION_LIMITS = { daily_requests: 20, market_daily_maximum: 600,
  response_bytes: 1_000_000, reserved_bytes: 1_900_000, lease_ms: 120_000,
  timeout_ms: 15_000, spacing_ms: 10_000 } as const;
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export interface SourceReservation { id: string; owner: string; request_hash: string }

export async function reserveSourceFetch(db: D1Database, id: string, raw: unknown, marketDailyLimit: number, now = new Date()): Promise<SourceReservation | null> {
  Id.parse(id);
  z.number().int().min(0).max(SOURCE_COLLECTION_LIMITS.market_daily_maximum).parse(marketDailyLimit);
  const { request } = sourceFetchDescriptor(raw, now), request_hash = await hashJson(request), owner = crypto.randomUUID();
  const at = now.toISOString(), day = at.slice(0, 10), until = new Date(now.getTime() + SOURCE_COLLECTION_LIMITS.lease_ms).toISOString();
  const old = await db.prepare("SELECT request_hash FROM tenx_source_reservations WHERE id=?1").bind(id).first<{request_hash:string}>();
  if (old && old.request_hash !== request_hash) throw new Error("source_collection_id_conflict");
  // D1 batch is a transaction: capacity, slot, quota and pacing commit together.
  // No refund for failed/abandoned requests. No separate pilot-only allowance.
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_source_reservations(id,owner,request_hash,request,reserved_at,day,lease_until,state,bytes)
      SELECT ?1,?2,?3,?4,?5,?6,?7,'reserved',?8
      WHERE EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?5))
      AND NOT EXISTS(SELECT 1 FROM tenx_market_control WHERE id=1 AND last_error IS NOT NULL AND next_refresh_at>?5)
      AND EXISTS(SELECT 1 FROM tenx_source_transport_control WHERE id=1 AND (next_at IS NULL OR next_at<=?5) AND (backoff_until IS NULL OR backoff_until<=?5))
      AND NOT EXISTS(SELECT 1 FROM tenx_source_reservations WHERE state IN ('reserved','fetching') AND lease_until>?5)
      AND (SELECT count(*) FROM tenx_source_reservations WHERE day=?6)<?9
      AND ${sharedResearchRecords}<?10 AND ${sharedResearchBytes}+?8<=?11
      AND COALESCE((SELECT used FROM tenx_usage WHERE provider='market' AND day=?6),0)<?12`)
      .bind(id, owner, request_hash, JSON.stringify(request), at, day, until, SOURCE_COLLECTION_LIMITS.reserved_bytes, SOURCE_COLLECTION_LIMITS.daily_requests, L.daily_records, L.daily_bytes, marketDailyLimit),
    db.prepare(`INSERT INTO tenx_usage(provider,day,used) SELECT 'market',?1,1 WHERE EXISTS(SELECT 1 FROM tenx_source_reservations WHERE id=?2 AND owner=?3)
      ON CONFLICT(provider,day) DO UPDATE SET used=used+1`).bind(day, id, owner),
    db.prepare("UPDATE tenx_source_transport_control SET next_at=?1 WHERE id=1 AND EXISTS(SELECT 1 FROM tenx_source_reservations WHERE id=?2 AND owner=?3)")
      .bind(new Date(now.getTime() + SOURCE_COLLECTION_LIMITS.spacing_ms).toISOString(), id, owner),
  ]);
  return results[0]!.meta.changes === 1 ? { id, owner, request_hash } : null;
}
