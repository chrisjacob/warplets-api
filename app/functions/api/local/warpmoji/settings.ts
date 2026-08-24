import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../_lib/security.js";

export const onRequestPatch: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const mode = ["disabled", "shadow", "live"].includes(String(body.mode)) ? String(body.mode) : null;
  const numeric = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(body[key]);
    return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
  };
  const current = await env.WARPLETS.prepare("SELECT * FROM warpmoji_settings WHERE singleton = 1").first<Record<string, unknown>>();
  if (!current) return jsonSecure({ error: "Warpmoji settings are not initialized." }, { status: 503 });
  const next = {
    mode: mode ?? String(current.mode),
    organicUser: numeric("organicUser24h", Number(current.organic_user_24h), 0, 20),
    organicDaily: numeric("organicDaily", Number(current.organic_daily), 0, 900),
    mentionUser: numeric("mentionUser24h", Number(current.mention_user_24h), 0, 50),
    mentionDaily: numeric("mentionDaily", Number(current.mention_daily), 0, 900),
    combined: numeric("combinedDaily", Number(current.combined_daily), 0, 900),
  };
  await env.WARPLETS.prepare("UPDATE warpmoji_settings SET mode = ?, organic_user_24h = ?, organic_daily = ?, mention_user_24h = ?, mention_daily = ?, combined_daily = ?, updated_at = CURRENT_TIMESTAMP, updated_by_fid = ? WHERE singleton = 1")
    .bind(next.mode, next.organicUser, next.organicDaily, next.mentionUser, next.mentionDaily, next.combined, admin.fid).run();
  await auditWarpmoji(env.WARPLETS, admin.fid, "settings.update", "singleton", next);
  return jsonSecure({ ok: true, settings: next, projectedDailyCredits: next.combined * 160 });
};
