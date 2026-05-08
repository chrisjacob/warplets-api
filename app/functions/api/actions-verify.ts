interface Env {
  NEYNAR_API_KEY?: string;
  ACTION_SESSION_SECRET?: string;
  WARPLETS?: D1Database;
  WARPLETS_KV?: KVNamespace;
}

interface RequestBody {
  actionSlug?: unknown;
  sessionToken?: unknown;
  fid?: unknown;
}
import { getClientIp, jsonSecure, logSecurityEvent, rateLimit, readJsonBody, verifyActionSessionToken } from "../_lib/security.js";
import { outboundFetch } from "../_lib/outbound.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function isFollowingFid(apiKey: string, viewerFid: number, targetFid: number): Promise<boolean> {
  const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${viewerFid}&fids=${targetFid}`;
  const response = await outboundFetch(endpoint, { headers: { "x-api-key": apiKey } });
  if (!response.ok) return false;

  const payload = (await response.json()) as { users?: Array<{ viewer_context?: { following?: boolean } }> };
  const user = Array.isArray(payload.users) ? payload.users[0] : null;
  return Boolean(user?.viewer_context?.following);
}

async function isFollowingChannel(apiKey: string, fid: number, channelId: string): Promise<boolean> {
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const url = new URL("https://api.neynar.com/v2/farcaster/user/channels/");
    url.searchParams.set("fid", String(fid));
    url.searchParams.set("limit", "100");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await outboundFetch(url.toString(), { headers: { "x-api-key": apiKey } });
    if (!response.ok) return false;

    const payload = (await response.json()) as {
      channels?: Array<{ id?: string }>;
      next?: { cursor?: string };
    };
    const channels = Array.isArray(payload.channels) ? payload.channels : [];
    if (channels.some((channel) => channel.id === channelId)) {
      return true;
    }
    const nextCursor = typeof payload.next?.cursor === "string" ? payload.next.cursor : "";
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return false;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const ip = getClientIp(context.request);
  const ipRate = await rateLimit(context.env.WARPLETS_KV, "actions-verify-ip", ip, 90, 60);
  if (!ipRate.allowed) {
    await logSecurityEvent(context.env.WARPLETS, {
      eventType: "rate_limit",
      outcome: "actions_verify_rate_limited",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const parsed = await readJsonBody<unknown>(context.request);
  if (!parsed.ok) return parsed.response;
  if (!isPlainObject(parsed.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }
  if (!hasOnlyAllowedKeys(parsed.value, ["actionSlug", "sessionToken", "fid"])) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });
  }
  const body = parsed.value as RequestBody;

  const requestUrl = new URL(context.request.url);
  const sessionToken = asNonEmptyString(body.sessionToken);
  const bodyFid = typeof body.fid === "number" && Number.isInteger(body.fid) && body.fid > 0 ? body.fid : null;
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
  const allowInsecureFallback =
    requestUrl.hostname.includes("-local.") ||
    requestUrl.hostname.includes("-dev.") ||
    requestUrl.hostname.endsWith(".pages.dev");
  const fid = session.valid ? session.fid : (allowInsecureFallback ? bodyFid : null);
  if (!fid) {
    return jsonSecure({ error: "Unauthorized action session" }, { status: 401 });
  }
  const actionSlug = asNonEmptyString(body.actionSlug)?.toLowerCase();
  if (!actionSlug) {
    return jsonSecure({ error: "actionSlug is required" }, { status: 400 });
  }

  const apiKey = context.env.NEYNAR_API_KEY?.trim();
  if (!apiKey) {
    return jsonSecure({ error: "Missing NEYNAR_API_KEY" }, { status: 500 });
  }

  try {
    if (actionSlug === "drop-follow-fc-10xmeme") {
      const verified = await isFollowingFid(apiKey, fid, 1313340);
      return jsonSecure({ verified });
    }
    if (actionSlug === "drop-follow-fc-10xchris") {
      const verified = await isFollowingFid(apiKey, fid, 1129138);
      return jsonSecure({ verified });
    }
    if (actionSlug === "drop-join-fc-channel") {
      const verified = await isFollowingChannel(apiKey, fid, "10xmeme");
      return jsonSecure({ verified });
    }
  } catch {
    return jsonSecure({ verified: false });
  }

  return jsonSecure({ error: "Unsupported actionSlug" }, { status: 400 });
};
