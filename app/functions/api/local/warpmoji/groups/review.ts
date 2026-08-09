import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../../_lib/security.js";

export const onRequestPost: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const body = await request.json<{ emoji?: unknown }>().catch(() => ({} as { emoji?: unknown }));
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  const count = await env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM warpmoji_candidates WHERE canonical_emoji = ? AND status != 'rejected'").bind(emoji).first<{ count: number }>();
  if (!emoji || !count || count.count > 10) return jsonSecure({ error: "Retain no more than ten candidates before marking this emoji reviewed." }, { status: 400 });
  await env.WARPLETS.batch([
    env.WARPLETS.prepare("UPDATE warpmoji_candidates SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ? AND status != 'rejected'").bind(admin.session.farcasterFid, emoji),
    env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET reviewed_at = CURRENT_TIMESTAMP, reviewed_by_fid = ?, approved_count = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ?").bind(admin.session.farcasterFid, count.count, emoji),
  ]);
  await auditWarpmoji(env.WARPLETS, admin.session.farcasterFid!, "group.review", emoji, { approved: count.count });
  return jsonSecure({ ok: true, approved: count.count });
};
