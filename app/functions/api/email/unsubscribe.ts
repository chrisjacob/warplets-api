/**
 * GET /api/email/unsubscribe?email=...&token=...
 *
 * CAN-SPAM / GDPR compliant unsubscribe endpoint.
 * Linked from email footers. Sets unsubscribed_at timestamp.
 *
 * Uses the verify_token stored on the row as the auth token —
 * it's a random UUID generated at signup, so only the subscriber
 * (who received the email) can unsubscribe.
 */

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
}
import { applySecurityHeaders, getClientIp, rateLimit } from "../../_lib/security.js";

function htmlResponse(status: number, title: string, message: string): Response {
  return applySecurityHeaders(new Response(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin:0; font-family: Arial, sans-serif; background:#040804; color:#d7ffd7; display:flex; min-height:100vh; align-items:center; justify-content:center; }
      .card { width:min(560px, 92vw); border:1px solid rgba(0,255,0,.35); background:rgba(0,0,0,.7); border-radius:16px; padding:24px; }
      h1 { margin:0 0 8px; color:#00FF00; font-size:24px; }
      p { margin:0; line-height:1.45; }
      a { color:#00FF00; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  ), { isHtml: true });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const ip = getClientIp(context.request);
  const ipRate = await rateLimit(context.env.WARPLETS_KV, "email-unsubscribe-ip", ip, 45, 60);
  if (!ipRate.allowed) {
    const response = htmlResponse(429, "Try again soon", "Too many unsubscribe attempts from this IP.");
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const url = new URL(context.request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();
  const token = url.searchParams.get("token")?.trim();

  if (!email || !token) {
    return htmlResponse(400, "Invalid link", "This unsubscribe link is missing required parameters.");
  }

  const row = await context.env.WARPLETS.prepare(
    `SELECT id, unsubscribed_at FROM email_waitlist WHERE email = ? AND verify_token = ? LIMIT 1`
  )
    .bind(email, token)
    .first<{ id: number; unsubscribed_at: string | null }>();

  if (!row) {
    return htmlResponse(400, "Invalid link", "This unsubscribe link is invalid or has already been used.");
  }

  if (row.unsubscribed_at) {
    return htmlResponse(200, "Already unsubscribed", "You have already been removed from our mailing list.");
  }

  await context.env.WARPLETS.prepare(
    `UPDATE email_waitlist SET unsubscribed_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(new Date().toISOString(), new Date().toISOString(), row.id)
    .run();

  return htmlResponse(
    200,
    "Unsubscribed",
    `You have been removed from the 10X Meme mailing list. You will not receive any further emails from us.<br><br><a href="https://10x.meme">Back to 10x.meme</a>`
  );
};
