import {
  handleStatsActivityGet,
  handleStatsHoldersGet,
  handleStatsHoldersMeGet,
  handleStatsMarketGet,
  handleStatsOverviewGet,
  loadStatsFriendHoldersForShare,
  type StatsEnv,
} from "./stats.js";
import { jsonSecure, rateLimit, readJsonBodyWithLimit } from "./security.js";
import { WARPLETS_APP_HOSTS } from "../../shared/warpletsApp.js";
import type { Page } from "@cloudflare/puppeteer";
import {
  STATS_SHARE_OG_HEIGHT,
  STATS_SHARE_OG_WIDTH,
  STATS_SHARE_RENDERER_VERSION,
  STATS_SHARE_SQUARE_SIZE,
  buildStatsHolderRankText,
  buildStatsLeaderboardText,
  getStatsShareActivityLabel,
  getStatsShareActivityApiPath,
  getStatsShareContentHash,
  getStatsShareLaunchPath,
  getStatsShareMarketLabel,
  getStatsShareRangeLabel,
  parseStatsShareRequest,
  stableStatsShareJson,
  type StatsShareCreateResponse,
  type StatsShareHolder,
  type StatsShareRequest,
  type StatsShareSnapshot,
} from "../../src/statsShare.js";

export interface StatsSharesEnv extends StatsEnv {
  STATS_SHARE_IMAGES?: R2Bucket;
  STATS_SHARE_BROWSER?: unknown;
  NEYNAR_API_KEY?: string;
}

type StoredStatsShareRow = {
  id: string;
  kind: StatsShareSnapshot["kind"];
  request_json: string;
  snapshot_json: string;
  title: string;
  farcaster_text: string;
  twitter_text: string;
  launch_path: string;
  image_key: string;
  image_status: string;
  renderer_version: string;
  data_as_of: string | null;
  created_at: string;
};

function cloneStatsContext(
  context: EventContext<StatsSharesEnv, string, unknown>,
  pathname: string,
): EventContext<StatsEnv, string, unknown> {
  const requestUrl = new URL(context.request.url);
  const target = new URL(pathname, requestUrl.origin);
  return {
    ...context,
    request: new Request(target, { headers: { accept: "application/json" } }),
  } as EventContext<StatsEnv, string, unknown>;
}

async function readStatsResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string" ? payload.error : `Stats request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNumber(value: unknown): number | null {
  const metric = asRecord(value);
  const candidate = metric && "value" in metric ? metric.value : value;
  const number = typeof candidate === "number" ? candidate : Number(candidate);
  return Number.isFinite(number) ? number : null;
}

const OVERVIEW_WARPLET_COUNT = 22;

function appendTokenIds(target: number[], candidates: unknown[]): void {
  const seen = new Set(target);
  for (const candidate of candidates) {
    const tokenId = Number(candidate);
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10_000 || seen.has(tokenId)) continue;
    target.push(tokenId);
    seen.add(tokenId);
    if (target.length >= OVERVIEW_WARPLET_COUNT) return;
  }
}

function appendDeterministicRandomTokenIds(target: number[], seedText: string): void {
  let seed = 2166136261;
  for (const character of seedText) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  while (target.length < OVERVIEW_WARPLET_COUNT) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    appendTokenIds(target, [(seed % 10_000) + 1]);
  }
}

async function orderOverviewTokenIdsByRarity(env: StatsSharesEnv, candidates: unknown[]): Promise<number[]> {
  const tokenIds: number[] = [];
  appendTokenIds(tokenIds, candidates);
  if (tokenIds.length < 2) return tokenIds;
  const placeholders = tokenIds.map(() => "?").join(", ");
  const rows = await env.WARPLETS.prepare(
    `SELECT token_id, COALESCE(x10_rarity, token_id) AS rarity_rank
     FROM warplets_metadata
     WHERE token_id IN (${placeholders})
     ORDER BY rarity_rank ASC, token_id ASC`,
  ).bind(...tokenIds).all<{ token_id: number }>().catch(() => ({ results: [] }));
  const ranked = (rows.results ?? []).map((row) => row.token_id);
  appendTokenIds(ranked, tokenIds);
  return ranked;
}

async function loadOverviewWarpletTokenIds(env: StatsSharesEnv, request: Extract<StatsShareRequest, { kind: "overview" }>): Promise<number[]> {
  let wallet = request.wallet ?? null;
  if (!wallet && request.fid) {
    wallet = await env.WARPLETS.prepare(
      "SELECT lower(wallet) AS wallet FROM wallet_farcaster_links WHERE fid = ? ORDER BY COALESCE(score, -1) DESC, wallet ASC LIMIT 1",
    ).bind(request.fid).first<{ wallet: string | null }>().then((row) => row?.wallet ?? null).catch(() => null);
  }

  const tokenIds: number[] = [];
  // If a transaction wallet was supplied, its collection is authoritative.
  // FID ownership is only a fallback for identity-only Mini App sessions.
  const ownershipConditions = wallet
    ? ["lower(owner_wallet) = ?"]
    : request.fid
      ? ["owner_fid = ?"]
      : [];
  if (ownershipConditions.length > 0) {
    const ownershipBindings = wallet ? [wallet] : [request.fid!];
    const owned = await env.WARPLETS.prepare(
      `SELECT m.token_id FROM warplet_market_state m
       LEFT JOIN warplets_metadata md ON md.token_id = m.token_id
       WHERE ${ownershipConditions.join(" OR ")}
       ORDER BY COALESCE(md.x10_rarity, m.token_id) ASC, m.token_id ASC LIMIT ?`,
    ).bind(...ownershipBindings, OVERVIEW_WARPLET_COUNT).all<{ token_id: number }>().catch(() => ({ results: [] }));
    appendTokenIds(tokenIds, (owned.results ?? []).map((row) => row.token_id));
  }

  if (wallet && tokenIds.length < OVERVIEW_WARPLET_COUNT) {
    const favouriteRow = await env.WARPLETS.prepare(
      "SELECT token_ids FROM warplet_favourites WHERE wallet = ? LIMIT 1",
    ).bind(wallet).first<{ token_ids: string | null }>().catch(() => null);
    if (favouriteRow?.token_ids) {
      try {
        const favourites = JSON.parse(favouriteRow.token_ids) as unknown;
        if (Array.isArray(favourites)) appendTokenIds(tokenIds, await orderOverviewTokenIdsByRarity(env, favourites));
      } catch {
        // Random Warplets fill any unavailable or malformed favourite data.
      }
    }
  }

  if (tokenIds.length < OVERVIEW_WARPLET_COUNT) {
    const randomTokenIds: number[] = [];
    appendDeterministicRandomTokenIds(randomTokenIds, wallet ?? (request.fid ? `fid:${request.fid}` : "10x-warplets-overview"));
    appendTokenIds(tokenIds, await orderOverviewTokenIdsByRarity(env, randomTokenIds));
  }
  return tokenIds;
}

function normalizeHolder(value: unknown): StatsShareHolder | null {
  const row = asRecord(value);
  const wallet = typeof row?.wallet === "string" ? row.wallet.trim().toLowerCase() : "";
  if (!wallet) return null;
  const tokenIds = Array.isArray(row?.previewTokenIds)
    ? row.previewTokenIds.map(Number).filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0).slice(0, 5)
    : [];
  const stringOrNull = (candidate: unknown) => typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
  return {
    rank: asNumber(row?.rank),
    wallet,
    fid: asNumber(row?.fid),
    username: stringOrNull(row?.username),
    displayName: stringOrNull(row?.displayName),
    pfpUrl: stringOrNull(row?.pfpUrl),
    xUsername: stringOrNull(row?.xUsername),
    ownedCount: asNumber(row?.ownedCount) ?? 0,
    ownedPct: asNumber(row?.ownedPct) ?? 0,
    bestRarityRank: asNumber(row?.bestRarityRank),
    previewTokenIds: tokenIds,
    remainingCount: asNumber(row?.remainingCount) ?? Math.max(0, (asNumber(row?.ownedCount) ?? 0) - tokenIds.length),
    floorValueEth: asNumber(row?.floorValueEth),
    isViewer: row?.isViewer === true,
    isTopFriend: row?.isTopFriend === true,
  };
}

async function fillVerifiedXUsernames(env: StatsSharesEnv, holders: StatsShareHolder[]): Promise<StatsShareHolder[]> {
  const missingFids = [...new Set(holders
    .filter((holder) => !holder.xUsername && holder.fid)
    .map((holder) => holder.fid as number))];
  if (missingFids.length === 0) return holders;

  try {
    const cached = await env.WARPLETS.prepare(
      `SELECT fid, x_username FROM warplets_users
       WHERE fid IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
    ).bind(JSON.stringify(missingFids)).all<{ fid: number; x_username: string | null }>();
    const cachedByFid = new Map((cached.results ?? [])
      .filter((row) => row.x_username)
      .map((row) => [row.fid, row.x_username as string]));
    holders = holders.map((holder) => ({
      ...holder,
      xUsername: holder.xUsername ?? (holder.fid ? cachedByFid.get(holder.fid) ?? null : null),
    }));
  } catch {
    // Continue to the public Neynar fallback when the local profile cache is unavailable.
  }

  const unresolvedFids = [...new Set(holders
    .filter((holder) => !holder.xUsername && holder.fid)
    .map((holder) => holder.fid as number))];
  const apiKey = env.NEYNAR_API_KEY?.trim();
  if (!apiKey || unresolvedFids.length === 0) return holders;

  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(unresolvedFids.join(","))}`,
      { headers: { accept: "application/json", api_key: apiKey } },
    );
    if (!response.ok) return holders;
    const payload = await response.json() as { users?: unknown[] };
    const byFid = new Map<number, string>();
    for (const candidate of Array.isArray(payload.users) ? payload.users : []) {
      const user = asRecord(candidate);
      const fid = asNumber(user?.fid);
      const accounts = Array.isArray(user?.verified_accounts) ? user.verified_accounts : [];
      const verified = accounts.map(asRecord).find((account) => {
        const platform = typeof account?.platform === "string" ? account.platform.toLowerCase() : "";
        return platform === "x" || platform === "twitter";
      });
      const username = typeof verified?.username === "string" ? verified.username.trim().replace(/^@+/, "") : "";
      if (fid && username) byFid.set(fid, username);
    }
    if (byFid.size > 0) {
      await Promise.all([...byFid].flatMap(([fid, username]) => [
        env.WARPLETS.prepare("UPDATE warplets_users SET x_username = COALESCE(x_username, ?) WHERE fid = ?")
          .bind(username, fid).run().catch(() => undefined),
        env.WARPLETS.prepare("UPDATE wallet_farcaster_links SET x_username = COALESCE(x_username, ?) WHERE fid = ?")
          .bind(username, fid).run().catch(() => undefined),
      ]));
      holders = holders.map((holder) => ({
        ...holder,
        xUsername: holder.xUsername ?? (holder.fid ? byFid.get(holder.fid) ?? null : null),
      }));
    }
  } catch {
    // X handles are an optional enhancement; profile name and wallet fallbacks remain valid.
  }
  return holders;
}

async function buildSnapshotData(
  context: EventContext<StatsSharesEnv, string, unknown>,
  request: StatsShareRequest,
): Promise<{ data: unknown; dataAsOf: string | null; title: string; farcasterText: string; twitterText: string }> {
  if (request.kind === "overview") {
    const [data, warpletTokenIds] = await Promise.all([
      readStatsResponse(await handleStatsOverviewGet(cloneStatsContext(context, "/api/stats/overview?range=all"))),
      loadOverviewWarpletTokenIds(context.env, request),
    ]);
    return {
      data: { ...data, warpletTokenIds },
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: request.panel === "fair-launch" ? "Share Fair Launch Stats" : "Share NFT Collection Stats",
      farcasterText: request.panel === "fair-launch" ? "10X Warplets — Fair Launch Stats" : "10X Warplets — NFT Collection Stats",
      twitterText: request.panel === "fair-launch" ? "10X Warplets — Fair Launch Stats" : "10X Warplets — NFT Collection Stats",
    };
  }

  if (request.kind === "market") {
    const data = await readStatsResponse(await handleStatsMarketGet(cloneStatsContext(context, `/api/stats/market?range=${request.range}`)));
    const text = `10X Warplets — ${getStatsShareMarketLabel(request.metric)} (${getStatsShareRangeLabel(request.range)})`;
    return {
      data: { ...data, metric: request.metric },
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: `Share ${getStatsShareMarketLabel(request.metric)}`,
      farcasterText: text,
      twitterText: text,
    };
  }

  if (request.kind === "market-all") {
    const data = await readStatsResponse(await handleStatsMarketGet(cloneStatsContext(context, `/api/stats/market?range=${request.range}`)));
    const text = `10X Warplets — Market Stats (${getStatsShareRangeLabel(request.range)})`;
    return {
      data,
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: "Share All Market Stats",
      farcasterText: text,
      twitterText: text,
    };
  }

  if (request.kind === "activity") {
    const data = await readStatsResponse(await handleStatsActivityGet(cloneStatsContext(
      context,
      getStatsShareActivityApiPath(request),
    )));
    const counts = asRecord(data.eventCounts);
    const count = Math.max(0, Math.trunc(asNumber(counts?.[request.event]) ?? 0));
    const subject = request.tokenId ? `10X Warplet #${request.tokenId}` : "10X Warplets";
    const text = `${subject} — ${count.toLocaleString("en-US")} ${getStatsShareActivityLabel(request.event, count)} (${getStatsShareRangeLabel(request.range)})`;
    return {
      data: { ...data, event: request.event, count },
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: request.tokenId ? `Share Item #${request.tokenId} Activity` : "Share Activity",
      farcasterText: text,
      twitterText: text,
    };
  }

  if (request.kind === "holder-rank") {
    const params = new URLSearchParams();
    if (request.wallet) params.set("wallet", request.wallet);
    if (request.fid) params.set("fid", String(request.fid));
    const data = await readStatsResponse(await handleStatsHoldersMeGet(cloneStatsContext(context, `/api/stats/holders/me?${params}`)));
    const holder = normalizeHolder(data.row ?? data.holder);
    if (!holder?.rank) throw new Error("This wallet is not currently ranked.");
    const total = Math.max(0, Math.trunc(asNumber(data.totalHolders) ?? 0));
    const text = `10X Warplets — My holder rank: #${holder.rank.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
    const rankWindow = (Array.isArray(data.rankWindow) ? data.rankWindow : [holder])
      .map(normalizeHolder)
      .filter((row): row is StatsShareHolder => Boolean(row));
    const enrichedRows = await fillVerifiedXUsernames(context.env, rankWindow);
    const enriched = enrichedRows.find((row) => row.wallet === holder.wallet)
      ?? (await fillVerifiedXUsernames(context.env, [holder]))[0];
    return {
      data: { row: enriched, rows: enrichedRows, totalHolders: total, asOf: data.asOf },
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: "Share Your Rank",
      farcasterText: buildStatsHolderRankText(text, enriched, enrichedRows, "farcaster"),
      twitterText: buildStatsHolderRankText(text, enriched, enrichedRows, "twitter"),
    };
  }

  let holders: StatsShareHolder[] = [];
  let viewer: StatsShareHolder | null = null;
  let totalHolders = 0;
  let dataAsOf: string | null = null;
  if (request.kind === "holders-top10") {
    const params = new URLSearchParams({ limit: "10" });
    let viewerWallet = request.wallet;
    if (!viewerWallet && request.fid) {
      const viewer = await readStatsResponse(await handleStatsHoldersMeGet(cloneStatsContext(context, `/api/stats/holders/me?fid=${request.fid}`)));
      viewerWallet = normalizeHolder(viewer.row ?? viewer.holder)?.wallet;
    }
    if (viewerWallet) params.set("wallet", viewerWallet);
    const data = await readStatsResponse(await handleStatsHoldersGet(cloneStatsContext(context, `/api/stats/holders?${params}`)));
    holders = (Array.isArray(data.rows) ? data.rows : []).map(normalizeHolder).filter((row): row is StatsShareHolder => Boolean(row));
    totalHolders = Math.max(0, Math.trunc(asNumber(asRecord(data.summary)?.holderCount) ?? 0));
    dataAsOf = typeof data.asOf === "string" ? data.asOf : null;
  } else {
    const viewerParams = new URLSearchParams({ fid: String(request.viewerFid) });
    if (request.wallet) viewerParams.set("wallet", request.wallet);
    const [result, viewerData] = await Promise.all([
      loadStatsFriendHoldersForShare(context.env, request.viewerFid),
      readStatsResponse(await handleStatsHoldersMeGet(cloneStatsContext(context, `/api/stats/holders/me?${viewerParams}`))).catch(() => null),
    ]);
    holders = result.rows.map(normalizeHolder).filter((row): row is StatsShareHolder => Boolean(row));
    viewer = normalizeHolder(viewerData?.row ?? viewerData?.holder);
    totalHolders = result.totalHolders;
    dataAsOf = result.asOf;
  }
  holders = await fillVerifiedXUsernames(context.env, holders);
  const heading = request.kind === "holders-top10"
    ? "10X Warplets — Top 10 Holders"
    : "10X Warplets — My Top Ranked Friends";
  return {
    data: { rows: holders, ...(viewer ? { viewer } : {}), totalHolders, asOf: dataAsOf },
    dataAsOf,
    title: request.kind === "holders-top10" ? "Share Top 10 Holders" : "Share Top 10 Friends",
    farcasterText: buildStatsLeaderboardText(heading, holders, "farcaster"),
    twitterText: buildStatsLeaderboardText(heading, holders, "twitter"),
  };
}

function parseStoredSnapshot(row: StoredStatsShareRow): StatsShareSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    request: JSON.parse(row.request_json) as StatsShareRequest,
    title: row.title,
    farcasterText: row.farcaster_text,
    twitterText: row.twitter_text,
    launchPath: row.launch_path,
    imageKey: row.image_key,
    imageReady: row.image_status === "ready",
    rendererVersion: row.renderer_version,
    dataAsOf: row.data_as_of,
    createdAt: row.created_at,
    data: JSON.parse(row.snapshot_json) as unknown,
  };
}

export function getStatsSharePublicOrigin(request: Request): string {
  const current = new URL(request.url);
  for (const header of [request.headers.get("referer"), request.headers.get("origin")]) {
    if (!header) continue;
    try {
      const candidate = new URL(header);
      if (current.protocol === "http:" && candidate.protocol === "https:" && candidate.hostname === current.hostname) {
        return candidate.origin;
      }
    } catch {
      // Continue to the local proxy metadata and request URL fallbacks.
    }
  }
  const forwardedOrigin = request.headers.get("x-10x-public-origin");
  const forwardedProto = request.headers.get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  if (current.protocol === "http:" && current.hostname === WARPLETS_APP_HOSTS[0] && forwardedProto === "https") {
    return `https://${current.host}`;
  }
  if (current.protocol === "http:" && current.hostname === WARPLETS_APP_HOSTS[0] && forwardedOrigin) {
    try {
      const candidate = new URL(forwardedOrigin);
      if (candidate.protocol === "https:" && candidate.hostname === current.hostname) return candidate.origin;
    } catch {
      // Ignore malformed local-proxy metadata.
    }
  }
  if (current.hostname !== "127.0.0.1" && current.hostname !== "localhost") return current.origin;
  for (const header of [request.headers.get("origin"), request.headers.get("referer")]) {
    if (!header) continue;
    try {
      const candidate = new URL(header);
      if (candidate.protocol === "https:" && candidate.hostname === WARPLETS_APP_HOSTS[0]) return candidate.origin;
    } catch {
      // Ignore malformed proxy headers and retain the request origin.
    }
  }
  return current.origin;
}

export async function loadStatsShareSnapshot(db: D1Database, id: string): Promise<StatsShareSnapshot | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const row = await db.prepare(
    `SELECT id, kind, request_json, snapshot_json, title, farcaster_text, twitter_text,
            launch_path, image_key, image_status, renderer_version, data_as_of, created_at
     FROM stats_share_snapshots WHERE id = ? LIMIT 1`,
  ).bind(id).first<StoredStatsShareRow>();
  return row ? parseStoredSnapshot(row) : null;
}

export async function loadLatestStatsShareSnapshotByLaunchPath(
  db: D1Database,
  launchPath: string,
): Promise<StatsShareSnapshot | null> {
  const row = await db.prepare(
    `SELECT id, kind, request_json, snapshot_json, title, farcaster_text, twitter_text,
            launch_path, image_key, image_status, renderer_version, data_as_of, created_at
       FROM stats_share_snapshots
      WHERE launch_path = ? AND image_status = 'ready'
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(launchPath).first<StoredStatsShareRow>();
  return row ? parseStoredSnapshot(row) : null;
}

function responseForSnapshot(request: Request, snapshot: StatsShareSnapshot, renderError?: string | null): StatsShareCreateResponse {
  const origin = getStatsSharePublicOrigin(request);
  return {
    snapshot,
    shareUrl: `${origin}/stats/share/${snapshot.id}`,
    imageUrl: `${origin}/api/stats/share-images/${snapshot.id}`,
    ogImageUrl: `${origin}/api/stats/share-images/${snapshot.id}/og`,
    ...(renderError ? { renderError } : {}),
  };
}

export function getStatsShareOgImageKey(snapshot: Pick<StatsShareSnapshot, "imageKey">): string {
  return snapshot.imageKey.endsWith(".png")
    ? `${snapshot.imageKey.slice(0, -4)}-og-1200x630.png`
    : `${snapshot.imageKey}-og-1200x630.png`;
}

function escapeStatsShareImageUrl(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildStatsShareOgDocument(squareImageUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{width:${STATS_SHARE_OG_WIDTH}px;height:${STATS_SHARE_OG_HEIGHT}px;margin:0;overflow:hidden;background:#000}
    body{display:flex;align-items:center;justify-content:center}
    img{display:block;width:${STATS_SHARE_OG_HEIGHT}px;height:${STATS_SHARE_OG_HEIGHT}px;object-fit:contain;background:#000}
  </style></head><body><img id="stats-og-square" src="${escapeStatsShareImageUrl(squareImageUrl)}" alt=""></body></html>`;
}

async function renderStatsShareOgImageWithPage(
  context: EventContext<StatsSharesEnv, string, unknown>,
  snapshot: StatsShareSnapshot,
  page: Page,
): Promise<void> {
  const images = context.env.STATS_SHARE_IMAGES;
  if (!images) throw new Error("The Stats share R2 binding is required to render the Open Graph image.");
  const ogImageKey = getStatsShareOgImageKey(snapshot);
  if (await images.head(ogImageKey)) return;

  const origin = getStatsSharePublicOrigin(context.request);
  const squareImageUrl = `${origin}/api/stats/share-images/${snapshot.id}`;
  await page.setViewport({ width: STATS_SHARE_OG_WIDTH, height: STATS_SHARE_OG_HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(
    buildStatsShareOgDocument(squareImageUrl),
    { waitUntil: "networkidle0", timeout: 20_000 },
  );
  await page.waitForFunction(
    () => {
      const image = document.getElementById("stats-og-square") as HTMLImageElement | null;
      return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    },
    { timeout: 12_000 },
  );
  const bytes = await page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: STATS_SHARE_OG_WIDTH, height: STATS_SHARE_OG_HEIGHT },
  }) as Uint8Array;
  await images.put(ogImageKey, bytes, {
    httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable, no-transform" },
    customMetadata: {
      shareId: snapshot.id,
      rendererVersion: snapshot.rendererVersion,
      variant: "open-graph",
      width: String(STATS_SHARE_OG_WIDTH),
      height: String(STATS_SHARE_OG_HEIGHT),
    },
  });
}

export async function renderStatsShareOgImage(
  context: EventContext<StatsSharesEnv, string, unknown>,
  snapshot: StatsShareSnapshot,
): Promise<string | null> {
  const images = context.env.STATS_SHARE_IMAGES;
  if (!images) return "The Stats share R2 binding is required to render the Open Graph image.";
  if (await images.head(getStatsShareOgImageKey(snapshot))) return null;
  if (!context.env.STATS_SHARE_BROWSER) return "The Cloudflare Browser Run binding is required to render the Open Graph image.";

  let browser: Awaited<ReturnType<typeof import("@cloudflare/puppeteer")["launch"]>> | null = null;
  try {
    const puppeteer = await import("@cloudflare/puppeteer");
    browser = await puppeteer.launch(context.env.STATS_SHARE_BROWSER as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();
    await renderStatsShareOgImageWithPage(context, snapshot, page);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function renderStatsShareImage(
  context: EventContext<StatsSharesEnv, string, unknown>,
  snapshot: StatsShareSnapshot,
): Promise<string | null> {
  if (snapshot.imageReady) return renderStatsShareOgImage(context, snapshot);
  if (!context.env.STATS_SHARE_BROWSER || !context.env.STATS_SHARE_IMAGES) {
    return "Cloudflare Browser Run and R2 bindings are required to render this image.";
  }

  let browser: Awaited<ReturnType<typeof import("@cloudflare/puppeteer")["launch"]>> | null = null;
  try {
    const puppeteer = await import("@cloudflare/puppeteer");
    browser = await puppeteer.launch(context.env.STATS_SHARE_BROWSER as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();
    await page.setViewport({ width: STATS_SHARE_SQUARE_SIZE, height: STATS_SHARE_SQUARE_SIZE, deviceScaleFactor: 1 });
    const origin = getStatsSharePublicOrigin(context.request);
    await page.goto(`${origin}/stats/share/${snapshot.id}/render`, { waitUntil: "networkidle0", timeout: 20_000 });
    await page.waitForSelector('[data-stats-share-ready="true"]', { timeout: 12_000 });
    const bytes = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: STATS_SHARE_SQUARE_SIZE, height: STATS_SHARE_SQUARE_SIZE },
    }) as Uint8Array;
    await context.env.STATS_SHARE_IMAGES.put(snapshot.imageKey, bytes, {
      httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable, no-transform" },
      customMetadata: { shareId: snapshot.id, rendererVersion: snapshot.rendererVersion },
    });
    await renderStatsShareOgImageWithPage(context, snapshot, page);
    await context.env.WARPLETS.prepare(
      "UPDATE stats_share_snapshots SET image_status = 'ready', image_error = NULL WHERE id = ?",
    ).bind(snapshot.id).run();
    snapshot.imageReady = true;
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await context.env.WARPLETS.prepare(
      "UPDATE stats_share_snapshots SET image_status = 'error', image_error = ? WHERE id = ?",
    ).bind(message.slice(0, 500), snapshot.id).run().catch(() => undefined);
    return message;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function handleStatsShareCreate(
  context: EventContext<StatsSharesEnv, string, unknown>,
): Promise<Response> {
  const body = await readJsonBodyWithLimit<unknown>(context.request, 4_096);
  if (!body.ok) return body.response;
  const request = parseStatsShareRequest(body.value);
  if (!request) return jsonSecure({ error: "Invalid Stats share request." }, { status: 400 });
  const clientIp = context.request.headers.get("cf-connecting-ip") ?? "unknown";
  const limit = await rateLimit(context.env.WARPLETS_KV, "stats-share-create", clientIp, 30, 60);
  if (!limit.allowed) {
    return jsonSecure({ error: "Too many Stats share requests. Please try again shortly." }, {
      status: 429,
      headers: { "retry-after": String(limit.retryAfterSeconds) },
    });
  }

  try {
    const { snapshot, renderError } = await ensureStatsShareSnapshot(context, request);
    return jsonSecure(responseForSnapshot(context.request, snapshot, renderError), {
      status: renderError ? 202 : 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return jsonSecure({
      error: "stats_share_creation_failed",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

export async function ensureStatsShareSnapshot(
  context: EventContext<StatsSharesEnv, string, unknown>,
  request: StatsShareRequest,
): Promise<{ snapshot: StatsShareSnapshot; renderError: string | null }> {
  const built = await buildSnapshotData(context, request);
  const id = await getStatsShareContentHash(request, built.dataAsOf, built.data);
  const createdAt = new Date().toISOString();
  const imageKey = `${STATS_SHARE_RENDERER_VERSION}/${id}.png`;
  await context.env.WARPLETS.prepare(
    `INSERT INTO stats_share_snapshots (
       id, kind, request_json, snapshot_json, title, farcaster_text, twitter_text,
       launch_path, image_key, image_status, renderer_version, data_as_of, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       farcaster_text = excluded.farcaster_text,
       twitter_text = excluded.twitter_text,
       launch_path = excluded.launch_path`,
  ).bind(
    id,
    request.kind,
    stableStatsShareJson(request),
    stableStatsShareJson(built.data),
    built.title,
    built.farcasterText,
    built.twitterText,
    getStatsShareLaunchPath(request, built.data),
    imageKey,
    STATS_SHARE_RENDERER_VERSION,
    built.dataAsOf,
    createdAt,
  ).run();
  const snapshot = await loadStatsShareSnapshot(context.env.WARPLETS, id);
  if (!snapshot) throw new Error("The Stats share snapshot could not be read after creation.");
  const renderError = await renderStatsShareImage(context, snapshot);
  return { snapshot, renderError };
}

export async function handleStatsShareGet(
  context: EventContext<StatsSharesEnv, "shareId", unknown>,
): Promise<Response> {
  const snapshot = await loadStatsShareSnapshot(context.env.WARPLETS, String(context.params.shareId));
  if (!snapshot) return jsonSecure({ error: "Stats share snapshot not found." }, { status: 404 });
  return jsonSecure(responseForSnapshot(context.request, snapshot), {
    headers: { "cache-control": "public, max-age=300, s-maxage=300" },
  });
}

export async function handleStatsShareRender(
  context: EventContext<StatsSharesEnv, "shareId", unknown>,
): Promise<Response> {
  const snapshot = await loadStatsShareSnapshot(context.env.WARPLETS, String(context.params.shareId));
  if (!snapshot) return jsonSecure({ error: "Stats share snapshot not found." }, { status: 404 });
  const renderError = await renderStatsShareImage(context as EventContext<StatsSharesEnv, string, unknown>, snapshot);
  return jsonSecure(responseForSnapshot(context.request, snapshot, renderError), {
    status: renderError ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}

function buildStatsShareImageHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable, no-transform");
  headers.set("content-type", "image/png");
  headers.set("content-length", String(object.size));
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

export async function handleStatsShareImageGet(
  context: EventContext<StatsSharesEnv, "shareId", unknown>,
  variant: "square" | "og" = "square",
): Promise<Response> {
  const snapshot = await loadStatsShareSnapshot(context.env.WARPLETS, String(context.params.shareId));
  if (!snapshot) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const object = await context.env.STATS_SHARE_IMAGES?.get(
    variant === "og" ? getStatsShareOgImageKey(snapshot) : snapshot.imageKey,
  );
  if (!object) return new Response("Image is not ready", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(object.body, { headers: buildStatsShareImageHeaders(object) });
}

export async function handleStatsShareImageHead(
  context: EventContext<StatsSharesEnv, "shareId", unknown>,
  variant: "square" | "og" = "square",
): Promise<Response> {
  const snapshot = await loadStatsShareSnapshot(context.env.WARPLETS, String(context.params.shareId));
  if (!snapshot) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const object = await context.env.STATS_SHARE_IMAGES?.head(
    variant === "og" ? getStatsShareOgImageKey(snapshot) : snapshot.imageKey,
  );
  if (!object) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(null, { headers: buildStatsShareImageHeaders(object) });
}
