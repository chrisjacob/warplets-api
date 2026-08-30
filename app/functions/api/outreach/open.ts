import {
  normalizeOutreachTrackingCode,
  recordHolderOutreachOpen,
} from "../../_lib/holderOutreach.js";
import {
  getClientIp,
  jsonSecure,
  rateLimit,
  readJsonBodyWithLimit,
} from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const ip = getClientIp(context.request);
  const limited = await rateLimit(context.env.WARPLETS_KV, "holder-outreach-open", ip, 60, 60);
  if (!limited.allowed) {
    const response = jsonSecure({ ok: false }, { status: 429 });
    response.headers.set("retry-after", String(limited.retryAfterSeconds));
    return response;
  }

  const parsed = await readJsonBodyWithLimit<{ trackingCode?: unknown }>(context.request, 1024);
  if (!parsed.ok) return parsed.response;
  const trackingCode = normalizeOutreachTrackingCode(
    typeof parsed.value.trackingCode === "string" ? parsed.value.trackingCode : null,
  );
  if (!trackingCode) return jsonSecure({ ok: false }, { status: 400 });

  await recordHolderOutreachOpen(context.env.WARPLETS, trackingCode);
  return jsonSecure({ ok: true });
};
