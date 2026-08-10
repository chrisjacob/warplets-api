import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../../_lib/security.js";

export const onRequestPost: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const body = await request.json<{ emoji?: unknown }>().catch(() => ({} as { emoji?: unknown }));
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  const group = emoji
    ? await env.WARPLETS.prepare("SELECT canonical_emoji FROM warpmoji_emoji_groups WHERE canonical_emoji = ?").bind(emoji).first()
    : null;
  if (!group) return jsonSecure({ error: "Emoji group was not found." }, { status: 404 });
  const best = await env.WARPLETS.prepare(
    "SELECT token_id FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected' ORDER BY score DESC, token_id ASC LIMIT 1",
  ).bind(emoji).first<{ token_id: number }>();
  if (!best) return jsonSecure({ error: "Find and add a Warplet before confirming this emoji." }, { status: 400 });
  await env.WARPLETS.batch([
    env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND token_id = ?").bind(admin.fid, emoji, best.token_id),
    env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, approved_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved'), updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ?").bind(admin.fid, emoji, emoji),
  ]);
  const approved = await env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved'").bind(emoji).first<{ count: number }>();
  await auditWarpmoji(env.WARPLETS, admin.fid, "group.review", emoji, { approved: approved?.count ?? 1, defaultTokenId: best.token_id });
  return jsonSecure({ ok: true, approved: approved?.count ?? 1, defaultTokenId: best.token_id });
};
