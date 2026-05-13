import { createClient } from "@farcaster/quick-auth";
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBodyWithLimit,
} from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  SECURITY_LOG_SALT?: string;
}

type StopBody = {
  username?: unknown;
};

function asUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@+/, "");
  return trimmed ? trimmed.slice(0, 80) : null;
}

function decodeJwtAudience(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as { aud?: unknown };
    return typeof parsed.aud === "string" && parsed.aud.trim() ? parsed.aud.trim() : null;
  } catch {
    return null;
  }
}

function hostnameFromHeader(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw.split(",")[0]?.trim().replace(/:\d+$/, "") || null;
  }
}

function quickAuthCandidateDomains(request: Request, token: string): string[] {
  const requestUrl = new URL(request.url);
  return Array.from(new Set([
    decodeJwtAudience(token),
    requestUrl.hostname,
    hostnameFromHeader(request.headers.get("origin")),
    hostnameFromHeader(request.headers.get("referer")),
    hostnameFromHeader(request.headers.get("x-forwarded-host")),
    hostnameFromHeader(request.headers.get("x-original-host")),
    "app-local.10x.meme",
    "app-dev.10x.meme",
    "app.10x.meme",
  ].filter((domain): domain is string => Boolean(domain))));
}

async function verifyQuickAuthFid(request: Request): Promise<number | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const client = createClient();
  const candidateDomains = quickAuthCandidateDomains(request, token);

  for (const domain of candidateDomains) {
    try {
      const payload = await client.verifyJwt({ token, domain });
      const sub = Number(payload.sub);
      if (Number.isInteger(sub) && sub > 0) return sub;
    } catch {
      // Try the next plausible audience domain.
    }
  }

  return null;
}

async function getStatus(db: D1Database, fid: number) {
  const row = await db
    .prepare(
      `SELECT fid, username, opted_out_on, opted_back_in_on, updated_on
       FROM warplets_outreach_opt_outs
       WHERE fid = ?
       LIMIT 1`
    )
    .bind(fid)
    .first<{
      fid: number;
      username: string | null;
      opted_out_on: string | null;
      opted_back_in_on: string | null;
      updated_on: string | null;
    }>();

  return {
    fid,
    optedOut: Boolean(row && !row.opted_back_in_on),
    username: row?.username ?? null,
    optedOutOn: row?.opted_out_on ?? null,
    optedBackInOn: row?.opted_back_in_on ?? null,
    updatedOn: row?.updated_on ?? null,
  };
}

async function requireFid(context: EventContext<Env, string, unknown>, namespace: string) {
  const ip = getClientIp(context.request);
  const rate = await rateLimit(context.env.WARPLETS_KV, namespace, ip, 30, 60);
  if (!rate.allowed) {
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return { ok: false as const, response };
  }

  const fid = await verifyQuickAuthFid(context.request);
  if (!fid) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "outreach_stop_auth",
      outcome: "invalid_quick_auth",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    return { ok: false as const, response: jsonSecure({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true as const, fid };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireFid(context, "outreach-stop-get");
  if (!auth.ok) return auth.response;
  return jsonSecure(await getStatus(context.env.WARPLETS, auth.fid));
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireFid(context, "outreach-stop-post");
  if (!auth.ok) return auth.response;

  let username: string | null = null;
  const contentType = context.request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = await readJsonBodyWithLimit<unknown>(context.request, 1024);
    if (!parsed.ok) return parsed.response;
    if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
      username = asUsername((parsed.value as StopBody).username);
    }
  }

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    `INSERT INTO warplets_outreach_opt_outs (
       fid, username, opted_out_on, opted_back_in_on, updated_on
     ) VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT(fid) DO UPDATE SET
       username = COALESCE(excluded.username, warplets_outreach_opt_outs.username),
       opted_out_on = excluded.opted_out_on,
       opted_back_in_on = NULL,
       updated_on = excluded.updated_on`
  )
    .bind(auth.fid, username, now, now)
    .run();

  return jsonSecure(await getStatus(context.env.WARPLETS, auth.fid));
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const auth = await requireFid(context, "outreach-stop-delete");
  if (!auth.ok) return auth.response;

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    `UPDATE warplets_outreach_opt_outs
     SET opted_back_in_on = ?,
         updated_on = ?
     WHERE fid = ?`
  )
    .bind(now, now, auth.fid)
    .run();

  return jsonSecure(await getStatus(context.env.WARPLETS, auth.fid));
};
