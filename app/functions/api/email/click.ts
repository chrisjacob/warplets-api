interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
}
import { applySecurityHeaders, getClientIp, rateLimit } from "../../_lib/security.js";

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const ip = getClientIp(context.request);
  const ipRate = await rateLimit(context.env.WARPLETS_KV, "email-click-ip", ip, 120, 60);
  if (!ipRate.allowed) {
    const response = new Response("Too many requests", { status: 429 });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return applySecurityHeaders(response);
  }

  const requestUrl = new URL(context.request.url);
  const target = requestUrl.searchParams.get("url")?.trim();
  const sendId = requestUrl.searchParams.get("sendId")?.trim() ?? null;
  const email = requestUrl.searchParams.get("email")?.trim().toLowerCase() ?? null;

  if (!target) {
    return applySecurityHeaders(new Response("Missing url query parameter", { status: 400 }));
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target);
  } catch {
    return applySecurityHeaders(new Response("Invalid target URL", { status: 400 }));
  }

  if (!ALLOWED_PROTOCOLS.has(parsedTarget.protocol)) {
    return applySecurityHeaders(new Response("Unsupported target URL", { status: 400 }));
  }

  await context.env.WARPLETS.prepare(
    `INSERT INTO email_clicks (send_id, email, url, clicked_at) VALUES (?, ?, ?, ?)`
  )
    .bind(sendId, email, parsedTarget.toString(), new Date().toISOString())
    .run();

  return applySecurityHeaders(Response.redirect(parsedTarget.toString(), 302));
};
