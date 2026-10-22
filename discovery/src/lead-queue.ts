import { DEFAULT_POLICY } from "./model";
import type { Lead } from "./store";
export async function dueLeads(db: D1Database, at: string) {
  // Put first inspection before retries: a cycle may lack room for its second
  // worst-case inspection. Empty lanes lend their unused slot, never extra RPC.
  const rows = await db.prepare(`WITH eligible AS (
      SELECT l.*,CASE WHEN json_valid(m.payload) THEN m.payload ELSE NULL END AS market_payload,
        CASE WHEN json_extract(CASE WHEN json_valid(m.payload) THEN m.payload ELSE '{}' END,'$.market_cap_usd')>=?3
          AND json_extract(CASE WHEN json_valid(m.payload) THEN m.payload ELSE '{}' END,'$.liquidity_usd')>=?4
          AND json_extract(CASE WHEN json_valid(c.payload) THEN c.payload ELSE '{}' END,'$.creation') IS NULL THEN 0 ELSE 3 END AS retry_priority,
        CASE WHEN json_extract(CASE WHEN json_valid(m.payload) THEN m.payload ELSE '{}' END,'$.market_cap_usd')>=?3
          THEN json_extract(CASE WHEN json_valid(m.payload) THEN m.payload ELSE '{}' END,'$.liquidity_usd') ELSE 0 END AS retry_liquidity
      FROM tenx_leads l LEFT JOIN tenx_lead_markets m ON m.address=l.address AND m.pool=l.pool
      LEFT JOIN tenx_candidates c ON c.address=l.address AND c.mode='live'
      WHERE (l.next_attempt_at IS NULL OR l.next_attempt_at<=?1)
        AND json_type(CASE WHEN json_valid(l.migration_tx) THEN l.migration_tx ELSE '{}' END,'$.blockTime')='integer'
        AND json_extract(CASE WHEN json_valid(l.migration_tx) THEN l.migration_tx ELSE '{}' END,'$.blockTime')>=?2
        AND json_extract(CASE WHEN json_valid(l.migration_tx) THEN l.migration_tx ELSE '{}' END,'$.blockTime')<=?5
        AND NOT EXISTS(SELECT 1 FROM tenx_candidate_expiry e WHERE e.address=l.address)
    ), first_inspections AS (
      SELECT eligible.*,row_number() OVER(ORDER BY first_seen_at,address) AS lane_ordinal,0 AS lane
      FROM eligible WHERE checked_at IS NULL ORDER BY first_seen_at,address LIMIT 2
    ), retries AS (
      SELECT eligible.*,row_number() OVER(ORDER BY retry_priority,retry_liquidity DESC,checked_at,first_seen_at DESC,address) AS lane_ordinal,1 AS lane
      FROM eligible WHERE checked_at IS NOT NULL ORDER BY retry_priority,retry_liquidity DESC,checked_at,first_seen_at DESC,address LIMIT 2
    ) SELECT * FROM (SELECT * FROM first_inspections UNION ALL SELECT * FROM retries)
    ORDER BY 2*(lane_ordinal-1)+lane LIMIT 2`)
    .bind(at, Math.floor(Date.parse(at) / 1000) - 86400, DEFAULT_POLICY.min_market_cap_usd, DEFAULT_POLICY.min_liquidity_usd,
      Math.floor(Date.parse(at) / 1000)).all<Lead & { market_payload: string | null; checked_at: string | null }>();
  return rows.results;
}
