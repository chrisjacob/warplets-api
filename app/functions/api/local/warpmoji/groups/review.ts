import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../../_lib/security.js";

export const onRequestPost: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const body = await request.json<{ emoji?: unknown; tokenIds?: unknown; removedTokenIds?: unknown }>().catch(() => ({} as { emoji?: unknown; tokenIds?: unknown; removedTokenIds?: unknown }));
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  const group = emoji
    ? await env.WARPLETS.prepare("SELECT canonical_emoji FROM warpmoji_emoji_groups WHERE canonical_emoji = ?").bind(emoji).first()
    : null;
  if (!group) return jsonSecure({ error: "Emoji group was not found." }, { status: 404 });
  const explicitTokenIds = Array.isArray(body.tokenIds) ? body.tokenIds : null;
  const hasExplicitSelection = explicitTokenIds !== null;
  let tokenIds = explicitTokenIds
    ? [...new Set(explicitTokenIds.map(Number).filter((tokenId) => Number.isInteger(tokenId) && tokenId >= 1 && tokenId <= 10000))]
    : [];
  if (!hasExplicitSelection) {
    const best = await env.WARPLETS.prepare(
      "SELECT token_id FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected' ORDER BY score DESC, token_id ASC LIMIT 1",
    ).bind(emoji).first<{ token_id: number }>();
    tokenIds = best ? [best.token_id] : [];
  }
  if (!hasExplicitSelection && tokenIds.length === 0) return jsonSecure({ error: "Find and add a Warplet before confirming this emoji." }, { status: 400 });
  if (tokenIds.length > 10) return jsonSecure({ error: "An emoji can have no more than ten approved Warplets." }, { status: 400 });
  const selectedTokenIds = new Set(tokenIds);
  const removedTokenIds = Array.isArray(body.removedTokenIds)
    ? [...new Set(body.removedTokenIds.map(Number).filter((tokenId) => Number.isInteger(tokenId) && tokenId >= 1 && tokenId <= 10000 && !selectedTokenIds.has(tokenId)))]
    : [];

  const existingCount = await env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected'").bind(emoji).first<{ count: number }>();
  let eligibleCount = existingCount?.count ?? 0;
  for (const tokenId of tokenIds) {
    const candidate = await env.WARPLETS.prepare("SELECT token_id FROM warpmoji_candidates WHERE canonical_emoji = ? AND token_id = ?").bind(emoji, tokenId).first();
    if (!candidate) {
      await env.WARPLETS.prepare("INSERT INTO warpmoji_candidates (canonical_emoji, token_id, score, reasons_json, status, assignment, scoring_version) VALUES (?, ?, 1, '[\"manual-curation\"]', 'suggested', ?, 'warpmoji-manual-v1')")
        .bind(emoji, tokenId, eligibleCount === 0 ? "primary" : "secondary").run();
      eligibleCount += 1;
    }
  }

  const statements = [
    env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'suggested', reviewed_at = NULL, reviewed_by_fid = NULL, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND status = 'approved'").bind(emoji),
    ...tokenIds.map((tokenId) => env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(admin.fid, emoji, tokenId)),
    ...removedTokenIds.map((tokenId) => env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(admin.fid, emoji, tokenId)),
    ...removedTokenIds.map((tokenId) => env.WARPLETS.prepare(
      `INSERT INTO warpmoji_rejections (canonical_emoji, token_id, score, reasons_json, scoring_version, rejected_at, rejected_by_fid, restored_at)
       SELECT canonical_emoji, token_id, score, reasons_json, scoring_version, CURRENT_TIMESTAMP, ?, NULL
         FROM warpmoji_candidates
        WHERE canonical_emoji = ? AND token_id = ?
       ON CONFLICT(canonical_emoji, token_id) DO UPDATE SET
         score = excluded.score,
         reasons_json = excluded.reasons_json,
         scoring_version = excluded.scoring_version,
         rejected_by_fid = excluded.rejected_by_fid,
         rejected_at = CURRENT_TIMESTAMP,
         restored_at = NULL`,
    ).bind(admin.fid, emoji, tokenId)),
    ...tokenIds.map((tokenId) => env.WARPLETS.prepare("UPDATE warpmoji_rejections SET restored_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(emoji, tokenId)),
    env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected'), approved_count = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ?").bind(admin.fid, emoji, tokenIds.length, emoji),
  ];
  await env.WARPLETS.batch(statements);
  await auditWarpmoji(env.WARPLETS, admin.fid, "group.review", emoji, { approved: tokenIds.length, tokenIds, removedTokenIds });
  return jsonSecure({ ok: true, approved: tokenIds.length, tokenIds, removedTokenIds });
};
