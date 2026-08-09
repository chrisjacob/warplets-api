import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../_lib/security.js";

export const onRequestPost: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const result = await env.WARPLETS.prepare("DELETE FROM warpmoji_candidates WHERE status = 'rejected' AND EXISTS (SELECT 1 FROM warpmoji_rejections r WHERE r.canonical_emoji = warpmoji_candidates.canonical_emoji AND r.token_id = warpmoji_candidates.token_id AND r.restored_at IS NULL)").run();
  await env.WARPLETS.prepare("UPDATE warpmoji_emoji_groups SET candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates c WHERE c.canonical_emoji = warpmoji_emoji_groups.canonical_emoji), updated_at = CURRENT_TIMESTAMP").run();
  await auditWarpmoji(env.WARPLETS, admin.fid, "cleanup", "rejected-candidates", { removed: result.meta.changes });
  return jsonSecure({ ok: true, removed: result.meta.changes, restoreArchivePreserved: true });
};
