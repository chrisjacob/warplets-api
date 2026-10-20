import { DEFAULT_POLICY } from "./model";
import type { Lead } from "./store";
export async function dueLeads(db: D1Database, at: string) {
  const rows = await db.prepare(`SELECT l.*,m.payload AS market_payload FROM tenx_leads l
    LEFT JOIN tenx_lead_markets m ON m.address=l.address AND m.pool=l.pool
    LEFT JOIN tenx_candidates c ON c.address=l.address AND c.mode='live'
    WHERE (l.next_attempt_at IS NULL OR l.next_attempt_at<=?1) AND json_extract(l.migration_tx,'$.blockTime')>=?2
    ORDER BY CASE WHEN json_extract(m.payload,'$.market_cap_usd')>=?3 AND json_extract(m.payload,'$.liquidity_usd')>=?4 AND (l.checked_at IS NULL OR json_extract(c.payload,'$.creation') IS NULL) THEN 0
      WHEN l.checked_at IS NULL AND m.payload IS NULL THEN 1 WHEN l.checked_at IS NULL THEN 2 ELSE 3 END,
      CASE WHEN json_extract(m.payload,'$.market_cap_usd')>=?3 THEN json_extract(m.payload,'$.liquidity_usd') ELSE 0 END DESC,l.checked_at,l.first_seen_at DESC,l.address LIMIT 2`)
    .bind(at, Math.floor(Date.parse(at) / 1000) - 86400, DEFAULT_POLICY.min_market_cap_usd, DEFAULT_POLICY.min_liquidity_usd).all<Lead & { market_payload: string | null }>();
  return rows.results;
}
