interface Env {
  WARPLETS: D1Database;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
}
import { jsonSecure, readJsonBodyWithLimit, verifyActionSessionToken } from "../_lib/security.js";

interface RequestBody {
  actionKey?: unknown;
  actionSlug?: unknown;
  auctionDay?: unknown;
  sessionToken?: unknown;
  fid?: unknown;
  payload?: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const X_URL_REGEX = /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com)\/.+/i;

const ACTION_POINTS = new Map<string, number>([
  ["once-opensea-1m", 1],
  ["once-opensea-10x", 1],
  ["once-follow-x", 2],
  ["once-post-x", 3],
  ["once-telegram", 2],
  ["once-discord", 2],
  ["once-join-farcaster", 2],
  ["once-follow-farcaster", 1],
  ["once-post-farcaster", 1],
  ["once-follow-channel", 1],
  ["once-add-million-app", 2],
  ["once-add-drop-app", 2],
  ["daily-opensea", 1],
  ["daily-follow-x", 1],
  ["daily-post-x", 3],
  ["tenx-list-warplet", 10],
  ["tenx-post-x", 5],
]);

function currentGrantMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentAuctionDay(now = new Date()): number {
  const cycleStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
  const rawDay = Math.floor((now.getTime() - cycleStart) / DAY_MS) + 1;
  return Math.min(30, Math.max(1, rawDay));
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

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
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
  return isLocalDevHost || context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK === "1" ? asPositiveInteger(body.fid) : null;
}

function normalizePayload(actionKey: string, rawPayload: unknown) {
  const payload = isPlainObject(rawPayload) ? rawPayload : {};
  if (actionKey === "tenx-list-warplet") {
    const path = asString(payload.path) ?? "listing";
    if (!["own", "buy", "alternative"].includes(path)) {
      return { ok: false as const, error: "Choose a 10X action path." };
    }
    if (path === "alternative") {
      const answer2 = asString(payload.answer2);
      if (!answer2 || wordCount(answer2) > 25) return { ok: false as const, error: "Answer must be 25 words or less." };
      return { ok: true as const, payload: { path, answer2 } };
    }
    const xPostUrl = asString(payload.xPostUrl);
    if (!xPostUrl || !X_URL_REGEX.test(xPostUrl)) return { ok: false as const, error: "Enter a valid X post URL." };
    return { ok: true as const, payload: { path, xPostUrl } };
  }
  if (actionKey === "tenx-post-x") {
    const answer2 = asString(payload.answer2);
    if (!answer2 || wordCount(answer2) > 25) return { ok: false as const, error: "Answer must be 25 words or less." };
    return { ok: true as const, payload: { answer2 } };
  }
  return { ok: true as const, payload };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 12 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!isPlainObject(parsed.value)) return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });

  const body = parsed.value as RequestBody;
  const fid = await resolveFid(context, body);
  if (!fid) return jsonSecure({ error: "Unauthorized action session" }, { status: 401 });

  const actionKey = (asString(body.actionKey) ?? asString(body.actionSlug))?.toLowerCase();
  if (!actionKey) return jsonSecure({ error: "actionKey is required" }, { status: 400 });
  const points = ACTION_POINTS.get(actionKey);
  if (!points) return jsonSecure({ error: "Action not found" }, { status: 404 });

  const user = await context.env.WARPLETS.prepare("SELECT id FROM warplets_users WHERE fid = ? LIMIT 1")
    .bind(fid)
    .first<{ id: number }>();
  if (!user) return jsonSecure({ error: "Viewer record not found" }, { status: 404 });

  const grantMonth = currentGrantMonth();
  const grantApplication = await context.env.WARPLETS.prepare(
    `SELECT mga.id, mga.status, COALESCE(ew.verified, 0) AS email_verified
     FROM million_grant_applications mga
     LEFT JOIN email_waitlist ew ON LOWER(ew.email) = LOWER(mga.email)
     WHERE mga.user_id = ? AND mga.grant_month = ?
     LIMIT 1`
  )
    .bind(user.id, grantMonth)
    .first<{ id: number; status: string; email_verified: number }>();
  if (!grantApplication || grantApplication.email_verified !== 1 || grantApplication.status !== "accepted") {
    return jsonSecure({
      ok: false,
      verified: false,
      reason: "Complete your Grant Application before entering 10X Attention.",
    }, { status: 409 });
  }

  const auctionDay = actionKey.startsWith("daily-") ? currentAuctionDay() : 0;
  const requestedDay = asPositiveInteger(body.auctionDay);
  if (actionKey.startsWith("daily-") && requestedDay && requestedDay !== auctionDay) {
    return jsonSecure({ error: "Daily action is only available for the current auction day." }, { status: 409 });
  }

  const normalized = normalizePayload(actionKey, body.payload);
  if (!normalized.ok) return jsonSecure({ error: normalized.error }, { status: 400 });

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO million_attention_completions (
       grant_month, user_id, user_fid, action_key, auction_day, points_awarded, payload_json, created_on, updated_on
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(grantMonth, user.id, fid, actionKey, auctionDay, points, JSON.stringify(normalized.payload), now, now)
    .run();

  const row = await context.env.WARPLETS.prepare(
    `SELECT points_awarded, payload_json
     FROM million_attention_completions
     WHERE user_id = ? AND grant_month = ? AND action_key = ? AND auction_day = ?
     LIMIT 1`
  )
    .bind(user.id, grantMonth, actionKey, auctionDay)
    .first<{ points_awarded: number; payload_json: string | null }>();

  return jsonSecure({
    ok: true,
    verified: true,
    actionKey,
    auctionDay,
    pointsAwarded: Number(row?.points_awarded ?? points),
    payload: row?.payload_json ? JSON.parse(row.payload_json) : normalized.payload,
    grantMonth,
  });
};
