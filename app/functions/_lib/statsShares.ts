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
import {
  STATS_SHARE_RENDERER_VERSION,
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
    const data = await readStatsResponse(await handleStatsOverviewGet(cloneStatsContext(context, "/api/stats/overview?range=all")));
    return {
      data,
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: "Share Collection Overview",
      farcasterText: "10X Warplets — NFT Collection Overview",
      twitterText: "10X Warplets — NFT Collection Overview",
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

  if (request.kind === "activity") {
    const data = await readStatsResponse(await handleStatsActivityGet(cloneStatsContext(
      context,
      getStatsShareActivityApiPath(request),
    )));
    const counts = asRecord(data.eventCounts);
    const count = Math.max(0, Math.trunc(asNumber(counts?.[request.event]) ?? 0));
    const text = `10X Warplets — ${count.toLocaleString("en-US")} ${getStatsShareActivityLabel(request.event, count)} (${getStatsShareRangeLabel(request.range)})`;
    return {
      data: { ...data, event: request.event, count },
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: "Share Activity",
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
    const [enriched] = await fillVerifiedXUsernames(context.env, [holder]);
    return {
      data: { row: enriched, totalHolders: total, asOf: data.asOf },
      dataAsOf: typeof data.asOf === "string" ? data.asOf : null,
      title: "Share Your Rank",
      farcasterText: text,
      twitterText: text,
    };
  }

  let holders: StatsShareHolder[] = [];
  let totalHolders = 0;
  let dataAsOf: string | null = null;
  if (request.kind === "holders-top10") {
    const data = await readStatsResponse(await handleStatsHoldersGet(cloneStatsContext(context, "/api/stats/holders?limit=10")));
    holders = (Array.isArray(data.rows) ? data.rows : []).map(normalizeHolder).filter((row): row is StatsShareHolder => Boolean(row));
    totalHolders = Math.max(0, Math.trunc(asNumber(asRecord(data.summary)?.holderCount) ?? 0));
    dataAsOf = typeof data.asOf === "string" ? data.asOf : null;
  } else {
    const result = await loadStatsFriendHoldersForShare(context.env, request.viewerFid);
    holders = result.rows.map(normalizeHolder).filter((row): row is StatsShareHolder => Boolean(row));
    totalHolders = result.totalHolders;
    dataAsOf = result.asOf;
  }
  holders = await fillVerifiedXUsernames(context.env, holders);
  const heading = request.kind === "holders-top10"
    ? "10X Warplets — Top 10 Holders"
    : "10X Warplets — My Top Ranked Friends";
  return {
    data: { rows: holders, totalHolders, asOf: dataAsOf },
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

function getStatsSharePublicOrigin(request: Request): string {
  const current = new URL(request.url);
  if (current.hostname !== "127.0.0.1" && current.hostname !== "localhost") return current.origin;
  for (const header of [request.headers.get("origin"), request.headers.get("referer")]) {
    if (!header) continue;
    try {
      const candidate = new URL(header);
      if (candidate.protocol === "https:" && candidate.hostname === "search-local.10x.meme") return candidate.origin;
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

function responseForSnapshot(request: Request, snapshot: StatsShareSnapshot, renderError?: string | null): StatsShareCreateResponse {
  const origin = getStatsSharePublicOrigin(request);
  return {
    snapshot,
    shareUrl: `${origin}/stats/share/${snapshot.id}`,
    imageUrl: `${origin}/api/stats/share-images/${snapshot.id}`,
    ...(renderError ? { renderError } : {}),
  };
}

export async function renderStatsShareImage(
  context: EventContext<StatsSharesEnv, string, unknown>,
  snapshot: StatsShareSnapshot,
): Promise<string | null> {
  if (snapshot.imageReady) return null;
  if (!context.env.STATS_SHARE_BROWSER || !context.env.STATS_SHARE_IMAGES) {
    return "Cloudflare Browser Run and R2 bindings are required to render this image.";
  }

  let browser: { close(): Promise<void>; newPage(): Promise<any> } | null = null;
  try {
    const puppeteer = await import("@cloudflare/puppeteer");
    browser = await puppeteer.launch(context.env.STATS_SHARE_BROWSER as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
    const origin = getStatsSharePublicOrigin(context.request);
    await page.goto(`${origin}/stats/share/${snapshot.id}/render`, { waitUntil: "networkidle0", timeout: 20_000 });
    await page.waitForSelector('[data-stats-share-ready="true"]', { timeout: 12_000 });
    const bytes = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 800 } }) as Uint8Array;
    await context.env.STATS_SHARE_IMAGES.put(snapshot.imageKey, bytes, {
      httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable, no-transform" },
      customMetadata: { shareId: snapshot.id, rendererVersion: snapshot.rendererVersion },
    });
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
         twitter_text = excluded.twitter_text`,
    ).bind(
      id,
      request.kind,
      stableStatsShareJson(request),
      stableStatsShareJson(built.data),
      built.title,
      built.farcasterText,
      built.twitterText,
      getStatsShareLaunchPath(request),
      imageKey,
      STATS_SHARE_RENDERER_VERSION,
      built.dataAsOf,
      createdAt,
    ).run();
    const snapshot = await loadStatsShareSnapshot(context.env.WARPLETS, id);
    if (!snapshot) throw new Error("The Stats share snapshot could not be read after creation.");
    const renderError = await renderStatsShareImage(context, snapshot);
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

export async function handleStatsShareImageGet(
  context: EventContext<StatsSharesEnv, "shareId", unknown>,
): Promise<Response> {
  const snapshot = await loadStatsShareSnapshot(context.env.WARPLETS, String(context.params.shareId));
  if (!snapshot) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const object = await context.env.STATS_SHARE_IMAGES?.get(snapshot.imageKey);
  if (!object) return new Response("Image is not ready", { status: 404, headers: { "cache-control": "no-store" } });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable, no-transform");
  headers.set("content-type", "image/png");
  return new Response(object.body, { headers });
}
