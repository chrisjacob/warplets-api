import { HOLDER_OUTREACH_TEMPLATES, HOLDER_OUTREACH_WINDOW_MS } from "../../_lib/holderOutreach.js";
import { jsonSecure, requireAdminScope, type SecurityEnv } from "../../_lib/security.js";

interface Env extends SecurityEnv {
  WARPLETS: D1Database;
}

type OutreachRow = {
  fid: number;
  cast_hash: string;
  username: string;
  display_name: string | null;
  pfp_url: string | null;
  x_username: string | null;
  cast_text: string;
  cast_at: string;
  parent_hash: string | null;
  token_id: number;
  owned_count: number;
  synced_at: string;
  outreach_count: number;
  farcaster_outreach_count: number;
  x_outreach_count: number;
  last_outreach_at: string | null;
  converted_at: string | null;
  opted_out: number;
};

const OUTREACH_DATA_CTE = `WITH raw_app_use AS (
  SELECT farcaster_fid AS fid, last_warplets_seen_at AS used_at
  FROM app_auth_sessions
  WHERE farcaster_fid IS NOT NULL AND last_warplets_seen_at IS NOT NULL
  UNION ALL
  SELECT fid, updated_at AS used_at
  FROM miniapp_notification_tokens
  WHERE app_slug = 'warplets'
  UNION ALL
  SELECT fid, first_opened_at AS used_at
  FROM holder_outreach_events
  WHERE first_opened_at IS NOT NULL
), conversions AS (
  SELECT fid, MAX(used_at) AS converted_at
  FROM raw_app_use
  GROUP BY fid
), outreach AS (
  SELECT
    fid,
    COUNT(*) AS outreach_count,
    SUM(CASE WHEN channel = 'farcaster' THEN 1 ELSE 0 END) AS farcaster_outreach_count,
    SUM(CASE WHEN channel = 'x' THEN 1 ELSE 0 END) AS x_outreach_count,
    MAX(created_at) AS last_outreach_at
  FROM holder_outreach_events
  GROUP BY fid
), active_opt_outs AS (
  SELECT fid
  FROM warplets_outreach_opt_outs
  WHERE opted_back_in_on IS NULL
)`;

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:inspect" });
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const converted = ["yes", "no"].includes(url.searchParams.get("converted") ?? "")
    ? url.searchParams.get("converted")
    : "all";
  const contacted = ["yes", "no"].includes(url.searchParams.get("contacted") ?? "")
    ? url.searchParams.get("contacted")
    : "all";
  const eligibility = ["eligible", "opted-out"].includes(url.searchParams.get("eligibility") ?? "")
    ? url.searchParams.get("eligibility")
    : "all";
  const limit = boundedInteger(url.searchParams.get("limit"), 100, 1, 100);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 0, 100_000);
  const cutoff = new Date(Date.now() - HOLDER_OUTREACH_WINDOW_MS).toISOString();
  const clauses = ["c.cast_at >= ?"];
  const bindings: Array<string | number> = [cutoff];

  if (query) {
    clauses.push(`(
      CAST(c.fid AS TEXT) LIKE ? OR CAST(c.token_id AS TEXT) LIKE ? OR
      LOWER(c.username) LIKE LOWER(?) OR LOWER(COALESCE(c.display_name, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(c.x_username, '')) LIKE LOWER(?) OR LOWER(c.cast_text) LIKE LOWER(?)
    )`);
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (converted === "yes") clauses.push("conversion.converted_at IS NOT NULL");
  if (converted === "no") clauses.push("conversion.converted_at IS NULL");
  if (contacted === "yes") clauses.push("COALESCE(outreach.outreach_count, 0) > 0");
  if (contacted === "no") clauses.push("COALESCE(outreach.outreach_count, 0) = 0");
  if (eligibility === "eligible") clauses.push("opt_out.fid IS NULL");
  if (eligibility === "opted-out") clauses.push("opt_out.fid IS NOT NULL");

  const [rowsResult, filteredTotal, summary, syncState] = await Promise.all([
    context.env.WARPLETS.prepare(
      `${OUTREACH_DATA_CTE}
       SELECT
         c.fid, c.cast_hash, c.username, c.display_name, c.pfp_url, c.x_username,
         c.cast_text, c.cast_at, c.parent_hash, c.token_id, c.owned_count, c.synced_at,
         COALESCE(outreach.outreach_count, 0) AS outreach_count,
         COALESCE(outreach.farcaster_outreach_count, 0) AS farcaster_outreach_count,
         COALESCE(outreach.x_outreach_count, 0) AS x_outreach_count,
         outreach.last_outreach_at,
         conversion.converted_at,
         CASE WHEN opt_out.fid IS NULL THEN 0 ELSE 1 END AS opted_out
       FROM holder_outreach_casts c
       LEFT JOIN outreach ON outreach.fid = c.fid
       LEFT JOIN conversions conversion ON conversion.fid = c.fid
       LEFT JOIN active_opt_outs opt_out ON opt_out.fid = c.fid
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.cast_at DESC, c.fid ASC
       LIMIT ? OFFSET ?`,
    ).bind(...bindings, limit, offset).all<OutreachRow>(),
    context.env.WARPLETS.prepare(
      `${OUTREACH_DATA_CTE}
       SELECT COUNT(*) AS count
       FROM holder_outreach_casts c
       LEFT JOIN outreach ON outreach.fid = c.fid
       LEFT JOIN conversions conversion ON conversion.fid = c.fid
       LEFT JOIN active_opt_outs opt_out ON opt_out.fid = c.fid
       WHERE ${clauses.join(" AND ")}`,
    ).bind(...bindings).first<{ count: number }>(),
    context.env.WARPLETS.prepare(
      `${OUTREACH_DATA_CTE}
       SELECT
         COUNT(*) AS active_holders,
         SUM(CASE WHEN conversion.converted_at IS NOT NULL THEN 1 ELSE 0 END) AS converted_holders,
         SUM(CASE WHEN COALESCE(outreach.outreach_count, 0) > 0 THEN 1 ELSE 0 END) AS contacted_holders,
         SUM(COALESCE(outreach.outreach_count, 0)) AS outreach_actions,
         SUM(CASE WHEN opt_out.fid IS NOT NULL THEN 1 ELSE 0 END) AS opted_out_holders
       FROM holder_outreach_casts c
       LEFT JOIN outreach ON outreach.fid = c.fid
       LEFT JOIN conversions conversion ON conversion.fid = c.fid
       LEFT JOIN active_opt_outs opt_out ON opt_out.fid = c.fid
       WHERE c.cast_at >= ?`,
    ).bind(cutoff).first<Record<string, number>>(),
    context.env.WARPLETS.prepare(
      `SELECT after_fid, scanned_holders, total_holders, active_holders,
              truncated_groups, cycle_started_at, completed_at, last_error, updated_at
       FROM holder_outreach_sync_state WHERE singleton = 1`,
    ).first(),
  ]);

  const rows = (rowsResult.results ?? []).map((row) => ({
    fid: Number(row.fid),
    castHash: row.cast_hash,
    username: row.username,
    displayName: row.display_name,
    pfpUrl: row.pfp_url,
    xUsername: row.x_username,
    castText: row.cast_text,
    castAt: row.cast_at,
    isReply: Boolean(row.parent_hash),
    tokenId: Number(row.token_id),
    ownedCount: Number(row.owned_count),
    syncedAt: row.synced_at,
    outreachCount: Number(row.outreach_count),
    farcasterOutreachCount: Number(row.farcaster_outreach_count),
    xOutreachCount: Number(row.x_outreach_count),
    lastOutreachAt: row.last_outreach_at,
    converted: Boolean(row.converted_at),
    convertedAt: row.converted_at,
    optedOut: Boolean(row.opted_out),
  }));

  return jsonSecure({
    rows,
    total: Number(filteredTotal?.count ?? 0),
    limit,
    offset,
    summary: {
      activeHolders: Number(summary?.active_holders ?? 0),
      convertedHolders: Number(summary?.converted_holders ?? 0),
      contactedHolders: Number(summary?.contacted_holders ?? 0),
      outreachActions: Number(summary?.outreach_actions ?? 0),
      optedOutHolders: Number(summary?.opted_out_holders ?? 0),
    },
    sync: syncState,
    templates: HOLDER_OUTREACH_TEMPLATES,
  });
};
