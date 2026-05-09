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
  ACTION_SESSION_SECRET?: string;
}
import { createActionSessionToken, jsonSecure, readJsonBodyWithLimit } from "../_lib/security.js";
import { outboundFetch } from "../_lib/outbound.js";

interface RequestBody {
  fid?: unknown;
  referrerFid?: unknown;
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

type OutreachCandidate = {
  farcasterUsernames: string[];
  xUsernames: string[];
  tokenIds: number[];
};

type TopReferrer = {
  fid: number;
  username: string;
  pfpUrl: string;
  referrals: number;
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
const REWARDED_USERS_CACHE_PREFIX = "rewarded-users-v1";
const RECENT_BUYS_CACHE_LOCK_TTL_SECONDS = 15;
const OUTREACH_CANDIDATES_CACHE_TTL_SECONDS = 600;
const OUTREACH_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const TOP_REFERRERS_CACHE_PREFIX = "top-referrers-v1";
const TOP_REFERRERS_CACHE_TTL_SECONDS = 600;

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
  const lockKey = `${cacheKey}:lock`;

  const cached = await env.WARPLETS_KV.get(cacheKey, "json");
  if (Array.isArray(cached)) {
    const normalized = cached.filter(isRecentBuyer).slice(0, 10);
    if (normalized.length > 0) return normalized;
  }

  const lockRate = await env.WARPLETS_KV.get(lockKey);
  if (!lockRate) {
    await env.WARPLETS_KV.put(lockKey, "1", { expirationTtl: RECENT_BUYS_CACHE_LOCK_TTL_SECONDS });
    const recentBuys = await loadRecentBuysWithOptionalTopUp(env.WARPLETS, enableMatchedTopUp);
    await env.WARPLETS_KV.put(cacheKey, JSON.stringify(recentBuys), {
      expirationTtl: RECENT_BUYS_CACHE_TTL_SECONDS,
    });
    return recentBuys;
  }

  return loadRecentBuysWithOptionalTopUp(env.WARPLETS, enableMatchedTopUp);
}

async function loadRewardedUsers(
  db: D1Database,
  topUpUsers: RecentBuyer[],
  enableTopUp: boolean
): Promise<RecentBuyer[]> {
  const rewardedResult = await db
    .prepare(
      `SELECT fid, pfp_url, score
       FROM warplets_users
       WHERE rewarded_on IS NOT NULL
         AND pfp_url IS NOT NULL
         AND TRIM(pfp_url) <> ''
       ORDER BY rewarded_on DESC
       LIMIT 100`
    )
    .all<{ fid: unknown; pfp_url: unknown; score: unknown }>();

  const rewardedUsers = normalizeAndRankBuyers(rewardedResult.results ?? []);
  if (!enableTopUp || rewardedUsers.length >= 10) {
    return rewardedUsers;
  }

  const seen = new Set<number>(rewardedUsers.map((user) => user.fid));
  const toppedUp = [...rewardedUsers];

  for (const user of topUpUsers) {
    if (toppedUp.length >= 10) break;
    if (seen.has(user.fid)) continue;
    toppedUp.push(user);
    seen.add(user.fid);
  }

  return toppedUp;
}

function makeRewardedUsersCacheKey(enableTopUp: boolean): string {
  return `${REWARDED_USERS_CACHE_PREFIX}:${enableTopUp ? "topup" : "rewarded-only"}`;
}

async function loadRewardedUsersCached(
  env: Env,
  topUpUsers: RecentBuyer[],
  enableTopUp: boolean
): Promise<RecentBuyer[]> {
  const cacheKey = makeRewardedUsersCacheKey(enableTopUp);
  const cached = await env.WARPLETS_KV.get(cacheKey, "json");
  if (Array.isArray(cached)) {
    const normalized = cached.filter(isRecentBuyer).slice(0, 10);
    if (normalized.length > 0) return normalized;
  }

  const users = await loadRewardedUsers(env.WARPLETS, topUpUsers, enableTopUp);
  await env.WARPLETS_KV.put(cacheKey, JSON.stringify(users), {
    expirationTtl: RECENT_BUYS_CACHE_TTL_SECONDS,
  });
  return users;
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

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function normalizeTopReferrers(rows: Array<{ fid: unknown; username: unknown; pfp_url: unknown; referrals_count: unknown }>): TopReferrer[] {
  return rows
    .map((row) => {
      const fid = toPositiveInt(row.fid);
      const referrals = toPositiveInt(row.referrals_count);
      if (!fid || !referrals) return null;
      if (typeof row.username !== "string" || row.username.trim().length === 0) return null;
      if (typeof row.pfp_url !== "string" || row.pfp_url.trim().length === 0) return null;
      return {
        fid,
        username: row.username,
        pfpUrl: row.pfp_url,
        referrals,
      } satisfies TopReferrer;
    })
    .filter((row): row is TopReferrer => row !== null)
    .slice(0, 25);
}

async function fetchNeynarUserByFid(
  fid: number,
  neynarApiKey?: string
): Promise<NeynarUserRecord | undefined> {
  const apiKey = neynarApiKey?.trim();
  if (!apiKey) return undefined;

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${NEYNAR_VIEWER_FID}&fids=${fid}`;
    const res = await outboundFetch(endpoint, {
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
    const res = await outboundFetch(endpoint, {
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

  const cached = await db
    .prepare(
      `SELECT best_friend_fid, mutual_affinity_score, username
       FROM warplets_user_best_friends
       WHERE user_fid = ?
       ORDER BY mutual_affinity_score DESC`
    )
    .bind(userFid)
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

async function ensureBestFriendsWarpletMatches(
  db: D1Database,
  userId: number,
  userFid: number,
  bestFriendsWarpletsOn: string | null
): Promise<void> {
  if (bestFriendsWarpletsOn) return;

  const now = new Date().toISOString();

  await db
    .prepare("DELETE FROM warplets_user_best_friends_warplet WHERE user_id = ?")
    .bind(userId)
    .run();

  await db
    .prepare(
      `INSERT INTO warplets_user_best_friends_warplet (
         user_id, user_fid, best_friend_fid, warplet_token_id, mutual_affinity_score, username, created_on
       )
       SELECT
         bf.user_id,
         bf.user_fid,
         bf.best_friend_fid,
         wm.token_id,
         bf.mutual_affinity_score,
         bf.username,
         ?
       FROM warplets_user_best_friends bf
       JOIN warplets_metadata wm
         ON wm.fid_value = bf.best_friend_fid
       WHERE bf.user_id = ?
       LIMIT 100`
    )
    .bind(now, userId)
    .run();

  await db
    .prepare("UPDATE warplets_users SET best_friends_warplets_on = ?, updated_on = ? WHERE id = ?")
    .bind(now, now, userId)
    .run();
}

function normalizeUsernameForMention(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^@+/, "");
  if (!trimmed) return null;
  return `@${trimmed}`;
}

function normalizeXUsernameForMention(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^@+/, "");
  if (!trimmed || trimmed === "-") return null;
  return `@${trimmed}`;
}

async function loadOutreachCandidates(db: D1Database, userId: number): Promise<OutreachCandidate> {
  const cutoff = new Date(Date.now() - OUTREACH_COOLDOWN_MS).toISOString();

  const friendRows = await db
    .prepare(
      `SELECT wubfw.username, wubfw.warplet_token_id, wm.warplet_username_x
       FROM warplets_user_best_friends_warplet wubfw
       JOIN warplets_metadata wm
         ON wm.token_id = wubfw.warplet_token_id
       WHERE wubfw.user_id = ?
         AND (wm.last_outreach_on IS NULL OR wm.last_outreach_on <= ?)
         AND NOT EXISTS (
           SELECT 1
           FROM warplets_users wu
           WHERE wu.fid = wm.fid_value
             AND (wu.buy_in_opensea_on IS NOT NULL OR wu.buy_in_farcaster_wallet_on IS NOT NULL)
         )
       ORDER BY wubfw.mutual_affinity_score DESC
       LIMIT 10`
    )
    .bind(userId, cutoff)
    .all<{ username: unknown; warplet_token_id: unknown; warplet_username_x: unknown }>();

  const farcasterUsernames: string[] = [];
  const xUsernames: string[] = [];
  const tokenIds: number[] = [];
  const seenTokens = new Set<number>();

  for (const row of friendRows.results ?? []) {
    const fcMention = normalizeUsernameForMention(row.username);
    const xMention = normalizeXUsernameForMention(row.warplet_username_x);
    const tokenId = typeof row.warplet_token_id === "number" ? row.warplet_token_id : null;
    if (!fcMention || !xMention || !tokenId || seenTokens.has(tokenId)) continue;
    farcasterUsernames.push(fcMention);
    xUsernames.push(xMention);
    tokenIds.push(tokenId);
    seenTokens.add(tokenId);
  }

  if (farcasterUsernames.length < 10) {
    const needed = 10 - farcasterUsernames.length;
    const nonFriendRows = await db
      .prepare(
        `SELECT wm.warplet_username_farcaster, wm.warplet_username_x, wm.token_id
         FROM warplets_metadata wm
         WHERE (wm.last_outreach_on IS NULL OR wm.last_outreach_on <= ?)
           AND wm.warplet_username_farcaster IS NOT NULL
           AND TRIM(wm.warplet_username_farcaster) <> ''
           AND wm.warplet_username_x IS NOT NULL
           AND TRIM(wm.warplet_username_x) <> ''
           AND NOT EXISTS (
             SELECT 1
             FROM warplets_users wu
             WHERE wu.fid = wm.fid_value
               AND (wu.buy_in_opensea_on IS NOT NULL OR wu.buy_in_farcaster_wallet_on IS NOT NULL)
           )
           AND wm.token_id NOT IN (
             SELECT warplet_token_id
             FROM warplets_user_best_friends_warplet
             WHERE user_id = ?
           )
         ORDER BY wm.token_id DESC
         LIMIT ?`
      )
      .bind(cutoff, userId, needed)
      .all<{ warplet_username_farcaster: unknown; warplet_username_x: unknown; token_id: unknown }>();

    for (const row of nonFriendRows.results ?? []) {
      const fcMention = normalizeUsernameForMention(row.warplet_username_farcaster);
      const xMention = normalizeXUsernameForMention(row.warplet_username_x);
      const tokenId = typeof row.token_id === "number" ? row.token_id : null;
      if (!fcMention || !xMention || !tokenId || seenTokens.has(tokenId)) continue;
      farcasterUsernames.push(fcMention);
      xUsernames.push(xMention);
      tokenIds.push(tokenId);
      seenTokens.add(tokenId);
      if (farcasterUsernames.length >= 10) break;
    }
  }

  return {
    farcasterUsernames: farcasterUsernames.slice(0, 10),
    xUsernames: xUsernames.slice(0, 10),
    tokenIds: tokenIds.slice(0, 10),
  };
}

function makeOutreachCacheKey(userId: number): string {
  return `outreach-candidates-v1:${userId}`;
}

async function loadOutreachCandidatesCached(env: Env, userId: number): Promise<OutreachCandidate> {
  const cacheKey = makeOutreachCacheKey(userId);
  const cached = await env.WARPLETS_KV.get(cacheKey, "json");
  if (cached && typeof cached === "object") {
    const record = cached as OutreachCandidate;
    if (Array.isArray(record.farcasterUsernames) && Array.isArray(record.xUsernames) && Array.isArray(record.tokenIds)) {
      return {
        farcasterUsernames: record.farcasterUsernames.slice(0, 10),
        xUsernames: record.xUsernames.slice(0, 10),
        tokenIds: record.tokenIds.slice(0, 10),
      };
    }
  }

  const candidates = await loadOutreachCandidates(env.WARPLETS, userId);
  await env.WARPLETS_KV.put(cacheKey, JSON.stringify(candidates), {
    expirationTtl: OUTREACH_CANDIDATES_CACHE_TTL_SECONDS,
  });
  return candidates;
}

async function loadTopReferrers(db: D1Database): Promise<TopReferrer[]> {
  const result = await db
    .prepare(
      `SELECT fid, username, pfp_url, referrals_count
       FROM warplets_users
       WHERE referrals_count > 0
         AND username IS NOT NULL
         AND TRIM(username) <> ''
         AND pfp_url IS NOT NULL
         AND TRIM(pfp_url) <> ''
       ORDER BY referrals_count DESC, score DESC, fid ASC
       LIMIT 25`
    )
    .all<{ fid: unknown; username: unknown; pfp_url: unknown; referrals_count: unknown }>();

  return normalizeTopReferrers(result.results ?? []);
}

async function loadTopReferrersCached(env: Env): Promise<TopReferrer[]> {
  const cacheKey = TOP_REFERRERS_CACHE_PREFIX;
  const cached = await env.WARPLETS_KV.get(cacheKey, "json");
  if (Array.isArray(cached)) {
    return normalizeTopReferrers(
      cached.map((row) => ({
        fid: (row as { fid?: unknown }).fid,
        username: (row as { username?: unknown }).username,
        pfp_url: (row as { pfpUrl?: unknown }).pfpUrl,
        referrals_count: (row as { referrals?: unknown }).referrals,
      }))
    );
  }

  const topReferrers = await loadTopReferrers(env.WARPLETS);
  await env.WARPLETS_KV.put(cacheKey, JSON.stringify(topReferrers), {
    expirationTtl: TOP_REFERRERS_CACHE_TTL_SECONDS,
  });
  return topReferrers;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const hostname = url.hostname;
    const useReferralTestData = url.searchParams.get("referrals") === "1";
    const fid = url.searchParams.get("fid");
    const recentBuys = await loadRecentBuysCached(
      context.env,
      allowMatchedTopUp(hostname)
    );
    const rewardedUsers = await loadRewardedUsersCached(
      context.env,
      recentBuys,
      allowMatchedTopUp(hostname)
    );
    let topReferrers = await loadTopReferrersCached(context.env);
    if (useReferralTestData) {
      const seeds = await context.env.WARPLETS.prepare(
        `SELECT fid, username, pfp_url
         FROM warplets_users
         WHERE username IS NOT NULL
           AND TRIM(username) <> ''
           AND pfp_url IS NOT NULL
           AND TRIM(pfp_url) <> ''
         ORDER BY updated_on DESC, fid DESC
         LIMIT 25`
      ).all<{ fid: unknown; username: unknown; pfp_url: unknown }>();
      const seededRows = (seeds.results ?? [])
        .map((row, index) => {
          const fid = typeof row.fid === "number" && Number.isFinite(row.fid) ? row.fid : null;
          const username = typeof row.username === "string" && row.username.trim().length > 0 ? row.username : null;
          const pfpUrl = typeof row.pfp_url === "string" && row.pfp_url.trim().length > 0 ? row.pfp_url : null;
          if (!fid || !username || !pfpUrl) return null;
          return {
            fid,
            username,
            pfpUrl,
            referrals: Math.max(1, 250 - index * 7),
          } satisfies TopReferrer;
        })
        .filter((row): row is TopReferrer => row !== null)
        .slice(0, 25);
      if (seededRows.length > 0) {
        topReferrers = seededRows;
      }
    }
    let referralCount = 0;

    let bestFriends: BestFriend[] = [];
    let outreachCandidates: OutreachCandidate = { farcasterUsernames: [], xUsernames: [], tokenIds: [] };
    if (fid) {
      const fidNum = parseInt(fid, 10);
      if (Number.isFinite(fidNum) && fidNum > 0) {
        const user = await context.env.WARPLETS.prepare(
          "SELECT id, best_friends_warplets_on, referrals_count FROM warplets_users WHERE fid = ? LIMIT 1"
        )
          .bind(fidNum)
          .first<{ id: number; best_friends_warplets_on: string | null; referrals_count: number | null }>();

        if (user) {
          referralCount = Math.max(0, Number(user.referrals_count ?? 0));
          bestFriends = await loadOrFetchBestFriends(
            context.env.WARPLETS,
            user.id,
            fidNum,
            context.env.NEYNAR_API_KEY
          );
          await ensureBestFriendsWarpletMatches(
            context.env.WARPLETS,
            user.id,
            fidNum,
            user.best_friends_warplets_on
          );
          outreachCandidates = await loadOutreachCandidatesCached(context.env, user.id);
        }
      }
    }

    const actionSessionToken =
      fid && Number.isFinite(Number(fid)) && Number(fid) > 0
        ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, Number(fid), 3600)
        : null;

    return jsonSecure({ buyers: recentBuys, bestFriends, rewardedUsers, outreachCandidates, actionSessionToken, referralCount, topReferrers });
  } catch (error) {
    console.error("warplet-status GET failed:", error);
    return jsonSecure({ buyers: [], bestFriends: [], rewardedUsers: [], outreachCandidates: { farcasterUsernames: [], xUsernames: [], tokenIds: [] }, actionSessionToken: null, referralCount: 0, topReferrers: [] });
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
    if (!parsed.ok) return parsed.response;
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const body = parsed.value as RequestBody;

    const fid = typeof body.fid === "number" && Number.isInteger(body.fid) ? body.fid : null;
    if (!fid || fid <= 0) {
      return jsonSecure({ error: "fid is required" }, { status: 400 });
    }
    const requestedReferrerFid = typeof body.referrerFid === "number" && Number.isInteger(body.referrerFid)
      ? body.referrerFid
      : null;
    let validReferrerFid: number | null = null;
    if (requestedReferrerFid && requestedReferrerFid > 0 && requestedReferrerFid !== fid) {
      const referrer = await context.env.WARPLETS.prepare(
        "SELECT fid FROM warplets_users WHERE fid = ? LIMIT 1"
      )
        .bind(requestedReferrerFid)
        .first<{ fid: number }>();
      if (referrer) {
        validReferrerFid = requestedReferrerFid;
      }
    }

    const existing = await context.env.WARPLETS.prepare(
      "SELECT id, username, pfp_url, score, matched_on, buy_in_opensea_on, buy_in_farcaster_wallet_on, rewarded_on, best_friends_warplets_on, referrer_fid, referrals_count FROM warplets_users WHERE fid = ? LIMIT 1"
    )
      .bind(fid)
      .first<{
        id: number;
        username: string | null;
        pfp_url: string | null;
        score: number | null;
        matched_on: string | null;
        buy_in_opensea_on: string | null;
        buy_in_farcaster_wallet_on: string | null;
        rewarded_on: string | null;
        best_friends_warplets_on: string | null;
        referrer_fid: number | null;
        referrals_count: number | null;
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
    const rewardedUsers = await loadRewardedUsersCached(
      context.env,
      recentBuys,
      allowMatchedTopUp(hostname)
    );
    let topReferrers = await loadTopReferrersCached(context.env);
    let outreachCandidates: OutreachCandidate = { farcasterUsernames: [], xUsernames: [], tokenIds: [] };

    if (!existing) {
      const neynarUser = await fetchNeynarUserByFid(fid, context.env.NEYNAR_API_KEY);
      const now = new Date().toISOString();

      await context.env.WARPLETS.prepare(
        "INSERT INTO warplets_users (" +
          "fid, username, display_name, pfp_url, registered_at, pro_status, profile_bio_text, " +
          "follower_count, following_count, primary_eth_address, primary_sol_address, x_username, " +
          "url, viewer_following, viewer_followed_by, score, matched_on, buy_in_opensea_on, buy_in_farcaster_wallet_on, rewarded_on, best_friends_warplets_on, referrer_fid, referrals_count, created_on, updated_on" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
          null,
          validReferrerFid,
          0,
          now,
          now
        )
        .run();

      if (validReferrerFid) {
        await context.env.WARPLETS.prepare(
          "UPDATE warplets_users SET referrals_count = COALESCE(referrals_count, 0) + 1, updated_on = ? WHERE fid = ?"
        )
          .bind(now, validReferrerFid)
          .run();
        await context.env.WARPLETS_KV.delete(TOP_REFERRERS_CACHE_PREFIX);
        topReferrers = await loadTopReferrersCached(context.env);
      }

      const newUser = await context.env.WARPLETS.prepare(
        "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1"
      )
        .bind(fid)
        .first<{ id: number }>();

      if (newUser) {
        const freshFriends = await loadOrFetchBestFriends(
          context.env.WARPLETS,
          newUser.id,
          fid,
          context.env.NEYNAR_API_KEY
        );
        if (freshFriends.length > 0) {
          await ensureBestFriendsWarpletMatches(
            context.env.WARPLETS,
            newUser.id,
            fid,
            null
          );
        }
        outreachCandidates = await loadOutreachCandidatesCached(context.env, newUser.id);
      }

      const actionSessionToken = await createActionSessionToken(context.env.ACTION_SESSION_SECRET, fid, 3600);
      return jsonSecure({
        fid,
        exists: false,
        matched: isMatch,
        rarityValue,
        buyInOpenseaOn: null,
        buyInFarcasterWalletOn: null,
        rewardedOn: null,
        recentBuys,
        rewardedUsers,
        outreachCandidates,
        referralCount: 0,
        topReferrers,
        actionSessionToken,
      });
    }

    const shouldHydrateProfile =
      !existing.username ||
      !existing.pfp_url ||
      existing.score === null;
    let referralCount = Math.max(0, Number(existing.referrals_count ?? 0));

    if (validReferrerFid && !existing.referrer_fid) {
      const now = new Date().toISOString();
      const setReferrer = await context.env.WARPLETS.prepare(
        "UPDATE warplets_users SET referrer_fid = ?, updated_on = ? WHERE id = ? AND referrer_fid IS NULL"
      )
        .bind(validReferrerFid, now, existing.id)
        .run();

      if (Number(setReferrer.meta.changes ?? 0) > 0) {
        await context.env.WARPLETS.prepare(
          "UPDATE warplets_users SET referrals_count = COALESCE(referrals_count, 0) + 1, updated_on = ? WHERE fid = ?"
        )
          .bind(now, validReferrerFid)
          .run();
        await context.env.WARPLETS_KV.delete(TOP_REFERRERS_CACHE_PREFIX);
        topReferrers = await loadTopReferrersCached(context.env);
      }
    }

    if (shouldHydrateProfile) {
      const neynarUser = await fetchNeynarUserByFid(fid, context.env.NEYNAR_API_KEY);
      if (neynarUser) {
        const now = new Date().toISOString();
        await context.env.WARPLETS.prepare(
          `UPDATE warplets_users SET
             username = COALESCE(username, ?),
             display_name = COALESCE(display_name, ?),
             pfp_url = COALESCE(pfp_url, ?),
             registered_at = COALESCE(registered_at, ?),
             pro_status = COALESCE(pro_status, ?),
             profile_bio_text = COALESCE(profile_bio_text, ?),
             follower_count = COALESCE(follower_count, ?),
             following_count = COALESCE(following_count, ?),
             primary_eth_address = COALESCE(primary_eth_address, ?),
             primary_sol_address = COALESCE(primary_sol_address, ?),
             x_username = COALESCE(x_username, ?),
             url = COALESCE(url, ?),
             viewer_following = COALESCE(viewer_following, ?),
             viewer_followed_by = COALESCE(viewer_followed_by, ?),
             score = COALESCE(score, ?),
             updated_on = ?
           WHERE id = ?`
        )
          .bind(
            neynarUser.username ?? null,
            neynarUser.display_name ?? null,
            neynarUser.pfp_url ?? null,
            neynarUser.registered_at ?? null,
            neynarUser.pro_status ?? null,
            neynarUser.profile_bio_text ?? null,
            neynarUser.follower_count ?? null,
            neynarUser.following_count ?? null,
            neynarUser.primary_eth_address ?? null,
            neynarUser.primary_sol_address ?? null,
            neynarUser.x_username ?? null,
            neynarUser.url ?? null,
            boolToInt(neynarUser.viewer_following),
            boolToInt(neynarUser.viewer_followed_by),
            neynarUser.score ?? null,
            now,
            existing.id
          )
          .run();
      }
    }

    await loadOrFetchBestFriends(
      context.env.WARPLETS,
      existing.id,
      fid,
      context.env.NEYNAR_API_KEY
    );

    await ensureBestFriendsWarpletMatches(
      context.env.WARPLETS,
      existing.id,
      fid,
      existing.best_friends_warplets_on
    );
    outreachCandidates = await loadOutreachCandidatesCached(context.env, existing.id);

    const actionSessionToken = await createActionSessionToken(context.env.ACTION_SESSION_SECRET, fid, 3600);
    return jsonSecure({
      fid,
      exists: true,
      matched: isMatch,
      rarityValue,
      buyInOpenseaOn: existing.buy_in_opensea_on,
      buyInFarcasterWalletOn: existing.buy_in_farcaster_wallet_on,
      rewardedOn: existing.rewarded_on,
      recentBuys,
      rewardedUsers,
      outreachCandidates,
      referralCount,
      topReferrers,
      actionSessionToken,
    });
  } catch (error) {
    console.error("warplet-status POST failed:", error);
    return jsonSecure({
      error: "Failed to load status",
      exists: false,
      matched: false,
      rarityValue: null,
      buyInOpenseaOn: null,
      buyInFarcasterWalletOn: null,
      rewardedOn: null,
      recentBuys: [],
      rewardedUsers: [],
      outreachCandidates: { farcasterUsernames: [], xUsernames: [], tokenIds: [] },
      referralCount: 0,
      topReferrers: [],
      actionSessionToken: null,
    });
  }
};
