import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../_lib/security.js";

export const onRequestPatch: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const body = await request.json<{ emoji?: unknown; tokenId?: unknown; action?: unknown }>().catch(() => ({} as { emoji?: unknown; tokenId?: unknown; action?: unknown }));
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  const tokenId = Number(body.tokenId);
  const action = body.action === "add" ? "add" : body.action === "remove" ? "remove" : null;
  if (!emoji || !Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10000 || !action) return jsonSecure({ error: "Invalid match update." }, { status: 400 });
  const row = await env.WARPLETS.prepare("SELECT score, reasons_json, scoring_version FROM warpmoji_candidates WHERE canonical_emoji = ? AND token_id = ?")
    .bind(emoji, tokenId).first<{ score: number; reasons_json: string; scoring_version: string }>();
  if (!row && action === "remove") return jsonSecure({ error: "Candidate not found." }, { status: 404 });
  if (action === "remove") {
    await env.WARPLETS.batch([
      env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(admin.fid, emoji, tokenId),
      env.WARPLETS.prepare("INSERT INTO warpmoji_rejections (canonical_emoji, token_id, score, reasons_json, scoring_version, rejected_by_fid) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(canonical_emoji, token_id) DO UPDATE SET restored_at = NULL, rejected_at = CURRENT_TIMESTAMP, rejected_by_fid = excluded.rejected_by_fid").bind(emoji, tokenId, row!.score, row!.reasons_json, row!.scoring_version, admin.fid),
      env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET reviewed_at = NULL, approved_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved'), updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ?").bind(emoji, emoji),
    ]);
  } else {
    const rejected = await env.WARPLETS.prepare("SELECT score, reasons_json, scoring_version FROM warpmoji_rejections WHERE canonical_emoji = ? AND token_id = ? AND restored_at IS NULL").bind(emoji, tokenId).first<{ score: number; reasons_json: string; scoring_version: string }>();
    await env.WARPLETS.batch([
      env.WARPLETS.prepare("INSERT INTO warpmoji_candidates (canonical_emoji, token_id, score, reasons_json, status, assignment, scoring_version) VALUES (?, ?, ?, ?, 'suggested', 'secondary', ?) ON CONFLICT(canonical_emoji, token_id) DO UPDATE SET status = 'suggested', reviewed_at = NULL, reviewed_by_fid = NULL, updated_at = CURRENT_TIMESTAMP").bind(emoji, tokenId, rejected?.score ?? row?.score ?? 0.55, rejected?.reasons_json ?? row?.reasons_json ?? "[]", rejected?.scoring_version ?? row?.scoring_version ?? "warpmoji-v1"),
      env.WARPLETS.prepare("UPDATE warpmoji_rejections SET restored_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(emoji, tokenId),
      env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET reviewed_at = NULL, candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ?), approved_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved'), updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ?").bind(emoji, emoji, emoji),
    ]);
  }
  await auditWarpmoji(env.WARPLETS, admin.fid, `match.${action}`, `${emoji}:${tokenId}`);
  return jsonSecure({ ok: true, action });
};
