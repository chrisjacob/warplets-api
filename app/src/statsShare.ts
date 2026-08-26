export const STATS_SHARE_RENDERER_VERSION = "stats-share-v48";
export const STATS_SHARE_SQUARE_SIZE = 1000;
export const STATS_SHARE_OG_WIDTH = 1200;
export const STATS_SHARE_OG_HEIGHT = 630;

export type StatsShareRange = "7d" | "30d" | "90d" | "1y" | "all";
export type StatsShareMarketMetric = "price" | "floor" | "volume" | "listings" | "offers" | "sales";
export type StatsShareActivityEvent = "sale" | "listing" | "offer" | "send";
export type StatsShareOverviewPanel = "collection" | "fair-launch";
export type StatsShareKind =
  | "overview"
  | "market"
  | "market-all"
  | "activity"
  | "holder-rank"
  | "holders-top10"
  | "holders-top10-friends";

export type StatsShareRequest =
  | { kind: "overview"; panel: StatsShareOverviewPanel; wallet?: string; fid?: number }
  | { kind: "market"; metric: StatsShareMarketMetric; range: StatsShareRange }
  | { kind: "market-all"; range: StatsShareRange }
  | { kind: "activity"; event: StatsShareActivityEvent; range: StatsShareRange; tokenId?: number }
  | { kind: "holder-rank"; wallet?: string; fid?: number }
  | { kind: "holders-top10"; wallet?: string; fid?: number }
  | { kind: "holders-top10-friends"; viewerFid: number; wallet?: string };

export type StatsShareHolder = {
  rank: number | null;
  wallet: string;
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  xUsername: string | null;
  ownedCount: number;
  ownedPct: number;
  bestRarityRank: number | null;
  previewTokenIds: number[];
  remainingCount: number;
  floorValueEth: number | null;
  isViewer?: boolean;
  isTopFriend?: boolean;
};

export type StatsShareSnapshot = {
  id: string;
  kind: StatsShareKind;
  request: StatsShareRequest;
  title: string;
  farcasterText: string;
  twitterText: string;
  launchPath: string;
  imageKey: string;
  imageReady: boolean;
  rendererVersion: string;
  dataAsOf: string | null;
  createdAt: string;
  data: unknown;
};

export type StatsShareCreateResponse = {
  snapshot: StatsShareSnapshot;
  shareUrl: string;
  imageUrl: string;
  ogImageUrl?: string;
  renderError?: string | null;
};

const RANGE_LABELS: Record<StatsShareRange, string> = {
  "7d": "7 Days",
  "30d": "30 Days",
  "90d": "90 Days",
  "1y": "1 Year",
  all: "All Time",
};

const MARKET_LABELS: Record<StatsShareMarketMetric, string> = {
  price: "Price",
  floor: "Floor Price",
  volume: "Volume",
  listings: "Listings",
  offers: "Offers",
  sales: "Sales",
};

const ACTIVITY_LABELS: Record<StatsShareActivityEvent, { singular: string; plural: string }> = {
  sale: { singular: "Sale", plural: "Sales" },
  listing: { singular: "Listing", plural: "Listings" },
  offer: { singular: "Offer", plural: "Offers" },
  send: { singular: "Send", plural: "Sends" },
};

export function getStatsShareRangeLabel(range: StatsShareRange): string {
  return RANGE_LABELS[range];
}

export function getStatsShareMarketLabel(metric: StatsShareMarketMetric): string {
  return MARKET_LABELS[metric];
}

export function getStatsShareActivityLabel(event: StatsShareActivityEvent, count: number): string {
  return count === 1 ? ACTIVITY_LABELS[event].singular : ACTIVITY_LABELS[event].plural;
}

export function normalizeStatsShareUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@+/, "");
  return normalized && normalized !== "-" ? normalized : null;
}

export function formatStatsShareWallet(wallet: string): string {
  const normalized = wallet.trim();
  return normalized.length > 12 ? `${normalized.slice(0, 6)}…${normalized.slice(-4)}` : normalized;
}

export function formatStatsShareIdentity(
  holder: Pick<StatsShareHolder, "username" | "xUsername" | "displayName" | "wallet">,
  channel: "farcaster" | "twitter",
): string {
  const handle = channel === "twitter"
    ? normalizeStatsShareUsername(holder.xUsername)
    : normalizeStatsShareUsername(holder.username);
  if (handle) return `@${handle}`;
  const displayName = holder.displayName?.trim();
  return displayName || formatStatsShareWallet(holder.wallet);
}

const LEADERBOARD_NUMBERS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export function buildStatsLeaderboardText(
  heading: string,
  holders: StatsShareHolder[],
  channel: "farcaster" | "twitter",
): string {
  const lines = holders.slice(0, 10).map((holder, index) =>
    `${LEADERBOARD_NUMBERS[index]} ${formatStatsShareIdentity(holder, channel)}`,
  );
  return [heading, "", ...lines].join("\n");
}

export function buildStatsHolderRankText(
  heading: string,
  holder: StatsShareHolder,
  rankWindow: StatsShareHolder[],
  channel: "farcaster" | "twitter",
): string {
  const neighbours = rankWindow
    .filter((candidate) => candidate.wallet.toLowerCase() !== holder.wallet.toLowerCase())
    .slice(0, 2)
    .map((candidate) => formatStatsShareIdentity(candidate, channel));
  return neighbours.length > 0
    ? `${heading}\n\n👀 ${neighbours.join(" ")}`
    : heading;
}

const MARKET_PATHS: Record<StatsShareMarketMetric, string> = {
  price: "price",
  floor: "floor-price",
  volume: "volume",
  listings: "listings",
  offers: "offers",
  sales: "sales",
};

const ACTIVITY_PATHS: Record<StatsShareActivityEvent, string> = {
  sale: "sales",
  listing: "listings",
  offer: "offers",
  send: "sends",
};

const MARKET_METRICS_BY_PATH: Readonly<Record<string, StatsShareMarketMetric>> = Object.fromEntries(
  Object.entries(MARKET_PATHS).map(([metric, path]) => [path, metric as StatsShareMarketMetric]),
);

const ACTIVITY_EVENTS_BY_PATH: Readonly<Record<string, StatsShareActivityEvent>> = Object.fromEntries(
  Object.entries(ACTIVITY_PATHS).map(([event, path]) => [path, event as StatsShareActivityEvent]),
);

function readLaunchWallet(url: URL): string | undefined {
  const wallet = url.searchParams.get("wallet")?.trim().toLowerCase();
  return wallet && /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : undefined;
}

/**
 * Reconstructs the share request represented by a public Stats deep link.
 * Friend leaderboards need the wallet's resolved Farcaster identity supplied by
 * the caller because that lookup belongs to the server-side identity store.
 */
export function getStatsShareRequestFromLaunchUrl(
  url: URL,
  friendFilterFid?: number | null,
): StatsShareRequest | null {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const wallet = readLaunchWallet(url);

  const overview = path.match(/^\/stats\/overview\/(collection|launch)$/i)?.[1]?.toLowerCase();
  if (overview) {
    return { kind: "overview", panel: overview === "launch" ? "fair-launch" : "collection" };
  }

  const market = path.match(/^\/stats\/market\/(7d|30d|90d|1y|all)(?:\/([^/]+))?$/i);
  if (market) {
    const range = market[1].toLowerCase() as StatsShareRange;
    const metric = market[2] ? MARKET_METRICS_BY_PATH[market[2].toLowerCase()] : undefined;
    if (market[2] && !metric) return null;
    return metric ? { kind: "market", range, metric } : { kind: "market-all", range };
  }

  const activity = path.match(/^\/stats\/activity\/(7d|30d|90d|1y|all)\/([^/]+)$/i);
  if (activity) {
    const event = ACTIVITY_EVENTS_BY_PATH[activity[2].toLowerCase()];
    return event ? { kind: "activity", range: activity[1].toLowerCase() as StatsShareRange, event } : null;
  }

  if (path === "/stats/holders") return wallet ? { kind: "holder-rank", wallet } : null;
  if (path === "/stats/holders/top10") return { kind: "holders-top10" };
  if (path === "/stats/holders/top10friends") {
    return wallet && friendFilterFid && Number.isSafeInteger(friendFilterFid) && friendFilterFid > 0
      ? { kind: "holders-top10-friends", viewerFid: friendFilterFid, wallet }
      : null;
  }

  const tokenIdText = url.searchParams.get("warplet")?.trim();
  const range = url.searchParams.get("range")?.trim().toLowerCase() as StatsShareRange | undefined;
  const event = url.searchParams.get("event")?.trim().toLowerCase() as StatsShareActivityEvent | undefined;
  const tokenId = tokenIdText && /^\d+$/.test(tokenIdText) ? Number.parseInt(tokenIdText, 10) : null;
  if (
    path === "/" && url.searchParams.get("activity") === "1"
    && tokenId && tokenId >= 1 && tokenId <= 10_000
    && range && range in RANGE_LABELS && event && event in ACTIVITY_LABELS
  ) {
    return { kind: "activity", range, event, tokenId };
  }
  return null;
}

function readSnapshotWallet(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const row = (data as { row?: unknown }).row;
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const wallet = (row as { wallet?: unknown }).wallet;
  return typeof wallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet.toLowerCase() : undefined;
}

export function getStatsShareLaunchPath(request: StatsShareRequest, data?: unknown): string {
  if (request.kind === "overview") return `/stats/overview/${request.panel === "fair-launch" ? "launch" : "collection"}`;
  if (request.kind === "market") return `/stats/market/${request.range}/${MARKET_PATHS[request.metric]}`;
  if (request.kind === "market-all") return `/stats/market/${request.range}`;
  if (request.kind === "activity") return request.tokenId
    ? `/?warplet=${request.tokenId}&activity=1&range=${request.range}&event=${request.event}`
    : `/stats/activity/${request.range}/${ACTIVITY_PATHS[request.event]}`;
  if (request.kind === "holder-rank") {
    const wallet = request.wallet ?? readSnapshotWallet(data);
    return wallet ? `/stats/holders?wallet=${wallet}` : "/stats/holders";
  }
  if (request.kind === "holders-top10") return "/stats/holders/top10";
  const wallet = request.wallet ?? readSnapshotWallet(data);
  return wallet ? `/stats/holders/top10friends?wallet=${wallet}` : "/stats/holders/top10friends";
}

export function parseStatsShareRequest(value: unknown): StatsShareRequest | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.kind === "overview") {
    if (!(input.panel === "collection" || input.panel === "fair-launch")) return null;
    const wallet = typeof input.wallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(input.wallet.trim())
      ? input.wallet.trim().toLowerCase()
      : undefined;
    const fid = typeof input.fid === "number" && Number.isSafeInteger(input.fid) && input.fid > 0
      ? input.fid
      : undefined;
    return { kind: "overview", panel: input.panel, ...(wallet ? { wallet } : {}), ...(fid ? { fid } : {}) };
  }
  if (input.kind === "holders-top10") {
    const wallet = typeof input.wallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(input.wallet.trim())
      ? input.wallet.trim().toLowerCase()
      : undefined;
    const fid = typeof input.fid === "number" && Number.isSafeInteger(input.fid) && input.fid > 0
      ? input.fid
      : undefined;
    return { kind: input.kind, ...(wallet ? { wallet } : {}), ...(fid ? { fid } : {}) };
  }
  if (input.kind === "market") {
    if (!(input.metric === "price" || input.metric === "floor" || input.metric === "volume" || input.metric === "listings" || input.metric === "offers" || input.metric === "sales")) return null;
    if (!(input.range === "7d" || input.range === "30d" || input.range === "90d" || input.range === "1y" || input.range === "all")) return null;
    return { kind: "market", metric: input.metric, range: input.range };
  }
  if (input.kind === "market-all") {
    if (!(input.range === "7d" || input.range === "30d" || input.range === "90d" || input.range === "1y" || input.range === "all")) return null;
    return { kind: "market-all", range: input.range };
  }
  if (input.kind === "activity") {
    if (!(input.event === "sale" || input.event === "listing" || input.event === "offer" || input.event === "send")) return null;
    if (!(input.range === "7d" || input.range === "30d" || input.range === "90d" || input.range === "1y" || input.range === "all")) return null;
    const tokenId = typeof input.tokenId === "number" && Number.isSafeInteger(input.tokenId) && input.tokenId >= 1 && input.tokenId <= 10_000
      ? input.tokenId
      : undefined;
    if (input.tokenId != null && tokenId == null) return null;
    return { kind: "activity", event: input.event, range: input.range, ...(tokenId ? { tokenId } : {}) };
  }
  if (input.kind === "holder-rank") {
    const wallet = typeof input.wallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(input.wallet.trim())
      ? input.wallet.trim().toLowerCase()
      : undefined;
    const fid = typeof input.fid === "number" && Number.isSafeInteger(input.fid) && input.fid > 0
      ? input.fid
      : undefined;
    return wallet || fid ? { kind: "holder-rank", ...(wallet ? { wallet } : {}), ...(fid ? { fid } : {}) } : null;
  }
  if (input.kind === "holders-top10-friends") {
    const viewerFid = typeof input.viewerFid === "number" && Number.isSafeInteger(input.viewerFid) && input.viewerFid > 0
      ? input.viewerFid
      : null;
    const wallet = typeof input.wallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(input.wallet.trim())
      ? input.wallet.trim().toLowerCase()
      : undefined;
    return viewerFid ? { kind: "holders-top10-friends", viewerFid, ...(wallet ? { wallet } : {}) } : null;
  }
  return null;
}

export function stableStatsShareJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (!candidate || typeof candidate !== "object") return candidate;
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function getStatsShareActivityApiPath(request: Extract<StatsShareRequest, { kind: "activity" }>): string {
  const params = new URLSearchParams({ range: request.range, limit: "1", chart: "1", events: request.event });
  if (request.tokenId) params.set("tokenId", String(request.tokenId));
  return `/api/stats/activity?${params.toString()}`;
}

export async function getStatsShareContentHash(request: StatsShareRequest, dataAsOf: string | null, data?: unknown): Promise<string> {
  const canonical = stableStatsShareJson({ rendererVersion: STATS_SHARE_RENDERER_VERSION, request, dataAsOf, data });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
