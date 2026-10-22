import { z } from "zod";
import { Address } from "./model";
import { MintIntakeReview, MintIntakeStatus } from "./mint-intake-status-model";
const flag = z.union([z.literal(0), z.literal(1)]).transform(Boolean);
const Row = z.object({ state: MintIntakeReview.shape.state.nullable(), queued_at: z.string().datetime().nullable(), updated_at: z.string().datetime().nullable(),
  pages: z.number().int().min(0).max(3).nullable(), bodies_checked: z.number().int().min(0).max(90), last_error: MintIntakeReview.shape.last_error,
  candidate_saved: flag, migration_lead_saved: flag, paused: flag, retry_after: z.string().datetime().nullable(), next_refresh_at: z.string().datetime().nullable(),
  reserved_today: z.number().int().min(0).max(20) }).strict();

// One indexed metadata read. No transaction, candidate or signature-page body
// crosses the Worker boundary; no provider work or queue mutation is possible.
export async function mintIntakeStatus(db: D1Database, rawAddress: string, now = new Date()) {
  const address = Address.parse(rawAddress), at = now.toISOString();
  const row = Row.parse(await db.prepare(`SELECT r.state,r.queued_at,r.updated_at,r.pages,r.last_error,
    (SELECT count(*) FROM (SELECT 1 FROM tenx_mint_review_reads b WHERE b.address=?1 LIMIT 91)) AS bodies_checked,
    EXISTS(SELECT 1 FROM tenx_candidates c WHERE c.address=?1 AND c.mode='live') AS candidate_saved,
    EXISTS(SELECT 1 FROM tenx_leads l WHERE l.address=?1) AS migration_lead_saved,
    ctl.paused,ctl.retry_after,ctl.next_refresh_at,COALESCE(u.used,0) AS reserved_today
    FROM tenx_control ctl LEFT JOIN tenx_mint_reviews r ON r.address=?1
    LEFT JOIN tenx_usage u ON u.provider='mint_intake' AND u.day=?2 WHERE ctl.id=1`)
    .bind(address, at.slice(0, 10)).first());
  if (!row.state && (row.queued_at !== null || row.updated_at !== null || row.pages !== null || row.last_error !== null || row.bodies_checked !== 0)) throw Error("intake_status_orphan_metadata");
  return MintIntakeStatus.parse({ version: "mint-intake-status-v1", chain: "solana", address, at,
    scope: "bounded_pump_fun_wsol_migration_review", review: row.state ? MintIntakeReview.parse({ state: row.state, queued_at: row.queued_at, updated_at: row.updated_at, pages: row.pages, bodies_checked: row.bodies_checked, last_error: row.last_error }) : null,
    candidate_saved: row.candidate_saved, migration_lead_saved: row.migration_lead_saved,
    control: { paused: row.paused, retry_after: row.retry_after, next_refresh_at: row.next_refresh_at, reserved_today: row.reserved_today },
    provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false });
}
