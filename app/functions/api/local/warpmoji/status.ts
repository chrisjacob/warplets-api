import { requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../_lib/security.js";

export const onRequestGet: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env);
  if (admin instanceof Response) return admin;
  try {
    const [settings, groups, events, jobs, rejects, topEmoji, topTokens, shards, opens] = await Promise.all([
      env.WARPLETS.prepare("SELECT * FROM warpmoji_settings WHERE singleton = 1").first(),
      env.WARPLETS.prepare("SELECT COUNT(*) AS total, SUM(reviewed_at IS NOT NULL) AS reviewed, SUM(approved_count > 0) AS approved, SUM(candidate_count = 0) AS no_candidates FROM warpmoji_emoji_groups").first(),
      env.WARPLETS.prepare("SELECT event_class, status, COUNT(*) AS count FROM warpmoji_events WHERE created_at >= datetime('now','-24 hours') GROUP BY event_class, status").all(),
      env.WARPLETS.prepare("SELECT kind, status, COUNT(*) AS count, MAX(attempts) AS max_attempts, ROUND(AVG(last_latency_ms)) AS average_latency_ms, SUM(last_http_status = 429) AS neynar_429s, SUM(estimated_credits) AS estimated_credits FROM warpmoji_jobs GROUP BY kind, status").all(),
      env.WARPLETS.prepare("SELECT COALESCE(rejection_reason,'none') AS reason, COUNT(*) AS count FROM warpmoji_events WHERE status = 'rejected' AND created_at >= datetime('now','-24 hours') GROUP BY rejection_reason ORDER BY count DESC").all(),
      env.WARPLETS.prepare("SELECT canonical_emoji, COUNT(*) AS count FROM warpmoji_events WHERE canonical_emoji IS NOT NULL GROUP BY canonical_emoji ORDER BY count DESC LIMIT 20").all(),
      env.WARPLETS.prepare("SELECT token_id, COUNT(*) AS count FROM warpmoji_events WHERE token_id IS NOT NULL GROUP BY token_id ORDER BY count DESC LIMIT 20").all(),
      env.WARPLETS.prepare("SELECT id, kind, alias_count, status, last_synced_at, last_error FROM warpmoji_webhook_shards ORDER BY kind, id").all(),
      env.WARPLETS.prepare("SELECT source, trigger, SUM(opens) AS opens FROM warpmoji_attribution_daily WHERE day >= date('now','-30 days') GROUP BY source, trigger ORDER BY opens DESC").all(),
    ]);
    return jsonSecure({ settings, groups, events: events.results, jobs: jobs.results, rejectionReasons: rejects.results, topEmoji: topEmoji.results, topWarplets: topTokens.results, shards: shards.results, opens: opens.results, estimatedCreditsPerSuccess: 160, csrfToken: admin.csrfToken });
  } catch (error) {
    return jsonSecure({ error: "Warpmoji data is not initialized. Apply migrations 0051 and 0052.", detail: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
};
