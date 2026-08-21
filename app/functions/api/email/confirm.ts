import {
  confirmEmailIdentityClaim,
  findEmailIdentityClaim,
  type EmailIdentityEnv,
} from "../../_lib/emailIdentityClaims.js";
import { applySecurityHeaders, getClientIp, rateLimit } from "../../_lib/security.js";

interface Env extends EmailIdentityEnv {
  WARPLETS_KV?: KVNamespace;
}

function page(status: number, title: string, message: string, formToken?: string): Response {
  const form = formToken
    ? `<form method="post" action="/api/email/confirm">
        <input type="hidden" name="token" value="${formToken}">
        <button type="submit">Confirm Subscription</button>
      </form>`
    : "";
  const response = new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030803;color:#dfffe0;font-family:Arial,sans-serif}
main{width:min(560px,calc(100vw - 40px));box-sizing:border-box;padding:28px;border:1px solid #087c13;border-radius:18px;background:#061006}
h1{margin:0 0 12px;color:#00ff24;font-size:26px}p{line-height:1.55;margin:0 0 20px}
button{width:100%;border:1px solid #00b51a;border-radius:10px;padding:13px 18px;background:#00ff24;color:#032b08;font-weight:800;font-size:16px;cursor:pointer}
</style></head><body><main><h1>${title}</h1><p>${message}</p>${form}</main></body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
  const secured = applySecurityHeaders(response, { isHtml: true });
  const headers = new Headers(secured.headers);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("referrer-policy", "no-referrer");
  return new Response(secured.body, { status: secured.status, statusText: secured.statusText, headers });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  const claim = token ? await findEmailIdentityClaim(env.WARPLETS, token) : null;
  if (!claim) return page(404, "Invalid confirmation link", "This link is invalid or is no longer available.");
  if (claim.status === "synced" || claim.status === "confirmed_pending_sync") {
    return page(200, "Already confirmed", "Your subscription has already been confirmed.");
  }
  if (claim.status !== "pending") {
    return page(410, "Link no longer active", "A newer confirmation request may have replaced this link.");
  }
  if (Date.parse(claim.expires_at) <= Date.now()) {
    return page(410, "Confirmation link expired", "Please return to 10X and submit the form again.");
  }
  return page(
    200,
    "Confirm your subscription",
    "Complete this final step to confirm that you own this email address and want 10X community updates.",
    token,
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ipRate = await rateLimit(env.WARPLETS_KV, "email-confirm-ip", getClientIp(request), 30, 60 * 60);
  if (!ipRate.allowed) {
    const response = page(429, "Try again later", "Too many confirmation attempts were made.");
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }
  const contentType = request.headers.get("content-type") ?? "";
  let token = "";
  if (contentType.includes("application/json")) {
    const body: Record<string, unknown> = await request.json<Record<string, unknown>>().catch(() => ({}));
    token = String(body.token ?? "").trim();
  } else {
    token = String((await request.formData().catch(() => new FormData())).get("token") ?? "").trim();
  }
  const result = await confirmEmailIdentityClaim({ env, token });
  if (result.status === "invalid") return page(404, "Invalid confirmation link", "This link is invalid or is no longer available.");
  if (result.status === "expired") return page(410, "Confirmation link expired", "Please return to 10X and submit the form again.");
  if (!result.synced) {
    return page(202, "Subscription confirmed", "Your email is confirmed. We are finishing the subscription in the background.");
  }
  return page(200, "Subscription confirmed", "You're subscribed to 10X community updates.");
};
