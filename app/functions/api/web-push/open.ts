import { resolveAppSlugFromUrl } from "../../_lib/appSlug.js";
import { recordNotificationChannelInteraction } from "../../_lib/notificationChannelTracking.js";
import { jsonSecure, readJsonBodyWithLimit } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
}

interface OpenBody {
  notificationId?: unknown;
  recipientKey?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const parsed = await readJsonBodyWithLimit<OpenBody>(request, 2 * 1024);
  if (!parsed.ok) return parsed.response;
  const notificationId = typeof parsed.value.notificationId === "string" ? parsed.value.notificationId.trim() : "";
  const recipientKey = typeof parsed.value.recipientKey === "string" ? parsed.value.recipientKey.trim().toLowerCase() : "";
  if (!notificationId || notificationId.length > 128 || !/^[a-f0-9]{64}$/.test(recipientKey)) {
    return jsonSecure({ error: "Invalid Web Push open event" }, { status: 400 });
  }
  const appSlug = resolveAppSlugFromUrl(new URL(request.url));
  await recordNotificationChannelInteraction(env.WARPLETS, {
    campaignId: notificationId,
    appSlug,
    channel: "web-push",
    recipientKey,
    action: "click",
  });
  return jsonSecure({ ok: true });
};
