import { getAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { resolveAppSlugFromUrl } from "../../../_lib/appSlug.js";
import { requireSameOrigin } from "../../../_lib/authValidation.js";
import { recordNotificationChannelInteraction } from "../../../_lib/notificationChannelTracking.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface OpenPayload { campaignId?: unknown; action?: unknown }

export const onRequestPost: PagesFunction<AppAuthEnv> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const session = await getAppSession(context.request, context.env);
  if (!session?.walletAddress) return jsonSecure({ error: "verified wallet session required" }, { status: 401 });
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<OpenPayload>(parsed.value, ["campaignId", "action"]);
  if (!payload.ok) return payload.response;
  const campaignId = typeof payload.payload.campaignId === "string" ? payload.payload.campaignId.trim().slice(0, 128) : "";
  const action = payload.payload.action === "click" ? "click" : "open";
  if (!campaignId) return jsonSecure({ error: "campaignId is required" }, { status: 400 });
  await recordNotificationChannelInteraction(context.env.WARPLETS, {
    campaignId,
    appSlug: resolveAppSlugFromUrl(new URL(context.request.url)),
    channel: "base",
    recipientKey: session.walletAddress,
    action,
  });
  return jsonSecure({ ok: true });
};
