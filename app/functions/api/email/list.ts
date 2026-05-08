/**
 * GET /api/email/list
 *
 * Admin endpoint — lists email waitlist subscribers with pagination.
 * Requires x-admin-token header.
 *
 * Query params:
 *   limit   — max rows (default 100, max 500)
 *   offset  — pagination offset (default 0)
 *   filter  — "all" | "verified" | "unverified" | "unsubscribed" (default "all")
 */

interface Env {
  WARPLETS: D1Database;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
  WARPLETS_KV?: KVNamespace;
}
import { jsonSecure, requireAdminScope } from "../../_lib/security.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "email:list" });
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
  const filter = url.searchParams.get("filter") ?? "all";

  let whereClause = "";
  if (filter === "verified") whereClause = "WHERE verified = 1 AND unsubscribed_at IS NULL";
  else if (filter === "unverified") whereClause = "WHERE verified = 0 AND unsubscribed_at IS NULL";
  else if (filter === "unsubscribed") whereClause = "WHERE unsubscribed_at IS NOT NULL";

  const [rows, stats] = await Promise.all([
    context.env.WARPLETS.prepare(
      `SELECT id, email, fid, username, token_id, matched, verified, subscribed_at, verified_at, unsubscribed_at, updated_at
       FROM email_waitlist
       ${whereClause}
       ORDER BY subscribed_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all(),

    context.env.WARPLETS.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN verified = 1 AND unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS verified,
         SUM(CASE WHEN verified = 0 AND unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS unverified,
         SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed,
         SUM(CASE WHEN matched = 1 THEN 1 ELSE 0 END) AS matched
       FROM email_waitlist`
    ).first<{ total: number; verified: number; unverified: number; unsubscribed: number; matched: number }>(),
  ]);

  return jsonSecure({
    stats,
    rows: rows.results,
    pagination: { limit, offset, returned: rows.results.length },
  });
};
