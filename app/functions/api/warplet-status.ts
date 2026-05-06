/**
 * POST /api/warplet-status
 *
 * Upserts the viewer into warplets_users (with optional Neynar enrichment)
 * and returns whether they are matched to a Warplet allocation.
 *
 * Body: { fid: number }
 */

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  NEYNAR_API_KEY?: string;
}

interface RequestBody {
  fid?: unknown;
}

type RecentBuyer = {
  fid: number;
  pfpUrl: string;
  score: number | null;
};

type BestFriend = {
  fid: number;
  mutualAffinityScore: number;
  username: string;
};

type NeynarUserRecord = {
  username?: string;
  display_name?: string;
  pfp_url?: string;
  registered_at?: string;
  pro_status?: string;
  profile_bio_text?: string;
  follower_count?: number;
  following_count?: number;
  primary_eth_address?: string;
  primary_sol_address?: string;
  x_username?: string;
  url?: string;
  viewer_following?: boolean;
  viewer_followed_by?: boolean;
  score?: number;
};

const NEYNAR_VIEWER_FID = 1129138;
const RECENT_BUYS_CACHE_TTL_SECONDS = 600;
const RECENT_BUYS_CACHE_PREFIX = "recent-buys-v2";
const BEST_FRIENDS_CACHE_STALE_SECONDS = 2592000;

function normalizeAndRankBuyers(rows: Array<{ fid: unknown; pfp_url: unknown; score: unknown }>): RecentBuyer[] {
  return rows
    .map((row) => {
      if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return null;
      if (typeof row.pfp_url !== "string" || row.pfp_url.trim().length === 0) return null;

      return {
        fid: row.fid,
        pfpUrl: row.pfp_url,
        score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null,
      } satisfies RecentBuyer;
    })
    .filter((row): row is RecentBuyer => row !== null)
    .sort((a, b) => {
      const aScore = a.score ?? -1;
      const bScore = b.score ?? -1;
      if (bScore !== aScore) return bScore - aScore;
      return b.fid - a.fid;
    })
    .slice(0, 10);
}

async function loadRecentBuys(db: D1Database): Promise<RecentBuyer[]> {
  const buyersResult = await db
    .prepare(
      `SELECT fid, pfp_url, score
       FROM warplets_users
       WHERE (buy_in_opensea_on IS NOT NULL OR buy_in_farcaster_wallet_on IS NOT NULL)
         AND pfp_url IS NOT NULL
         AND TRIM(pfp_url) <> ''
       ORDER BY COALESCE(buy_in_opensea_on, buy_in_farcaster_wallet_on) DESC
       LIMIT 100`
    )
    .all<{ fid: unknown; pfp_url: unknown; score: unknown }>();

  return normalizeAndRankBuyers(buyersResult.results ?? []);
}

function allowMatchedTopUp(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.includes("-dev.") ||
    host.includes("-local.") ||
    host.endsWith(".pages.dev")
  );
}

async function loadRecentBuysWithOptionalTopUp(
  db: D1Database,
  enableMatchedTopUp: boolean
): Promise<RecentBuyer[]> {
  const buyers = await loadRecentBuys(db);
  if (!enableMatchedTopUp || buyers.length >= 10) {
    return buyers;
  }

  const matchedResult = await db
    .prepare(
      `SELECT fid, pfp_url, score
       FROM warplets_users
       WHERE matched_on IS NOT NULL
         AND pfp_url IS NOT NULL
         AND TRIM(pfp_url) <> ''
       ORDER BY matched_on DESC
       LIMIT 100`
    )
    .all<{ fid: unknown; pfp_url: unknown; score: unknown }>();

  const matched = normalizeAndRankBuyers(matchedResult.results ?? []);
  const seen = new Set<number>(buyers.map((buyer) => buyer.fid));
  const toppedUp = [...buyers];

  for (const candidate of matched) {
    if (toppedUp.length >= 10) break;
    if (seen.has(candidate.fid)) continue;
    toppedUp.push(candidate);
    seen.add(candidate.fid);
  }

  return toppedUp;
}

function makeRecentBuysCacheKey(enableMatchedTopUp: boolean): string {
  return `${RECENT_BUYS_CACHE_PREFIX}:${enableMatchedTopUp ? "topup" : "buys-only"}`;
}

function isRecentBuyer(value: unknown): value is RecentBuyer {
  if (!value || typeof value !== "object") return false;
  const row = value as { fid?: unknown; pfpUrl?: unknown; score?: unknown };
  if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return false;
  if (typeof row.pfpUrl !== "string" || row.pfpUrl.trim().length === 0) return false;
  if (!(row.score === null || (typeof row.score === "number" && Number.isFinite(row.score)))) return false;
  return true;
}

async function loadRecentBuysCached(env: Env, enableMatchedTopUp: boolean): Promise<RecentBuyer[]> {
  const cacheKey = makeRecentBuysCacheKey(enableMatchedTopUp);

  const cached = await env.WARPLETS_KV.get(cacheKey, "json");
  if (Array.isArray(cached)) {
    const normalized = cached.filter(isRecentBuyer).slice(0, 10);
    if (normalized.length > 0) return normalized;
  }

  const recentBuys = await loadRecentBuysWithOptionalTopUp(env.WARPLETS, enableMatchedTopUp);
  await env.WARPLETS_KV.put(cacheKey, JSON.stringify(recentBuys), {
    expirationTtl: RECENT_BUYS_CACHE_TTL_SECONDS,
  });

  return recentBuys;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function boolToInt(value: boolean | undefined): number | null {
  if (typeof value !== "boolean") return null;
  return value ? 1 : 0;
}

async function fetchNeynarUserByFid(
  fid: number,
  neynarApiKey?: string
): Promise<NeynarUserRecord | undefined> {
  const apiKey = neynarApiKey?.trim();
  if (!apiKey) return undefined;

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${NEYNAR_VIEWER_FID}&fids=${fid}`;
    const res = await fetch(endpoint, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return undefined;

    const payload = (await res.json()) as Record<string, unknown>;
    const users = payload.users;
    if (!Array.isArray(users) || users.length === 0) return undefined;

    const user = asObject(users[0]);
    if (!user) return undefined;

    const pro = asObject(user.pro);
    const profile = asObject(user.profile);
    const bio = asObject(profile?.bio);
    const verifiedAddresses = asObject(user.verified_addresses);
    const primaryAddresses = asObject(verifiedAddresses?.primary);
    const viewerContext = asObject(user.viewer_context);

    let xUsername: string | undefined;
    const verifiedAccounts = user.verified_accounts;
    if (Array.isArray(verifiedAccounts)) {
      for (const account of verifiedAccounts) {
        const verifiedAccount = asObject(account);
        if (!verifiedAccount) continue;
        if (verifiedAccount.platform === "x") {
          xUsername = asString(verifiedAccount.username);
          break;
        }
      }
    }

    return {
      username: asString(user.username),
      display_name: asString(user.display_name),
      pfp_url: asString(user.pfp_url),
      registered_at: asString(user.registered_at),
      pro_status: asString(pro?.status),
      profile_bio_text: asString(bio?.text),
      follower_count: asNumber(user.follower_count),
      following_count: asNumber(user.following_count),
      primary_eth_address: asString(primaryAddresses?.eth_address),
      primary_sol_address: asString(primaryAddresses?.sol_address),
      x_username: xUsername,
      url: asString(user.url),
      viewer_following: asBoolean(viewerContext?.following),
      viewer_followed_by: asBoolean(viewerContext?.followed_by),
      score: asNumber(user.score),
    };
  } catch {
    return undefined;
  }
}

async function fetchBestFriendsFromNeynar(
  fid: number,
  neynarApiKey?: string
): Promise<BestFriend[] | undefined> {
  const apiKey = neynarApiKey?.trim();
  if (!apiKey) return undefined;

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/best_friends?fid=${fid}&limit=100`;
    const res = await fetch(endpoint, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return undefined;

    const payload = (await res.json()) as Record<string, unknown>;
    const users = payload.users;
    if (!Array.isArray(users)) return undefined;

    return users
      .map((user) => {
        const u = asObject(user);
        if (!u) return null;
        const fid = asNumber(u.fid);
        const username = asString(u.username);
        const score = asNumber(u.mutual_affinity_score);

        if (!fid || !username || score === undefined) return null;

        return {
          fid,
          mutualAffinityScore: score,
          username,
        } satisfies BestFriend;
      })
      .filter((item): item is BestFriend => item !== null);
  } catch {
    return undefined;
  }
}

async function loadOrFetchBestFriends(
  db: D1Database,
  userId: number,
  userFid: number,
  neynarApiKey?: string
): Promise<BestFriend[]> {
  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - BEST_FRIENDS_CACHE_STALE_SECONDS * 1000).toISOString();

  const cached = await db
    .prepare(
      `SELECT best_friend_fid, mutual_affinity_score, username
       FROM warplets_user_best_friends
       WHERE user_fid = ? AND fetched_at > ?
       ORDER BY mutual_affinity_score DESC`
    )
    .bind(userFid, staleThreshold)
    .all<{ best_friend_fid: number; mutual_affinity_score: number; username: string }>();

  if (cached.results && cached.results.length > 0) {
    return cached.results.map((row) => ({
      fid: row.best_friend_fid,
      mutualAffinityScore: row.mutual_affinity_score,
      username: row.username,
    }));
  }

  const fetched = await fetchBestFriendsFromNeynar(userFid, neynarApiKey);
  if (!fetched || fetched.length === 0) {
    return [];
  }

  await Promise.all(
    fetched.map((friend) =>
      db
        .prepare(
          `INSERT INTO warplets_user_best_friends 
           (user_id, user_fid, best_friend_fid, mutual_affinity_score, username, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, best_friend_fid) DO UPDATE SET
             user_fid = excluded.user_fid,
             mutual_affinity_score = excluded.mutual_affinity_score,
             username = excluded.username,
             fetched_at = excluded.fetched_at`
        )
        .bind(userId, userFid, friend.fid, friend.mutualAffinityScore, friend.username, now)
        .run()
    )
  );

  return fetched;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const hostname = url.hostname;
  const fid = url.searchParams.get("fid");
  const recentBuys = await loadRecentBuysCached(
    context.env,
    allowMatchedTopUp(hostname)
  );

  let bestFriends: BestFriend[] = [];
  if (fid) {
    const fidNum = parseInt(fid, 10);
    if (Number.isFinite(fidNum) && fidNum > 0) {
      const user = await context.env.WARPLETS.prepare(
        "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1"
      )
        .bind(fidNum)
        .first<{ id: number }>();

      if (user) {
        bestFriends = await loadOrFetchBestFriends(
          context.env.WARPLETS,
          user.id,
          fidNum,
          context.env.NEYNAR_API_KEY
        );
      }
    }
  }

  return Response.json({ buyers: recentBuys, bestFriends });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RequestBody = {};
  try {
    body = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fid = typeof body.fid === "number" && Number.isInteger(body.fid) ? body.fid : null;
  if (!fid || fid <= 0) {
    return Response.json({ error: "fid is required" }, { status: 400 });
  }

  const existing = await context.env.WARPLETS.prepare(
    "SELECT id, matched_on, buy_in_opensea_on, buy_in_farcaster_wallet_on, shared_on FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{
      id: number;
      matched_on: string | null;
      buy_in_opensea_on: string | null;
      buy_in_farcaster_wallet_on: string | null;
      shared_on: string | null;
    }>();

  const matchRow = await context.env.WARPLETS.prepare(
    "SELECT x10_rarity FROM warplets_metadata WHERE fid_value = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ x10_rarity: number | null }>();

  const rarityValue = typeof matchRow?.x10_rarity === "number" ? matchRow.x10_rarity : null;
  const isMatch = rarityValue !== null;
  const hostname = new URL(context.request.url).hostname;
  const recentBuys = await loadRecentBuysCached(
    context.env,
    allowMatchedTopUp(hostname)
  );

  if (!existing) {
    const neynarUser = await fetchNeynarUserByFid(fid, context.env.NEYNAR_API_KEY);
    const now = new Date().toISOString();

    await context.env.WARPLETS.prepare(
      "INSERT INTO warplets_users (" +
        "fid, username, display_name, pfp_url, registered_at, pro_status, profile_bio_text, " +
        "follower_count, following_count, primary_eth_address, primary_sol_address, x_username, " +
        "url, viewer_following, viewer_followed_by, score, matched_on, buy_in_opensea_on, buy_in_farcaster_wallet_on, shared_on, created_on, updated_on" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        fid,
        neynarUser?.username ?? null,
        neynarUser?.display_name ?? null,
        neynarUser?.pfp_url ?? null,
        neynarUser?.registered_at ?? null,
        neynarUser?.pro_status ?? null,
        neynarUser?.profile_bio_text ?? null,
        neynarUser?.follower_count ?? null,
        neynarUser?.following_count ?? null,
        neynarUser?.primary_eth_address ?? null,
        neynarUser?.primary_sol_address ?? null,
        neynarUser?.x_username ?? null,
        neynarUser?.url ?? null,
        boolToInt(neynarUser?.viewer_following),
        boolToInt(neynarUser?.viewer_followed_by),
        neynarUser?.score ?? null,
        isMatch ? now : null,
        null,
        null,
        null,
        now,
        now
      )
      .run();

    const newUser = await context.env.WARPLETS.prepare(
      "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1"
    )
      .bind(fid)
      .first<{ id: number }>();

    if (newUser) {
      await loadOrFetchBestFriends(
        context.env.WARPLETS,
        newUser.id,
        fid,
        context.env.NEYNAR_API_KEY
      );
    }

    return Response.json({
      fid,
      exists: false,
      matched: isMatch,
      rarityValue,
      buyInOpenseaOn: null,
      buyInFarcasterWalletOn: null,
      sharedOn: null,
      recentBuys,
    });
  }

  return Response.json({
    fid,
    exists: true,
    matched: isMatch,
    rarityValue,
    buyInOpenseaOn: existing.buy_in_opensea_on,
    buyInFarcasterWalletOn: existing.buy_in_farcaster_wallet_on,
    sharedOn: existing.shared_on,
    recentBuys,
  });
};
