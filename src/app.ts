import { Hono } from "hono";
import {
  type SnapElementInput,
  type SnapFunction,
  type SnapHandlerResult,
} from "@farcaster/snap";
import { registerSnapHandler } from "@farcaster/snap-hono";

// ---------------------------------------------------------------------------
// Environment bindings (Cloudflare Workers)
// ---------------------------------------------------------------------------

interface Env {
  /** Cloudflare D1 database — stores users and individual vote rows. */
  WARPLETS: D1Database;
  /** Workers KV namespace — caches aggregated poll totals for fast edge reads. */
  WARPLETS_KV: KVNamespace;
  /** Optional: override the public base URL (e.g. https://snapflare.xyz.workers.dev). */
  SNAP_PUBLIC_BASE_URL?: string;
  /** Optional: Neynar API key used for claim-click user enrichment. */
  NEYNAR_API_KEY?: string;
  /** Optional: OpenSea API key used by the cron-triggered event sync. */
  OPENSEA_API_KEY?: string;
}

type AppOptions = {
  skipJFSVerification?: boolean;
  devTunnelToken?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOURS = [
  { id: "red", label: "🔴 Red", color: "red" as const },
  { id: "blue", label: "🔵 Blue", color: "blue" as const },
  { id: "green", label: "🟢 Green", color: "green" as const },
  { id: "yellow", label: "🟡 Yellow", color: "amber" as const },
  { id: "purple", label: "🟣 Purple", color: "purple" as const },
] as const;

const VALID_OPTIONS = new Set<string>(COLOURS.map((c) => c.id));
const SUPPORTED_IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;

function hasSupportedImageExt(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return SUPPORTED_IMAGE_EXTS.test(path);
  } catch {
    return false;
  }
}
const KV_POLL_RESULTS_KEY = "poll_results";
const KV_STATS_CLICKS_KEY = "stats_clicks";
const KV_STATS_MATCHES_KEY = "stats_matches";
const KV_STATS_BUYS_KEY = "stats_buys";
// Tracks the ISO timestamp of the last OpenSea event processed (used by opensea-sync.ts for resumption)
export const KV_OPENSEA_LAST_SYNC_KEY = "opensea_last_sync_at";
const NEYNAR_VIEWER_FID = 1129138;
const LAUNCH_AT_UTC_MS = Date.UTC(2026, 4, 1, 0, 1, 0); // 1 May 2026, 00:01:00 UTC
const CHANGE_PERIOD_MS = 10 * 24 * 60 * 60 * 1000;
const CHANGE_PERIOD_COUNT = 10;

// ---------------------------------------------------------------------------
// Env capture
//
// Cloudflare Workers env bindings are constant for the lifetime of an isolate
// (they never change between requests). Capturing them on the first request is
// therefore safe and avoids threading `c.env` through every helper.
// ---------------------------------------------------------------------------

let envBindings: Env | undefined;

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------

/** Resolve the Farcaster username for a FID via the public quilibrium API. */
async function fetchUsername(fid: number): Promise<string> {
  try {
    const res = await fetch(
      `https://haatz.quilibrium.com/v2/farcaster/user?fid=${fid}`,
    );
    if (!res.ok) return `fid:${fid}`;
    const data = (await res.json()) as Record<string, unknown>;
    const user = data.user as Record<string, unknown> | undefined;
    return (
      (user?.username as string | undefined) ??
      (data.username as string | undefined) ??
      `fid:${fid}`
    );
  } catch {
    return `fid:${fid}`;
  }
}

/**
 * Ensure a row exists in `users` for the given FID, creating one (with a
 * username lookup) if it doesn't. Returns the row's `id`.
 */
async function upsertUser(WARPLETS: D1Database, fid: number): Promise<number> {
  const existing = await WARPLETS.prepare("SELECT id FROM users WHERE fid = ?")
    .bind(fid)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const username = await fetchUsername(fid);
  const inserted = await WARPLETS.prepare(
    "INSERT INTO users (fid, username) VALUES (?, ?) RETURNING id",
  )
    .bind(fid, username)
    .first<{ id: number }>();
  if (!inserted) throw new Error(`Failed to insert user for fid ${fid}`);
  return inserted.id;
}

/** Append a new vote row to `votes`. */
async function recordVote(
  WARPLETS: D1Database,
  userId: number,
  option: string,
): Promise<void> {
  await WARPLETS.prepare("INSERT INTO votes (user_id, poll_option) VALUES (?, ?)")
    .bind(userId, option)
    .run();
}

/**
 * Recalculate per-option totals from D1 and write the result to KV.
 * Returns the fresh totals so they can be used in the same request.
 */
async function refreshPollResultsKV(
  WARPLETS: D1Database,
  WARPLETS_KV: KVNamespace,
): Promise<Record<string, number>> {
  const rows = await WARPLETS.prepare(
    "SELECT poll_option, COUNT(*) as count FROM votes GROUP BY poll_option",
  ).all<{ poll_option: string; count: number }>();

  const results: Record<string, number> = Object.fromEntries(
    COLOURS.map((c) => [c.id, 0]),
  );
  for (const row of rows.results) {
    if (row.poll_option in results) results[row.poll_option] = row.count;
  }

  await WARPLETS_KV.put(KV_POLL_RESULTS_KEY, JSON.stringify(results));
  return results;
}

/**
 * Read aggregated poll totals from KV (fast, edge-local).
 * Falls back to all-zero counts if the key has not been written yet.
 */
async function getPollResultsFromKV(
  WARPLETS_KV: KVNamespace,
): Promise<Record<string, number>> {
  const cached = await WARPLETS_KV.get(KV_POLL_RESULTS_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as Record<string, number>;
    } catch {
      // corrupted value — fall through to defaults
    }
  }
  return Object.fromEntries(COLOURS.map((c) => [c.id, 0]));
}

/**
 * Return a deduplicated, sorted list of usernames of everyone who has voted
 * (queried from D1 so it is always consistent).
 */
async function getVoterUsernames(WARPLETS: D1Database): Promise<string[]> {
  const rows = await WARPLETS.prepare(
    "SELECT DISTINCT u.username" +
      " FROM votes v JOIN users u ON v.user_id = u.id" +
      " ORDER BY u.username",
  ).all<{ username: string }>();
  return rows.results.map((r) => r.username);
}

type NeynarUserRecord = {
  fid: number;
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

type LandingStats = {
  clicks: number;
  matches: number;
  buys: number;
};

type LandingImageEntry = {
  url: string;
  alt: string;
};

type LandingImageSections = {
  noList: LandingImageEntry[];
  yesList: LandingImageEntry[];
  buyers: LandingImageEntry[];
};

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

function getNeynarApiKey(): string | undefined {
  const key = (envBindings?.NEYNAR_API_KEY ?? process.env.NEYNAR_API_KEY)?.trim();
  return key && key.length > 0 ? key : undefined;
}

async function fetchNeynarUserByFid(fid: number): Promise<NeynarUserRecord | undefined> {
  const apiKey = getNeynarApiKey();
  if (!apiKey) {
    return undefined;
  }

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${NEYNAR_VIEWER_FID}&fids=${fid}`;
    const res = await fetch(endpoint, {
      headers: {
        "x-api-key": apiKey,
      },
    });
    if (!res.ok) {
      return undefined;
    }

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
      fid,
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
  } catch (err) {
    return undefined;
  }
}

async function hasWarpletMatchByFid(
  WARPLETS: D1Database,
  fid: number,
): Promise<boolean> {
  const match = await WARPLETS.prepare(
    "SELECT 1 AS matched FROM warplets_metadata WHERE fid_value = ? LIMIT 1",
  )
    .bind(fid)
    .first<{ matched: number }>();

  return Boolean(match);
}

async function refreshLandingStatsKV(
  WARPLETS: D1Database,
  WARPLETS_KV: KVNamespace,
): Promise<LandingStats> {
  const [clicksRow, matchesRow, buysRow] = await Promise.all([
    WARPLETS.prepare("SELECT COUNT(*) AS count FROM warplets_users").first<{ count: number }>(),
    WARPLETS.prepare("SELECT COUNT(*) AS count FROM warplets_users WHERE matched_on IS NOT NULL").first<{ count: number }>(),
    WARPLETS.prepare("SELECT COUNT(*) AS count FROM warplets_users WHERE buy_on IS NOT NULL").first<{ count: number }>(),
  ]);

  const stats: LandingStats = {
    clicks: clicksRow?.count ?? 0,
    matches: matchesRow?.count ?? 0,
    buys: buysRow?.count ?? 0,
  };

  await Promise.all([
    WARPLETS_KV.put(KV_STATS_CLICKS_KEY, String(stats.clicks)),
    WARPLETS_KV.put(KV_STATS_MATCHES_KEY, String(stats.matches)),
    WARPLETS_KV.put(KV_STATS_BUYS_KEY, String(stats.buys)),
  ]);

  return stats;
}

async function getLandingStatsFromKV(
  WARPLETS: D1Database,
  WARPLETS_KV: KVNamespace,
): Promise<LandingStats> {
  const [clicksRaw, matchesRaw, buysRaw] = await Promise.all([
    WARPLETS_KV.get(KV_STATS_CLICKS_KEY),
    WARPLETS_KV.get(KV_STATS_MATCHES_KEY),
    WARPLETS_KV.get(KV_STATS_BUYS_KEY),
  ]);

  const clicks = Number.parseInt(clicksRaw ?? "", 10);
  const matches = Number.parseInt(matchesRaw ?? "", 10);
  const buys = Number.parseInt(buysRaw ?? "", 10);

  if ([clicks, matches, buys].every((n) => Number.isInteger(n) && n >= 0)) {
    return { clicks, matches, buys };
  }

  return refreshLandingStatsKV(WARPLETS, WARPLETS_KV);
}

async function trackClaimClick(
  WARPLETS: D1Database,
  WARPLETS_KV: KVNamespace,
  fid: number,
): Promise<void> {
  const existing = await WARPLETS.prepare(
    "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1",
  )
    .bind(fid)
    .first<{ id: number }>();
  if (existing) return;

  const [neynarUser, isMatch] = await Promise.all([
    fetchNeynarUserByFid(fid),
    hasWarpletMatchByFid(WARPLETS, fid),
  ]);
  const now = new Date().toISOString();

  await WARPLETS.prepare(
    "INSERT INTO warplets_users (" +
      "fid, username, display_name, pfp_url, registered_at, pro_status, profile_bio_text, " +
      "follower_count, following_count, primary_eth_address, primary_sol_address, x_username, " +
      "url, viewer_following, viewer_followed_by, score, matched_on, buy_on, created_on, updated_on" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      now,
      now,
    )
    .run();

  await refreshLandingStatsKV(WARPLETS, WARPLETS_KV);
}

// ---------------------------------------------------------------------------
// URL helper
// ---------------------------------------------------------------------------

function snapBaseUrl(request: Request): string {
  const fromEnv = (
    envBindings?.SNAP_PUBLIC_BASE_URL ?? process.env.SNAP_PUBLIC_BASE_URL
  )?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`.replace(/\/$/, "");
}

function actionFid(action: unknown): number | undefined {
  if (!action || typeof action !== "object") return undefined;
  const maybeFid = (action as { fid?: unknown }).fid;
  return typeof maybeFid === "number" ? maybeFid : undefined;
}

function getNextPriceChangeCountdown(nowMs: number): {
  days: number;
  hours: number;
  minutes: number;
} {
  const firstChangeMs = LAUNCH_AT_UTC_MS + CHANGE_PERIOD_MS;
  const lastChangeMs = LAUNCH_AT_UTC_MS + CHANGE_PERIOD_MS * CHANGE_PERIOD_COUNT;

  let nextChangeMs = firstChangeMs;
  if (nowMs >= firstChangeMs) {
    nextChangeMs = 0;
    for (let period = 1; period <= CHANGE_PERIOD_COUNT; period++) {
      const candidate = LAUNCH_AT_UTC_MS + CHANGE_PERIOD_MS * period;
      if (nowMs < candidate) {
        nextChangeMs = candidate;
        break;
      }
    }
  }

  const remainingMs =
    nowMs >= lastChangeMs ? 0 : Math.max(0, nextChangeMs - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { days, hours, minutes };
}

type RecentMatchEntry = {
  jpg_url: string;
  warplet_username_farcaster: string;
};

async function getRecentMatchPreview(
  WARPLETS: D1Database,
): Promise<RecentMatchEntry[]> {
  const rows = await WARPLETS.prepare(
    "SELECT jpg_url, warplet_username_farcaster FROM warplets_metadata ORDER BY token_id ASC LIMIT 24",
  ).all<{
    jpg_url: string | null;
    warplet_username_farcaster: string | null;
  }>();

  return rows.results
    .filter((row) => typeof row.jpg_url === "string" && row.jpg_url.length > 0)
    .map((row) => ({
      jpg_url: row.jpg_url as string,
      warplet_username_farcaster:
        row.warplet_username_farcaster?.trim() || "unknown",
    }));
}

async function getLandingImageSections(
  WARPLETS: D1Database,
  seed: boolean,
  base: string,
): Promise<LandingImageSections> {
  const toEntry = (row: {
    pfp_url: string;
    username: string | null;
    display_name: string | null;
  }): LandingImageEntry => ({
    url: `${base}/img-proxy.jpg?url=${encodeURIComponent(row.pfp_url)}`,
    alt: row.display_name ?? row.username ?? "unknown",
  });

  const [noRows, yesRows, buyerRows] = await Promise.all([
    WARPLETS.prepare(
      "SELECT pfp_url, username, display_name FROM warplets_users WHERE matched_on IS NULL AND pfp_url IS NOT NULL ORDER BY created_on DESC LIMIT 24",
    ).all<{ pfp_url: string; username: string | null; display_name: string | null }>(),
    WARPLETS.prepare(
      "SELECT pfp_url, username, display_name FROM warplets_users WHERE matched_on IS NOT NULL AND pfp_url IS NOT NULL ORDER BY matched_on DESC LIMIT 24",
    ).all<{ pfp_url: string; username: string | null; display_name: string | null }>(),
    WARPLETS.prepare(
      "SELECT pfp_url, username, display_name FROM warplets_users WHERE buy_on IS NOT NULL AND pfp_url IS NOT NULL ORDER BY buy_on DESC LIMIT 24",
    ).all<{ pfp_url: string; username: string | null; display_name: string | null }>(),
  ]);

  const noList = noRows.results.map(toEntry).slice(0, 8);
  const yesList = yesRows.results.map(toEntry).slice(0, 8);
  const buyers = buyerRows.results.map(toEntry).slice(0, 8);

  if (seed) {
    const needNo = Math.max(0, 8 - noList.length);
    const needYes = Math.max(0, 8 - yesList.length);
    const needBuyers = Math.max(0, 8 - buyers.length);
    const neededTotal = needNo + needYes + needBuyers;

    if (neededTotal > 0) {
      const seedRows = await WARPLETS.prepare(
        "SELECT jpg_url, warplet_username_farcaster FROM warplets_metadata WHERE jpg_url IS NOT NULL ORDER BY RANDOM() LIMIT ?",
      )
        .bind(neededTotal)
        .all<{ jpg_url: string; warplet_username_farcaster: string | null }>();

      const seeds: LandingImageEntry[] = seedRows.results.map((r) => ({
        url: r.jpg_url,
        alt: r.warplet_username_farcaster ?? "unknown",
      }));

      let si = 0;
      while (noList.length < 8 && si < seeds.length) noList.push(seeds[si++]);
      while (yesList.length < 8 && si < seeds.length) yesList.push(seeds[si++]);
      while (buyers.length < 8 && si < seeds.length) buyers.push(seeds[si++]);
    }
  }

  return { noList, yesList, buyers };
}

// ---------------------------------------------------------------------------
// Snap page builders
// ---------------------------------------------------------------------------

function pollPage(base: string, viewerName?: string): SnapHandlerResult {
  const heading = viewerName
    ? `What's your favourite colour, ${viewerName}?`
    : "What's your favourite colour?";

  return {
    version: "2.0",
    theme: { accent: "purple" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: [
            "heading",
            "subtext",
            "btn_red",
            "btn_blue",
            "btn_green",
            "btn_yellow",
            "btn_purple",
          ],
        },
        heading: {
          type: "text",
          props: { content: heading, weight: "bold" },
        },
        subtext: {
          type: "text",
          props: { content: "Tap a colour to cast your vote!", size: "sm" },
        },
        btn_red: {
          type: "button",
          props: { label: "🔴 Red", variant: "primary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/poll?colour=red` },
            },
          },
        },
        btn_blue: {
          type: "button",
          props: { label: "🔵 Blue" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/poll?colour=blue` },
            },
          },
        },
        btn_green: {
          type: "button",
          props: { label: "🟢 Green" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/poll?colour=green` },
            },
          },
        },
        btn_yellow: {
          type: "button",
          props: { label: "🟡 Yellow" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/poll?colour=yellow` },
            },
          },
        },
        btn_purple: {
          type: "button",
          props: { label: "🟣 Purple" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/poll?colour=purple` },
            },
          },
        },
      },
    },
  };
}

function resultsPage(
  base: string,
  voteCounts: Record<string, number>,
  voters: string[],
): SnapHandlerResult {
  const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
  const bars = COLOURS.map((c) => ({
    label: c.label,
    value: voteCounts[c.id] ?? 0,
    color: c.color,
  }));
  const votersText =
    voters.length > 0
      ? `👥 Voters: ${voters.join(", ")}`
      : "👥 No votes yet";

  return {
    version: "2.0",
    theme: { accent: "purple" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: ["heading", "chart", "total", "sep", "voters", "reset"],
        },
        heading: {
          type: "text",
          props: { content: "Poll Results", weight: "bold" },
        },
        chart: {
          type: "bar_chart",
          props: { bars },
        },
        total: {
          type: "text",
          props: {
            content: `${totalVotes} vote${totalVotes === 1 ? "" : "s"} total`,
            size: "sm",
          },
        },
        sep: {
          type: "separator",
          props: {},
        },
        voters: {
          type: "text",
          props: { content: votersText, size: "sm" },
        },
        reset: {
          type: "button",
          props: { label: "Vote Again", variant: "primary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/poll` },
            },
          },
        },
      },
    },
  };
}

function landingPage(
  base: string,
  forceNoMatch = false,
  imageSections: LandingImageSections,
  landingStats: LandingStats,
): SnapHandlerResult {
  const claimTarget = forceNoMatch ? `${base}/claim?match=false` : `${base}/claim`;
  const counterValues = [
    String(landingStats.clicks),
    String(landingStats.matches),
    String(landingStats.buys),
  ];
  const countdown = getNextPriceChangeCountdown(Date.now());

  const elements: Record<string, SnapElementInput> = {};
  const pageChildren: string[] = ["top_section", "countdown_section"];

  // Build an image section only if it has items; hide it otherwise.
  function buildImageSection(
    prefix: string,
    title: string,
    items: LandingImageEntry[],
  ): void {
    if (items.length === 0) return;
    pageChildren.push(`${prefix}_section`);
    const rowCount = items.length > 4 ? 2 : 1;
    elements[`${prefix}_section`] = {
      type: "stack",
      props: { gap: "md" },
      children: [
        `${prefix}_title`,
        ...Array.from({ length: rowCount }, (_, i) => `${prefix}_row_${i}`),
      ],
    };
    elements[`${prefix}_title`] = {
      type: "text",
      props: { content: title, weight: "bold" },
    };
    for (let row = 0; row < rowCount; row++) {
      const rowChildren: string[] = [];
      elements[`${prefix}_row_${row}`] = {
        type: "stack",
        props: { direction: "horizontal", gap: "md" },
        children: rowChildren,
      };
      for (let col = 0; col < 4; col++) {
        const index = row * 4 + col;
        const item = items[index];
        if (!item) continue;
        const imageId = `${prefix}_item_image_${index}`;
        rowChildren.push(imageId);
        elements[imageId] = {
          type: "image",
          props: { url: item.url, aspect: "1:1", alt: item.alt },
        };
      }
    }
  }

  buildImageSection("list_no", "😭 You're not on the list", imageSections.noList);
  buildImageSection("list_yes", "🎉 You're on the list", imageSections.yesList);
  buildImageSection("list_buyer", "👏 You're a buyer!", imageSections.buyers);
  pageChildren.push("insights_section");

  elements["page"] = { type: "stack", props: {}, children: pageChildren };

  elements["top_section"] = {
    type: "stack",
    props: {},
    children: ["banner", "image", "claim"],
  };
  elements["banner"] = {
    type: "text",
    props: { content: "🟢 10X Warplets - Private 10K NFT Drop", weight: "bold" },
  };
  elements["image"] = {
    type: "image",
    props: {
      url: "https://files.10x.meme/warplets-snap-preview.webp",
      aspect: "1:1",
      alt: "Loading...",
    },
  };
  elements["claim"] = {
    type: "button",
    props: { label: "👉 Don't miss out (click here)", variant: "primary" },
    on: {
      press: {
        action: "submit",
        params: { target: claimTarget },
      },
    },
  };
  elements["countdown_section"] = {
    type: "stack",
    props: { gap: "md" },
    children: ["countdown_title", "countdown_badges"],
  };
  elements["countdown_title"] = {
    type: "text",
    props: { content: "⌛ Price increases, supply decreases in...", weight: "bold" },
  };
  elements["countdown_badges"] = {
    type: "cell_grid",
    props: {
      cols: 3,
      rows: 1,
      gap: "md",
      cells: [
        { row: 0, col: 0, content: `${countdown.days} Days` },
        { row: 0, col: 1, content: `${countdown.hours} Hours` },
        { row: 0, col: 2, content: `${countdown.minutes} Minutes` },
      ],
    },
  };
  elements["insights_section"] = {
    type: "stack",
    props: { gap: "md" },
    children: [
      "list_no_metrics_title",
      "list_no_metrics",
      "opensea_block",
      "twitter_block",
      "farcaster_block",
    ],
  };
  elements["opensea_block"] = {
    type: "stack",
    props: { gap: "md" },
    children: ["menu_opensea_title", "menu_about_10x_warplets", "menu_about_1m_warplet"],
  };
  elements["twitter_block"] = {
    type: "stack",
    props: { gap: "md" },
    children: ["menu_twitter_title", "menu_follow_10x_meme_x", "menu_follow_10x_chris_x"],
  };
  elements["farcaster_block"] = {
    type: "stack",
    props: { gap: "md" },
    children: ["menu_farcaster_title", "menu_follow_10x_meme_fc", "menu_follow_10x_chris_fc"],
  };
  elements["list_no_metrics_title"] = {
    type: "text",
    props: { content: "🤓 Numbers go up", weight: "bold" },
  };
  elements["list_no_metrics"] = {
    type: "cell_grid",
    props: {
      cols: 3,
      rows: 2,
      gap: "md",
      cells: [
        { row: 0, col: 0, content: "Clicks" },
        { row: 0, col: 1, content: "Matches" },
        { row: 0, col: 2, content: "Buys" },
        { row: 1, col: 0, content: counterValues[0] },
        { row: 1, col: 1, content: counterValues[1] },
        { row: 1, col: 2, content: counterValues[2] },
      ],
    },
  };
  elements["menu_opensea_title"] = {
    type: "text",
    props: { content: "🛳️ OpenSea", weight: "bold" },
  };
  elements["menu_twitter_title"] = {
    type: "text",
    props: { content: "𝕏 Twitter", weight: "bold" },
  };
  elements["menu_farcaster_title"] = {
    type: "text",
    props: { content: "⛩️ Farcaster", weight: "bold" },
  };
  elements["menu_about_10x_warplets"] = {
    type: "button",
    props: { label: "10X Warplets → About page" },
    on: {
      press: {
        action: "open_url",
        params: { target: "https://opensea.io/collection/10xwarplets/overview" },
      },
    },
  };
  elements["menu_about_1m_warplet"] = {
    type: "button",
    props: { label: "$1M Warplet → About page" },
    on: {
      press: {
        action: "open_url",
        params: { target: "https://opensea.io/collection/1m-warplet-1-the-one/overview" },
      },
    },
  };
  elements["menu_follow_10x_meme_fc"] = {
    type: "button",
    props: { label: "Follow @10XMeme.eth" },
    on: {
      press: {
        action: "view_profile",
        params: { fid: 1313340 },
      },
    },
  };
  elements["menu_follow_10x_meme_x"] = {
    type: "button",
    props: { label: "Follow @10XMemeX" },
    on: {
      press: {
        action: "open_url",
        params: { target: "https://twitter.com/intent/follow?user_id=3275559396" },
      },
    },
  };
  elements["menu_follow_10x_chris_fc"] = {
    type: "button",
    props: { label: "Follow @10XChris.eth" },
    on: {
      press: {
        action: "view_profile",
        params: { fid: 1129138 },
      },
    },
  };
  elements["menu_follow_10x_chris_x"] = {
    type: "button",
    props: { label: "Follow @10XChrisX" },
    on: {
      press: {
        action: "open_url",
        params: { target: "https://twitter.com/intent/follow?user_id=18302782" },
      },
    },
  };

  return {
    version: "2.0",
    theme: { accent: "green" },
    ui: {
      root: "page",
      elements,
    },
  };
}

function claimResultPage(
  isMatch: boolean,
  fidValue?: number,
  rarityValue?: number,
): SnapHandlerResult {
  let showWinnerUi =
    isMatch && typeof fidValue === "number" && typeof rarityValue === "number";
  
  // isMatch = false; // for testing
  // showWinnerUi = false; // Disable winner UI for now since the rarity metadata is not fully ready yet. This will be re-enabled in the future once the metadata is ready.
  
  return {
    version: "2.0",
    effects: showWinnerUi ? ["confetti"] : undefined,
    theme: { accent: "green"},
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: showWinnerUi
            ? ["heading", "image", "claim"]
            : ["heading", "image", "claim"],
        },
        heading: {
          type: "text",
          props: {
            content: isMatch
              ? "🎉 Congratulations! You're on the list..."
              : "😭 Oh Snap... You're not on the list.",
            weight: "bold",
          },
        },
        image: {
          type: "image",
          props: {
            url: isMatch
              ? `https://warplets.10x.meme/${rarityValue}.gif`
              : `https://warplets.10x.meme/3081.png`,
            aspect: "1:1",
            alt: "Loading...",
          },
        },
        claim: {
          type: "button",
          props: { 
            label: isMatch
              ? "Buy on OpenSea (login to see listing)"
              : "Visit OpenSea to find out why...",
            variant: "primary" },
          on: {
            press: {
              action: "open_url",
              params: {
                target: isMatch
                  ? `https://opensea.io/item/base/0x780446dd12e080ae0db762fcd4daf313f3e359de/${rarityValue}`
                  : "https://opensea.io/collection/10xwarplets/overview",
              },
            },
          },
        },
      },
    },
  };
}

async function getWarpletRarityByFid(
  WARPLETS: D1Database,
  fid: number,
): Promise<number | undefined> {
  const row = await WARPLETS.prepare(
    "SELECT x10_rarity FROM warplets_metadata WHERE fid_value = ? LIMIT 1",
  )
    .bind(fid)
    .first<{ x10_rarity: number | null }>();

  return typeof row?.x10_rarity === "number" ? row.x10_rarity : undefined;
}

// ---------------------------------------------------------------------------
// Snap handler
// ---------------------------------------------------------------------------

const snap: SnapFunction = async (ctx) => {
  const url = new URL(ctx.request.url);
  const pathname = url.pathname;
  const colour = url.searchParams.get("colour");
  const forceNoMatch = url.searchParams.get("match") === "false";
  const recentParam = url.searchParams.get("recent");
  const seedImages = url.searchParams.get("seed") === "true";
  // recent=true uses the old static warplets_metadata preview.
  // recent=false or absent loads dynamically from warplets_users.
  const loadStaticPreview = recentParam === "true";
  const base = snapBaseUrl(ctx.request);
  const { WARPLETS, WARPLETS_KV } = envBindings!;
  const fid = actionFid(ctx.action);

  if (pathname === "/") {
    const [landingStats, imageSections] = await Promise.all([
      getLandingStatsFromKV(WARPLETS, WARPLETS_KV),
      loadStaticPreview
        ? getRecentMatchPreview(WARPLETS).then((ms) => ({
            noList: ms.slice(8, 16).map((m) => ({ url: m.jpg_url, alt: m.warplet_username_farcaster })),
            yesList: ms.slice(0, 8).map((m) => ({ url: m.jpg_url, alt: m.warplet_username_farcaster })),
            buyers: ms.slice(16, 24).map((m) => ({ url: m.jpg_url, alt: m.warplet_username_farcaster })),
          }))
        : getLandingImageSections(WARPLETS, seedImages, base),
    ]);
    return landingPage(base, forceNoMatch, imageSections, landingStats);
  }

  if (pathname === "/claim") {
    if (ctx.action.type === "post" && fid) {
      await trackClaimClick(WARPLETS, WARPLETS_KV, fid);
    }

    if (ctx.action.type !== "post" || !fid) {
      return claimResultPage(false);
    }

    const rarityValue = await getWarpletRarityByFid(WARPLETS, fid);
    const isMatch = !forceNoMatch && typeof rarityValue === "number";
    return claimResultPage(isMatch, fid, rarityValue);
  }

  if (pathname !== "/poll") {
    const [landingStats, imageSections] = await Promise.all([
      getLandingStatsFromKV(WARPLETS, WARPLETS_KV),
      loadStaticPreview
        ? getRecentMatchPreview(WARPLETS).then((ms) => ({
            noList: ms.slice(8, 16).map((m) => ({ url: m.jpg_url, alt: m.warplet_username_farcaster })),
            yesList: ms.slice(0, 8).map((m) => ({ url: m.jpg_url, alt: m.warplet_username_farcaster })),
            buyers: ms.slice(16, 24).map((m) => ({ url: m.jpg_url, alt: m.warplet_username_farcaster })),
          }))
        : getLandingImageSections(WARPLETS, seedImages, base),
    ]);
    return landingPage(base, forceNoMatch, imageSections, landingStats);
  }

  if (ctx.action.type === "post" && colour !== null && VALID_OPTIONS.has(colour)) {
    // 1. Ensure the voter exists in D1 (look up username on first visit)
    const userId = await upsertUser(WARPLETS, ctx.action.fid);

    // 2. Persist the vote in D1
    await recordVote(WARPLETS, userId, colour);

    // 3. Recalculate aggregated totals and push to KV cache
    const voteCounts = await refreshPollResultsKV(WARPLETS, WARPLETS_KV);

    // 4. Fetch distinct voter usernames from D1 for display
    const voters = await getVoterUsernames(WARPLETS);

    return resultsPage(base, voteCounts, voters);
  }

  const viewerName = fid ? await fetchUsername(fid) : undefined;
  return pollPage(base, viewerName);
};

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  if (options.devTunnelToken) {
    app.get("/__dev/health", (c) => {
      return c.json({ ok: true, token: options.devTunnelToken });
    });
  }

  // Image proxy: rewrites arbitrary upstream image URLs to a path ending in
  // .jpg so the snap framework's URL extension check is satisfied. Only HTTPS
  // upstream URLs are allowed to prevent SSRF against internal services.
  app.get("/img-proxy.jpg", async (c) => {
    const rawUrl = c.req.query("url");
    if (!rawUrl) return c.text("Missing url parameter", 400);

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return c.text("Invalid URL", 400);
    }

    if (parsed.protocol !== "https:") {
      return c.text("Only HTTPS URLs are allowed", 400);
    }

    const upstream = await fetch(rawUrl, {
      headers: { "User-Agent": "Warplets-ImageProxy/1.0" },
    });
    if (!upstream.ok) {
      return c.text("Failed to fetch image", 502);
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    return new Response(upstream.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400",
      },
    });
  });

  // Capture env bindings on the first request (safe: bindings are constant per isolate)
  app.use("*", async (c, next) => {
    if (!envBindings) envBindings = c.env as Env;
    await next();
  });

  const sharedSnapOptions = {
    skipJFSVerification: options.skipJFSVerification,
  };

  // OG image generation (PNG) is disabled here because @resvg/resvg-wasm may
  // behave differently on Cloudflare Workers edge runtime. The `openGraph`
  // option below still sets the <title> and <meta> tags on the browser fallback
  // HTML page (shown when visiting the URL in a regular browser).
  registerSnapHandler(app, snap, {
    ...sharedSnapOptions,
    path: "/",
    og: false,
    openGraph: {
      title: "10X Warplets",
      description: "Builders, capital, and signal - aligned.",
    },
  });

  registerSnapHandler(app, snap, {
    ...sharedSnapOptions,
    path: "/poll",
    og: false,
    openGraph: {
      title: "10X Warplets",
      description: "Builders, capital, and signal - aligned.",
    },
  });

  registerSnapHandler(app, snap, {
    ...sharedSnapOptions,
    path: "/claim",
    og: false,
    openGraph: {
      title: "10X Warplets",
      description: "Builders, capital, and signal - aligned.",
    },
  });

  return app;
}
