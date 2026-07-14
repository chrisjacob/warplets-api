import { jsonSecure } from "../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  NEYNAR_API_KEY?: string;
}

interface SocialProfileResponse {
  farcasterUsername: string | null;
  xUsername: string | null;
}

const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const CACHE_TTL_SECONDS = 60 * 60;

function normalizeWallet(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return WALLET_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@/, "");
  return trimmed && trimmed !== "-" ? trimmed : null;
}

function parseFid(value: string | null): number | null {
  if (!value) return null;
  const fid = Number(value);
  return Number.isInteger(fid) && fid > 0 ? fid : null;
}

function getVerifiedXUsername(user: unknown): string | null {
  if (!user || typeof user !== "object") return null;
  const verifiedAccounts = "verified_accounts" in user ? user.verified_accounts : null;
  if (!Array.isArray(verifiedAccounts)) return null;

  for (const account of verifiedAccounts) {
    if (!account || typeof account !== "object") continue;
    const platform = "platform" in account ? account.platform : null;
    if (platform !== "x" && platform !== "twitter") continue;
    const username = "username" in account ? account.username : null;
    const normalized = normalizeUsername(username);
    if (normalized) return normalized;
  }

  return null;
}

function getUserUsername(user: unknown): string | null {
  if (!user || typeof user !== "object") return null;
  return normalizeUsername("username" in user ? user.username : null);
}

async function lookupUserByFid(db: D1Database, fid: number): Promise<SocialProfileResponse> {
  try {
    const row = await db
      .prepare("SELECT username, x_username FROM warplets_users WHERE fid = ? LIMIT 1")
      .bind(fid)
      .first<{ username?: string | null; x_username?: string | null }>();
    return {
      farcasterUsername: normalizeUsername(row?.username),
      xUsername: normalizeUsername(row?.x_username),
    };
  } catch {
    return { farcasterUsername: null, xUsername: null };
  }
}

async function lookupUserByWallet(db: D1Database, wallet: string): Promise<SocialProfileResponse & { fid: number | null }> {
  try {
    const row = await db
      .prepare(
        `SELECT fid, username
         FROM wallet_farcaster_links
         WHERE wallet = ?
         ORDER BY COALESCE(score, -1) DESC, fid ASC
         LIMIT 1`,
      )
      .bind(wallet)
      .first<{ fid?: number | null; username?: string | null }>();
    if (!row?.fid) {
      return { farcasterUsername: normalizeUsername(row?.username), xUsername: null, fid: null };
    }
    const profile = await lookupUserByFid(db, row.fid);
    return {
      farcasterUsername: profile.farcasterUsername ?? normalizeUsername(row.username),
      xUsername: profile.xUsername,
      fid: row.fid,
    };
  } catch {
    return { farcasterUsername: null, xUsername: null, fid: null };
  }
}

async function lookupNeynarProfile(apiKey: string | undefined, input: {
  wallet: string | null;
  fid: number | null;
}): Promise<SocialProfileResponse> {
  if (!apiKey) return { farcasterUsername: null, xUsername: null };

  try {
    const endpoint = input.fid
      ? `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(String(input.fid))}`
      : input.wallet
        ? `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(input.wallet)}`
        : null;
    if (!endpoint) return { farcasterUsername: null, xUsername: null };

    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        api_key: apiKey,
      },
    });
    if (!response.ok) return { farcasterUsername: null, xUsername: null };

    const payload = await response.json() as { users?: unknown; [key: string]: unknown };
    const users = Array.isArray(payload.users)
      ? payload.users
      : input.wallet && payload[input.wallet.toLowerCase()] && Array.isArray(payload[input.wallet.toLowerCase()])
        ? payload[input.wallet.toLowerCase()] as unknown[]
        : input.wallet && payload[input.wallet] && Array.isArray(payload[input.wallet])
          ? payload[input.wallet] as unknown[]
          : [];
    const user = users[0];
    return {
      farcasterUsername: getUserUsername(user),
      xUsername: getVerifiedXUsername(user),
    };
  } catch {
    return { farcasterUsername: null, xUsername: null };
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const wallet = normalizeWallet(url.searchParams.get("wallet"));
  const inputFid = parseFid(url.searchParams.get("fid"));
  if (!wallet && !inputFid) {
    return jsonSecure({ error: "wallet or fid is required" }, { status: 400 });
  }

  const cacheKey = `warplet-social-profile:v1:${wallet ?? ""}:${inputFid ?? ""}`;
  if (context.env.WARPLETS_KV) {
    const cached = await context.env.WARPLETS_KV.get<SocialProfileResponse>(cacheKey, "json").catch(() => null);
    if (cached) return jsonSecure(cached);
  }

  const walletProfile = wallet ? await lookupUserByWallet(context.env.WARPLETS, wallet) : null;
  const fid = inputFid ?? walletProfile?.fid ?? null;
  const fidProfile = fid ? await lookupUserByFid(context.env.WARPLETS, fid) : null;
  const neynarProfile = (!fidProfile?.farcasterUsername || !fidProfile?.xUsername)
    ? await lookupNeynarProfile(context.env.NEYNAR_API_KEY, { wallet, fid })
    : { farcasterUsername: null, xUsername: null };

  const profile: SocialProfileResponse = {
    farcasterUsername: fidProfile?.farcasterUsername ?? walletProfile?.farcasterUsername ?? neynarProfile.farcasterUsername ?? null,
    xUsername: fidProfile?.xUsername ?? walletProfile?.xUsername ?? neynarProfile.xUsername ?? null,
  };

  if (context.env.WARPLETS_KV) {
    context.env.WARPLETS_KV.put(cacheKey, JSON.stringify(profile), { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {});
  }

  return jsonSecure(profile);
};
