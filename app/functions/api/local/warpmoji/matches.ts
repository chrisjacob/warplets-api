import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../_lib/security.js";

type CandidateRow = {
  score: number;
  reasons_json: string;
  scoring_version: string;
  status: "suggested" | "approved" | "rejected";
  assignment: "primary" | "secondary";
};

export const onRequestPatch: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const body = await request.json<{ emoji?: unknown; tokenId?: unknown; action?: unknown }>().catch(() => ({} as { emoji?: unknown; tokenId?: unknown; action?: unknown }));
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  const tokenId = Number(body.tokenId);
  const action = body.action === "add" ? "add" : body.action === "remove" ? "remove" : null;
  if (!emoji || !Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10000 || !action) return jsonSecure({ error: "Invalid match update." }, { status: 400 });
  const group = await env.WARPLETS.prepare("SELECT canonical_emoji FROM warpmoji_emoji_groups WHERE canonical_emoji = ?").bind(emoji).first();
  if (!group) return jsonSecure({ error: "Emoji group was not found." }, { status: 404 });
  let row = await env.WARPLETS.prepare("SELECT score, reasons_json, scoring_version, status, assignment FROM warpmoji_candidates WHERE canonical_emoji = ? AND token_id = ?")
    .bind(emoji, tokenId).first<CandidateRow>();
  if (action === "remove") {
    if (!row || row.status !== "approved") return jsonSecure({ error: "Approved match was not found." }, { status: 404 });
    const manuallyAdded = row.reasons_json.includes("manual-curation");
    const statements = [
      env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = ?, reviewed_at = NULL, reviewed_by_fid = NULL, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(manuallyAdded ? "rejected" : "suggested", emoji, tokenId),
    ];
    if (manuallyAdded) {
      statements.push(env.WARPLETS.prepare("INSERT INTO warpmoji_rejections (canonical_emoji, token_id, score, reasons_json, scoring_version, rejected_by_fid) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(canonical_emoji, token_id) DO UPDATE SET restored_at = NULL, rejected_at = CURRENT_TIMESTAMP, rejected_by_fid = excluded.rejected_by_fid").bind(emoji, tokenId, row.score, row.reasons_json, row.scoring_version, admin.fid));
    }
    statements.push(env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET reviewed_at = CASE WHEN EXISTS (SELECT 1 FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved') THEN reviewed_at ELSE NULL END, reviewed_by_fid = CASE WHEN EXISTS (SELECT 1 FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved') THEN reviewed_by_fid ELSE NULL END, candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected'), approved_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved'), updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ?").bind(emoji, emoji, emoji, emoji, emoji));
    await env.WARPLETS.batch(statements);
  } else {
    const approvedBefore = await env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved'").bind(emoji).first<{ count: number }>();
    if (row?.status !== "approved" && (approvedBefore?.count ?? 0) >= 10) {
      return jsonSecure({ error: "An emoji can have no more than ten approved Warplets." }, { status: 400 });
    }
    const rejected = await env.WARPLETS.prepare("SELECT score, reasons_json, scoring_version FROM warpmoji_rejections WHERE canonical_emoji = ? AND token_id = ? AND restored_at IS NULL").bind(emoji, tokenId).first<{ score: number; reasons_json: string; scoring_version: string }>();
    if (!row) {
      const existing = await env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected'").bind(emoji).first<{ count: number }>();
      await env.WARPLETS.prepare("INSERT INTO warpmoji_candidates (canonical_emoji, token_id, score, reasons_json, status, assignment, scoring_version) VALUES (?, ?, ?, ?, 'suggested', ?, ?)")
        .bind(
          emoji,
          tokenId,
          rejected?.score ?? 1,
          rejected?.reasons_json ?? JSON.stringify(["manual-curation"]),
          (existing?.count ?? 0) === 0 ? "primary" : "secondary",
          rejected?.scoring_version ?? "warpmoji-manual-v1",
        ).run();
      row = await env.WARPLETS.prepare("SELECT score, reasons_json, scoring_version, status, assignment FROM warpmoji_candidates WHERE canonical_emoji = ? AND token_id = ?")
        .bind(emoji, tokenId).first<CandidateRow>();
    } else if (row.status === "rejected") {
      await env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'suggested', reviewed_at = NULL, reviewed_by_fid = NULL, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?")
        .bind(emoji, tokenId).run();
    }
    const best = await env.WARPLETS.prepare("SELECT token_id, status FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected' ORDER BY score DESC, token_id ASC LIMIT 1")
      .bind(emoji).first<{ token_id: number; status: "suggested" | "approved" }>();
    if (!best) return jsonSecure({ error: "No eligible Warpmoji candidate was found." }, { status: 400 });
    const additions = new Set<number>();
    if (row?.status !== "approved") additions.add(tokenId);
    if (best.status !== "approved") additions.add(best.token_id);
    if ((approvedBefore?.count ?? 0) + additions.size > 10) {
      return jsonSecure({ error: "An emoji can have no more than ten approved Warplets." }, { status: 400 });
    }
    await env.WARPLETS.batch([
      env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id IN (?, ?)").bind(admin.fid, emoji, best.token_id, tokenId),
      env.WARPLETS.prepare("UPDATE warpmoji_rejections SET restored_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(emoji, tokenId),
      env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected'), approved_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved'), updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ?").bind(admin.fid, emoji, emoji, emoji),
    ]);
  }
  await auditWarpmoji(env.WARPLETS, admin.fid, `match.${action}`, `${emoji}:${tokenId}`);
  return jsonSecure({ ok: true, action });
};
