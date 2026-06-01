interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
  SECURITY_LOG_SALT?: string;
  RECAPTCHA_SECRET_KEY?: string;
}
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBodyWithLimit,
  sha256Hex,
  verifyActionSessionToken,
} from "../../_lib/security.js";
import { outboundFetch } from "../../_lib/outbound.js";

type ApplyBody = {
  fid?: unknown;
  sessionToken?: unknown;
  fullName?: unknown;
  email?: unknown;
  buildAnswer?: unknown;
  xPostUrl?: unknown;
  grant?: unknown;
  recaptchaToken?: unknown;
};

type ConfigMap = Record<string, string>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function currentMonth(now = new Date()): string {
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
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
}

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname.includes("-local.") ||
    hostname.includes("-dev.") ||
    hostname.endsWith(".pages.dev") ||
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1"
  );
}

async function resolveFid(context: EventContext<Env, string, unknown>, body: ApplyBody): Promise<number | null> {
  const requestUrl = new URL(context.request.url);
  const sessionToken = asString(body.sessionToken);
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
  if (session.valid) return session.fid;
  if (!isLocalDevHost(requestUrl.hostname) && context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK !== "1") return null;
  return asPositiveInteger(body.fid);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function optionalUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function loadConfig(db: D1Database): Promise<ConfigMap> {
  try {
    const rows = await db.prepare("SELECT key, value FROM million_app_config").all<{ key: string; value: string }>();
    return Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.value]));
  } catch {
    return {};
  }
}

function configNumber(config: ConfigMap, key: string, fallback: number): number {
  const parsed = Number(config[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function verifyRecaptcha(secret: string | undefined, token: string | null): Promise<number | null> {
  const trimmedSecret = secret?.trim();
  if (!trimmedSecret || !token) return null;
  try {
    const body = new URLSearchParams({ secret: trimmedSecret, response: token });
    const response = await outboundFetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { score?: unknown; success?: unknown };
    return payload.success === true && typeof payload.score === "number" ? payload.score : null;
  } catch {
    return null;
  }
}

function cloudflareThreatScore(request: Request): number | null {
  const cf = request.cf as { threatScore?: unknown; botManagement?: { score?: unknown } } | undefined;
  if (typeof cf?.threatScore === "number") return cf.threatScore;
  return null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const ip = getClientIp(context.request);
  const requestUrl = new URL(context.request.url);
  const config = await loadConfig(context.env.WARPLETS);
  const hourlyLimit = configNumber(config, "same_ip_hour_submit_limit", 20);
  const rate = await rateLimit(context.env.WARPLETS_KV, "million-grant-apply-ip", ip, hourlyLimit, 3600);
  if (!rate.allowed) {
    const response = jsonSecure({ error: "Too many applications from this network. Please try again later." }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 12 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!isPlainObject(parsed.value)) return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  const hasUnexpectedKeys = Object.keys(parsed.value).some(
    (key) => !["fid", "sessionToken", "fullName", "email", "buildAnswer", "xPostUrl", "grant", "recaptchaToken"].includes(key)
  );
  if (hasUnexpectedKeys) return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });

  const body = parsed.value as ApplyBody;
  const fullName = asString(body.fullName);
  const email = asString(body.email)?.toLowerCase() ?? "";
  const buildAnswer = asString(body.buildAnswer);
  const referrerApplicationId = asPositiveInteger(body.grant);
  if (!fullName || fullName.length > 120) return jsonSecure({ error: "Full name is required." }, { status: 400 });
  if (!email || !EMAIL_REGEX.test(email)) return jsonSecure({ error: "A valid email is required." }, { status: 400 });
  if (!buildAnswer || wordCount(buildAnswer) > 25) {
    return jsonSecure({ error: "What are you building? must be 25 words or less." }, { status: 400 });
  }

  const emailRow = await context.env.WARPLETS.prepare(
    `SELECT verified FROM email_waitlist WHERE LOWER(email) = LOWER(?) AND unsubscribed_at IS NULL LIMIT 1`
  )
    .bind(email)
    .first<{ verified: number }>();
  if (emailRow?.verified !== 1) return jsonSecure({ error: "Please verify your email before applying." }, { status: 409 });

  const fid = await resolveFid(context, body);
  const user = fid
    ? await context.env.WARPLETS.prepare("SELECT id, score FROM warplets_users WHERE fid = ? LIMIT 1")
        .bind(fid)
        .first<{ id: number; score: number | null }>()
    : null;

  const grantMonth = currentMonth();
  const duplicateEmailRow = await context.env.WARPLETS.prepare(
    "SELECT id FROM million_grant_applications WHERE email = ? AND grant_month = ? LIMIT 1"
  )
    .bind(email, grantMonth)
    .first<{ id: number }>();
  if (duplicateEmailRow) {
    return jsonSecure({ error: "Email already matches a grant application for this month." }, { status: 409 });
  }

  const ipHash = await sha256Hex(`million-grant-ip:v1:${context.env.SECURITY_LOG_SALT?.trim() ?? ""}:${ip}`);
  const blocked = await context.env.WARPLETS.prepare(
    "SELECT action FROM million_ip_controls WHERE ip_hash = ? LIMIT 1"
  )
    .bind(ipHash)
    .first<{ action: string }>();
  if (blocked?.action === "block") {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "million_grant_apply",
      outcome: "blocked_ip_hash",
      actorType: fid ? "fid" : "ip",
      actorId: fid ? String(fid) : null,
      ipAddress: ip,
      route: requestUrl.pathname,
    });
    return jsonSecure({ error: "Applications from this network are blocked." }, { status: 403 });
  }

  const recaptchaScore = await verifyRecaptcha(context.env.RECAPTCHA_SECRET_KEY, asString(body.recaptchaToken));
  const neynarScore = typeof user?.score === "number" ? user.score : null;
  const threatScore = cloudflareThreatScore(context.request);
  const cleanLimit = configNumber(config, "same_ip_month_clean_limit", 3);
  const cleanCount = await context.env.WARPLETS.prepare(
    `SELECT COUNT(*) AS count
     FROM million_grant_applications
     WHERE grant_month = ? AND ip_hash = ? AND status = 'accepted'`
  )
    .bind(grantMonth, ipHash)
    .first<{ count: number }>();

  const flags: string[] = [];
  let fraudScore = 0;
  if (recaptchaScore !== null && recaptchaScore < configNumber(config, "recaptcha_min_score", 0.5)) {
    flags.push("low_recaptcha");
    fraudScore += 0.35;
  }
  if (neynarScore !== null && neynarScore < configNumber(config, "neynar_min_score", 0.5)) {
    flags.push("low_neynar_score");
    fraudScore += 0.25;
  }
  if (threatScore !== null && threatScore > configNumber(config, "cloudflare_threat_score_flag", 10)) {
    flags.push("cloudflare_threat_score");
    fraudScore += 0.25;
  }
  if (Number(cleanCount?.count ?? 0) >= cleanLimit) {
    flags.push("ip_month_cluster");
    fraudScore += 0.2;
  }
  if (!fid) {
    flags.push("no_farcaster_context");
    fraudScore += 0.05;
  }

  const status = flags.length > 0 ? "pending_review" : "accepted";
  const now = new Date().toISOString();
  const xPostUrl = optionalUrl(body.xPostUrl);
  const farcasterPostUrl = null;
  let validReferrerApplicationId: number | null = null;

  if (referrerApplicationId && status === "accepted") {
    const referrer = await context.env.WARPLETS.prepare(
      `SELECT id, email
       FROM million_grant_applications
       WHERE id = ?
         AND grant_month = ?
         AND status = 'accepted'
       LIMIT 1`
    )
      .bind(referrerApplicationId, grantMonth)
      .first<{ id: number; email: string }>();
    if (referrer && referrer.email.toLowerCase() !== email) {
      validReferrerApplicationId = referrer.id;
    }
  }

  await context.env.WARPLETS.prepare(
    `INSERT INTO million_grant_applications (
       grant_month, user_id, user_fid, full_name, email, build_answer, x_post_url, farcaster_post_url, referrer_application_id,
       status, fraud_score, fraud_flags, recaptcha_score, neynar_score, cloudflare_threat_score, ip_hash, created_on, updated_on
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      grantMonth,
      user?.id ?? null,
      fid,
      fullName,
      email,
      buildAnswer,
      xPostUrl,
      farcasterPostUrl,
      validReferrerApplicationId,
      status,
      fraudScore,
      JSON.stringify(flags),
      recaptchaScore,
      neynarScore,
      threatScore,
      ipHash,
      now,
      now
    )
    .run();

  const application = await context.env.WARPLETS.prepare(
    "SELECT id FROM million_grant_applications WHERE email = ? AND grant_month = ? LIMIT 1"
  )
    .bind(email, grantMonth)
    .first<{ id: number }>();

  if (application) {
    if (validReferrerApplicationId && validReferrerApplicationId !== application.id) {
      await context.env.WARPLETS.prepare(
        "UPDATE million_grant_applications SET referrals_count = COALESCE(referrals_count, 0) + 1, updated_on = ? WHERE id = ?"
      )
        .bind(now, validReferrerApplicationId)
        .run();
    }
    if (xPostUrl) {
      await context.env.WARPLETS.prepare(
        `INSERT INTO million_grant_share_posts (application_id, platform, post_url, created_on)
         VALUES (?, 'x', ?, ?)
         ON CONFLICT(application_id, platform) DO UPDATE SET post_url = excluded.post_url`
      )
        .bind(application.id, xPostUrl, now)
        .run();
    }
  }

  return jsonSecure({
    ok: true,
    grantMonth,
    application: application
      ? {
          id: application.id,
          status,
          fullName,
          email,
          buildAnswer,
          xPostUrl,
          emailVerified: true,
        }
      : null,
    status,
    fraudScore,
    flags,
  });
};
