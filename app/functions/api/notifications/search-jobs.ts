import { jsonSecure, requireAdminScope } from "../../_lib/security.js";
import {
  runBestFriendNotifications,
  runGlobalStatsNotifications,
  runSearchNotificationJobs,
} from "../../_lib/warpletNotifications.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:send" });
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const job = url.searchParams.get("job") || "all";

  if (job === "best-friends") {
    return jsonSecure({ ok: true, job, queued: await runBestFriendNotifications(context.env) });
  }

  if (job === "global-stats") {
    return jsonSecure({ ok: true, job, queued: await runGlobalStatsNotifications(context.env) });
  }

  return jsonSecure({ ok: true, job: "all", result: await runSearchNotificationJobs(context.env) });
};
