import { getAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { requireSameOrigin } from "../../../_lib/authValidation.js";
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
  const now = new Date().toISOString();
  if (action === "click") {
    await context.env.WARPLETS.prepare(
      `UPDATE notification_channel_deliveries
       SET clicked_at = COALESCE(clicked_at, ?), opened_at = COALESCE(opened_at, ?), updated_at = ?
       WHERE campaign_id = ? AND channel = 'base' AND recipient_key = ?`,
    ).bind(now, now, now, campaignId, session.walletAddress).run();
  } else {
    await context.env.WARPLETS.prepare(
      `UPDATE notification_channel_deliveries SET opened_at = COALESCE(opened_at, ?), updated_at = ?
       WHERE campaign_id = ? AND channel = 'base' AND recipient_key = ?`,
    ).bind(now, now, campaignId, session.walletAddress).run();
  }
  return jsonSecure({ ok: true });
};
