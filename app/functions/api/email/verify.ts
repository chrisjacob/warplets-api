interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  SECURITY_LOG_SALT?: string;
}
import { applySecurityHeaders, getClientIp, logSecurityEvent, rateLimit } from "../../_lib/security.js";

const DROP_UNLOCK_ACTION_SLUGS = [
  "drop-cast",
  "drop-tweet",
  "drop-follow-fc-10xmeme",
  "drop-follow-fc-10xchris",
  "drop-follow-x-10xmeme",
  "drop-follow-x-10xchris",
  "drop-join-fc-channel",
  "drop-join-telegram",
  "drop-waitlist-email",
  "drop-email-10x",
] as const;
const DROP_REWARD_REQUIRED_ACTIONS = 10;

async function syncWaitlistActionCompletion(db: D1Database, fid: number, email: string): Promise<void> {
  const user = await db
    .prepare("SELECT id FROM warplets_users WHERE fid = ? LIMIT 1")
    .bind(fid)
    .first<{ id: number }>();
  if (!user) return;

  const action = await db
    .prepare("SELECT id, slug, app_slug FROM actions WHERE slug = 'drop-waitlist-email' LIMIT 1")
    .first<{ id: number; slug: string; app_slug: string }>();
  if (!action) return;

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO actions_completed (
         action_id, action_slug, user_id, user_fid, verification, created_on
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(action.id, action.slug, user.id, fid, `email:${email}`, now)
    .run();

  let totalActions = 0;
  let completedActions = 0;
  if (action.app_slug === "drop") {
    totalActions = DROP_REWARD_REQUIRED_ACTIONS;
    const placeholders = DROP_UNLOCK_ACTION_SLUGS.map(() => "?").join(", ");
    const completed = await db
      .prepare(
        `SELECT COUNT(DISTINCT action_slug) AS completed_actions
         FROM actions_completed
         WHERE user_id = ?
           AND action_slug IN (${placeholders})`
      )
      .bind(user.id, ...DROP_UNLOCK_ACTION_SLUGS)
      .first<{ completed_actions: number }>();
    completedActions = Number(completed?.completed_actions ?? 0);
  } else {
    const totals = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM actions WHERE app_slug = ?) AS total_actions,
           (SELECT COUNT(*)
              FROM actions_completed ac
              JOIN actions a ON a.id = ac.action_id
             WHERE ac.user_id = ?
               AND a.app_slug = ?) AS completed_actions`
      )
      .bind(action.app_slug, user.id, action.app_slug)
      .first<{ total_actions: number; completed_actions: number }>();
    totalActions = Number(totals?.total_actions ?? 0);
    completedActions = Number(totals?.completed_actions ?? 0);
  }

  if (totalActions > 0 && completedActions >= totalActions) {
    await db
      .prepare("UPDATE warplets_users SET rewarded_on = COALESCE(NULLIF(rewarded_on, ''), ?), updated_on = ? WHERE id = ?")
      .bind(now, now, user.id)
      .run();
  }
}

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
  const ipRate = await rateLimit(context.env.WARPLETS_KV, "email-verify-ip", ip, 45, 60);
  if (!ipRate.allowed) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "rate_limit",
      outcome: "email_verify_rate_limited",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    const response = htmlResponse(429, "Try again soon", "Too many verification attempts from this IP.");
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const url = new URL(context.request.url);
  const token = url.searchParams.get("token")?.trim();

  if (!token) {
    return htmlResponse(400, "Missing token", "The verification link is missing a token.");
  }

  const row = await context.env.WARPLETS.prepare(
    `SELECT id, verified, fid, email FROM email_waitlist WHERE verify_token = ? LIMIT 1`
  )
    .bind(token)
    .first<{ id: number; verified: number; fid: number | null; email: string }>();

  if (!row) {
    return htmlResponse(404, "Invalid link", "This verification link is invalid or has expired.");
  }

  if (row.verified === 1) {
    return htmlResponse(200, "Already verified", "Your email is already verified. You are all set.");
  }

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    `UPDATE email_waitlist
     SET verified = 1, verified_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, row.id)
    .run();

  if (typeof row.fid === "number" && row.fid > 0) {
    await syncWaitlistActionCompletion(context.env.WARPLETS, row.fid, row.email);
  }

  return htmlResponse(200, "Email verified", "Success. Your email is verified and your waitlist spot is confirmed.");
};
