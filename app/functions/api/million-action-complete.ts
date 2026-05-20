interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  NEYNAR_API_KEY?: string;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
}
import { jsonSecure, readJsonBodyWithLimit, verifyActionSessionToken } from "../_lib/security.js";
import { outboundFetch } from "../_lib/outbound.js";

interface RequestBody {
  actionSlug?: unknown;
  sessionToken?: unknown;
  fid?: unknown;
  verification?: unknown;
}

function currentGiveawayMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

async function resolveFid(context: EventContext<Env, string, unknown>, body: RequestBody): Promise<number | null> {
  const requestUrl = new URL(context.request.url);
  const sessionToken = asString(body.sessionToken);
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
  if (session.valid) return session.fid;

  const isLocalDevHost =
    requestUrl.hostname.includes("-local.") ||
    requestUrl.hostname.includes("-dev.") ||
    requestUrl.hostname.endsWith(".pages.dev") ||
    requestUrl.hostname === "127.0.0.1" ||
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "::1";
  const allowInsecureFallback =
    isLocalDevHost &&
    (context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK === "1" || isLocalDevHost);
  return allowInsecureFallback ? asPositiveInteger(body.fid) : null;
}

async function isFollowingFid(apiKey: string, viewerFid: number, targetFid: number): Promise<boolean> {
  if (viewerFid === targetFid) return true;
  const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${viewerFid}&fids=${targetFid}`;
  const response = await outboundFetch(endpoint, { headers: { "x-api-key": apiKey } });
  if (!response.ok) return false;
  const payload = (await response.json()) as { users?: Array<{ viewer_context?: { following?: boolean } }> };
  return Boolean(payload.users?.[0]?.viewer_context?.following);
}

async function verifyMillionAction(env: Env, actionSlug: string, fid: number): Promise<{ verified: boolean; verification: string | null; reason?: string }> {
  if (actionSlug === "million-enter-email") {
    const row = await env.WARPLETS.prepare(
      `SELECT email
       FROM email_waitlist
       WHERE fid = ?
         AND verified = 1
         AND unsubscribed_at IS NULL
       ORDER BY verified_at DESC, subscribed_at DESC
       LIMIT 1`
    )
      .bind(fid)
      .first<{ email: string }>();
    return row
      ? { verified: true, verification: `email:${row.email}` }
      : { verified: false, verification: null, reason: "Email is not verified yet." };
  }

  const apiKey = env.NEYNAR_API_KEY?.trim();
  if (actionSlug === "million-follow-fc-10xmeme" || actionSlug === "million-follow-fc-10xchris") {
    if (!apiKey) return { verified: false, verification: null, reason: "Missing Neynar API key." };
    const targetFid = actionSlug === "million-follow-fc-10xmeme" ? 1313340 : 1129138;
    const verified = await isFollowingFid(apiKey, fid, targetFid);
    return verified
      ? { verified: true, verification: `farcaster_follow:${targetFid}` }
      : { verified: false, verification: null, reason: "Follow not detected yet." };
  }

  return { verified: false, verification: null, reason: "Verification for this action is coming soon." };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!isPlainObject(parsed.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const body = parsed.value as RequestBody;
  const fid = await resolveFid(context, body);
  if (!fid) return jsonSecure({ error: "Unauthorized action session" }, { status: 401 });

  const actionSlug = asString(body.actionSlug)?.toLowerCase();
  if (!actionSlug) return jsonSecure({ error: "actionSlug is required" }, { status: 400 });

  const user = await context.env.WARPLETS.prepare(
    "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number }>();
  if (!user) return jsonSecure({ error: "Viewer record not found" }, { status: 404 });

  const action = await context.env.WARPLETS.prepare(
    "SELECT id, slug, entry_value FROM actions WHERE slug = ? AND app_slug = 'million' LIMIT 1"
  )
    .bind(actionSlug)
    .first<{ id: number; slug: string; entry_value: number }>();
  if (!action) return jsonSecure({ error: "Action not found" }, { status: 404 });

  const verified = await verifyMillionAction(context.env, action.slug, fid);
  if (!verified.verified) {
    return jsonSecure({
      ok: false,
      verified: false,
      actionSlug: action.slug,
      reason: verified.reason ?? "Action is not verified.",
    }, { status: 409 });
  }

  const giveawayMonth = currentGiveawayMonth();
  const now = new Date().toISOString();
  const entriesAwarded = Math.max(0, Number(action.entry_value ?? 0));

  if (action.slug === "million-enter-email") {
    const email = verified.verification?.startsWith("email:") ? verified.verification.slice("email:".length) : "";
    await context.env.WARPLETS.prepare(
      `INSERT INTO million_giveaway_entries (
         giveaway_month, user_id, user_fid, email, entry_source, created_on, updated_on
       ) VALUES (?, ?, ?, ?, 'email', ?, ?)
       ON CONFLICT(user_id, giveaway_month) DO UPDATE SET
         email = excluded.email,
         updated_on = excluded.updated_on`
    )
      .bind(giveawayMonth, user.id, fid, email, now, now)
      .run();
  }

  await context.env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO million_giveaway_action_entries (
       giveaway_month, action_id, action_slug, user_id, user_fid, entries_awarded, verification, created_on
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(giveawayMonth, action.id, action.slug, user.id, fid, entriesAwarded, verified.verification, now)
    .run();

  return jsonSecure({
    ok: true,
    verified: true,
    actionSlug: action.slug,
    entriesAwarded,
    giveawayMonth,
  });
};
