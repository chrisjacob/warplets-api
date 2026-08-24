import { requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../_lib/security.js";

type GroupRow = { canonical_emoji: string; cldr_name: string; keywords_json: string; reviewed_at: string | null; candidate_count: number; approved_count: number; popularity_rank: number };
type ReviewCursor = { rank: number; name: string; emoji: string };

function parseCursor(value: string | null): ReviewCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ReviewCursor>;
    if (!Number.isInteger(parsed.rank) || typeof parsed.name !== "string" || typeof parsed.emoji !== "string") return null;
    return { rank: parsed.rank as number, name: parsed.name, emoji: parsed.emoji };
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env);
  if (admin instanceof Response) return admin;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "unreviewed";
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filter === "unreviewed") clauses.push("g.reviewed_at IS NULL AND EXISTS (SELECT 1 FROM warpmoji_candidates uc WHERE uc.canonical_emoji = g.canonical_emoji AND uc.status != 'rejected')");
  else if (filter === "confirmed" || filter === "reviewed") clauses.push("g.reviewed_at IS NOT NULL");
  else if (filter === "approved") clauses.push("g.approved_count > 0");
  else if (filter === "removed") clauses.push("EXISTS (SELECT 1 FROM warpmoji_rejections r WHERE r.canonical_emoji = g.canonical_emoji AND r.restored_at IS NULL)");
  else if (filter === "no-candidates") clauses.push("g.reviewed_at IS NULL AND NOT EXISTS (SELECT 1 FROM warpmoji_candidates nc WHERE nc.canonical_emoji = g.canonical_emoji AND nc.status != 'rejected')");
  if (search) {
    const tokenId = Number.parseInt(search.replace(/^#/, ""), 10);
    clauses.push("(g.canonical_emoji = ? OR g.cldr_name LIKE ? OR g.keywords_json LIKE ? OR EXISTS (SELECT 1 FROM warpmoji_candidates sc WHERE sc.canonical_emoji = g.canonical_emoji AND sc.token_id = ?))");
    binds.push(search, `%${search}%`, `%${search}%`, Number.isInteger(tokenId) ? tokenId : -1);
  }
  if (cursor) {
    clauses.push("(g.popularity_rank > ? OR (g.popularity_rank = ? AND g.cldr_name > ?) OR (g.popularity_rank = ? AND g.cldr_name = ? AND g.canonical_emoji > ?))");
    binds.push(cursor.rank, cursor.rank, cursor.name, cursor.rank, cursor.name, cursor.emoji);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const groups = await env.WARPLETS.prepare(
      `SELECT g.canonical_emoji, g.cldr_name, g.keywords_json, g.reviewed_at, g.candidate_count, g.approved_count, g.popularity_rank
         FROM warpmoji_emoji_groups g ${where}
        ORDER BY g.popularity_rank ASC, g.cldr_name ASC, g.canonical_emoji ASC
        LIMIT 21`,
    ).bind(...binds).all<GroupRow>();
    const hasMore = groups.results.length > 20;
    const pageGroups = groups.results.slice(0, 20);
    const results = await Promise.all(pageGroups.map(async (group) => {
      const candidates = (await env.WARPLETS.prepare(
        `SELECT c.token_id, c.score, c.exact_score, c.fts_score, c.semantic_score, c.hint_score,
                c.conflict_penalty, c.reasons_json, c.status, c.assignment, c.scoring_version,
                m.jpg_url, m.x10_rank, m.description,
                (SELECT pc.canonical_emoji FROM warpmoji_candidates pc WHERE pc.token_id = c.token_id AND pc.assignment = 'primary' ORDER BY pc.score DESC LIMIT 1) AS primary_emoji
           FROM warpmoji_candidates c LEFT JOIN warplets_metadata m ON m.token_id = c.token_id
          WHERE c.canonical_emoji = ? ORDER BY c.status = 'approved' DESC, c.score DESC LIMIT 30`,
      ).bind(group.canonical_emoji).all<Record<string, unknown>>()).results;
      if (filter === "removed") {
        const archive = await env.WARPLETS.prepare(
          `SELECT r.token_id, r.score, 0 AS exact_score, 0 AS fts_score, 0 AS semantic_score, 0 AS hint_score,
                  0 AS conflict_penalty, r.reasons_json, 'rejected' AS status, 'secondary' AS assignment,
                  r.scoring_version, m.jpg_url, m.x10_rank, m.description
             FROM warpmoji_rejections r LEFT JOIN warplets_metadata m ON m.token_id = r.token_id
            WHERE r.canonical_emoji = ? AND r.restored_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM warpmoji_candidates c WHERE c.canonical_emoji = r.canonical_emoji AND c.token_id = r.token_id)
            ORDER BY r.score DESC LIMIT 30`,
        ).bind(group.canonical_emoji).all<Record<string, unknown>>();
        candidates.push(...archive.results);
      }
      return { ...group, keywords: JSON.parse(group.keywords_json || "[]"), candidates };
    }));
    const last = pageGroups.at(-1);
    const nextCursor = hasMore && last ? JSON.stringify({ rank: last.popularity_rank, name: last.cldr_name, emoji: last.canonical_emoji }) : null;
    return jsonSecure({ groups: results, hasMore, nextCursor, csrfToken: admin.csrfToken }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return jsonSecure({ error: "Warpmoji data is not initialized. Apply migrations 0051 through 0056.", detail: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
};
