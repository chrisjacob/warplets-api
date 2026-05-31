interface Env {
  NEYNAR_API_KEY?: string;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
  WARPLETS?: D1Database;
}

import { jsonSecure, verifyActionSessionToken } from "../_lib/security.js";
import { outboundFetch } from "../_lib/outbound.js";

const TEN_X_MEME_FID = 1313340;

type Avatar = {
  fid: number;
  username: string;
  pfpUrl: string;
};

type MetadataAvatarRow = {
  fid_value: number | null;
  warplet_username_farcaster: string | null;
  token_id: number;
  jpg_url: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

function isMillionLocalHost(hostname: string): boolean {
  return hostname === "million-local.10x.meme";
}

async function resolveFid(
  env: Env,
  requestUrl: URL,
  fallbackFid: number | null,
  sessionToken: string | null
): Promise<number | null> {
  const session = await verifyActionSessionToken(env.ACTION_SESSION_SECRET, sessionToken);
  if (session.valid) return session.fid;

  if (!isLocalDevHost(requestUrl.hostname) && env.ALLOW_INSECURE_ACTION_FID_FALLBACK !== "1") return null;
  return fallbackFid;
}

function avatarFromUser(rawUser: unknown): Avatar | null {
  const user = asObject(rawUser);
  if (!user) return null;

  const fid = asNumber(user.fid);
  const username = asString(user.username);
  const pfpUrl = asString(user.pfp_url);
  if (!fid || !pfpUrl) return null;

  return {
    fid,
    username: username ?? String(fid),
    pfpUrl,
  };
}

function uniqueAvatars(avatars: Array<Avatar | null>): Avatar[] {
  const seen = new Set<number>();
  const results: Avatar[] = [];
  for (const avatar of avatars) {
    if (!avatar || seen.has(avatar.fid)) continue;
    results.push(avatar);
    seen.add(avatar.fid);
    if (results.length >= 10) break;
  }
  return results;
}

function normalizeMetadataAvatars(rows: MetadataAvatarRow[]): Avatar[] {
  return rows
    .filter((row) => typeof row.fid_value === "number")
    .map((row) => ({
      fid: row.fid_value as number,
      username: row.warplet_username_farcaster?.trim() || `Warplet #${row.token_id}`,
      pfpUrl: row.jpg_url?.trim() || `https://warplets.10x.meme/${row.token_id}.jpg`,
    }))
    .filter((row) => row.pfpUrl.length > 0)
    .slice(0, 10);
}

async function fillWithLocalMetadataAvatars(db: D1Database | undefined, followers: Avatar[], seen: Set<number>): Promise<void> {
  if (!db || followers.length >= 10) return;

  const latest = await db.prepare(
    `SELECT fid_value, warplet_username_farcaster, token_id, jpg_url
     FROM warplets_metadata
     WHERE fid_value IS NOT NULL
     ORDER BY token_id DESC
     LIMIT 25`
  ).all<MetadataAvatarRow>();

  for (const avatar of normalizeMetadataAvatars(latest.results ?? [])) {
    if (followers.length >= 10) break;
    if (seen.has(avatar.fid)) continue;
    followers.push(avatar);
    seen.add(avatar.fid);
  }
}

async function fetchBestFriends(apiKey: string): Promise<Avatar[]> {
  const url = new URL("https://api.neynar.com/v2/farcaster/user/best_friends");
  url.searchParams.set("fid", String(TEN_X_MEME_FID));
  url.searchParams.set("limit", "10");

  const response = await outboundFetch(url.toString(), { headers: { "x-api-key": apiKey } });
  if (!response.ok) return [];

  const payload = await response.json() as { users?: unknown[] };
  return uniqueAvatars(Array.isArray(payload.users) ? payload.users.map(avatarFromUser) : []);
}

async function fetchLatestFollowers(apiKey: string, viewerFid: number | null): Promise<Avatar[]> {
  const url = new URL("https://api.neynar.com/v2/farcaster/followers/");
  url.searchParams.set("fid", String(TEN_X_MEME_FID));
  url.searchParams.set("sort_type", "desc_chron");
  url.searchParams.set("limit", "10");
  if (viewerFid) url.searchParams.set("viewer_fid", String(viewerFid));

  const response = await outboundFetch(url.toString(), { headers: { "x-api-key": apiKey } });
  if (!response.ok) return [];

  const payload = await response.json() as { users?: unknown[] };
  const users = Array.isArray(payload.users) ? payload.users : [];
  return uniqueAvatars(users.map((item) => avatarFromUser(asObject(item)?.user)));
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.NEYNAR_API_KEY?.trim();
  if (!apiKey) return jsonSecure({ followers: [] });

  const url = new URL(context.request.url);
  const fallbackFid = asPositiveInt(url.searchParams.get("fid"));
  const sessionToken = url.searchParams.get("sessionToken")?.trim() || null;
  const viewerFid = await resolveFid(context.env, url, fallbackFid, sessionToken);

  try {
    const preferred = viewerFid ? await fetchBestFriends(apiKey) : [];
    const followers = preferred.length > 0 ? preferred : await fetchLatestFollowers(apiKey, viewerFid);
    if (isMillionLocalHost(url.hostname)) {
      await fillWithLocalMetadataAvatars(context.env.WARPLETS, followers, new Set(followers.map((follower) => follower.fid)));
    }
    return jsonSecure({ followers });
  } catch {
    const followers: Avatar[] = [];
    if (isMillionLocalHost(url.hostname)) {
      await fillWithLocalMetadataAvatars(context.env.WARPLETS, followers, new Set());
    }
    return jsonSecure({ followers });
  }
};
