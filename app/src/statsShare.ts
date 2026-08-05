export const STATS_SHARE_RENDERER_VERSION = "stats-share-v12";

export type StatsShareRange = "7d" | "30d" | "90d" | "1y" | "all";
export type StatsShareMarketMetric = "price" | "floor" | "volume" | "sales";
export type StatsShareActivityEvent = "sale" | "listing" | "offer" | "send";
export type StatsShareOverviewPanel = "collection" | "fair-launch";
export type StatsShareKind =
  | "overview"
  | "market"
  | "activity"
  | "holder-rank"
  | "holders-top10"
  | "holders-top10-friends";

export type StatsShareRequest =
  | { kind: "overview"; panel: StatsShareOverviewPanel; wallet?: string; fid?: number }
  | { kind: "market"; metric: StatsShareMarketMetric; range: StatsShareRange }
  | { kind: "activity"; event: StatsShareActivityEvent; range: StatsShareRange }
  | { kind: "holder-rank"; wallet?: string; fid?: number }
  | { kind: "holders-top10" }
  | { kind: "holders-top10-friends"; viewerFid: number };

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

export function getStatsShareLaunchPath(request: StatsShareRequest): string {
  if (request.kind === "overview") return "/stats";
  if (request.kind === "market") return `/stats/market?range=${request.range}`;
  if (request.kind === "activity") return `/stats/social?range=${request.range}&event=${request.event}`;
  return "/stats/holders";
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
  if (input.kind === "holders-top10") return { kind: input.kind };
  if (input.kind === "market") {
    if (!(input.metric === "price" || input.metric === "floor" || input.metric === "volume" || input.metric === "sales")) return null;
    if (!(input.range === "7d" || input.range === "30d" || input.range === "90d" || input.range === "1y" || input.range === "all")) return null;
    return { kind: "market", metric: input.metric, range: input.range };
  }
  if (input.kind === "activity") {
    if (!(input.event === "sale" || input.event === "listing" || input.event === "offer" || input.event === "send")) return null;
    if (!(input.range === "7d" || input.range === "30d" || input.range === "90d" || input.range === "1y" || input.range === "all")) return null;
    return { kind: "activity", event: input.event, range: input.range };
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
    return viewerFid ? { kind: "holders-top10-friends", viewerFid } : null;
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
  return `/api/stats/activity?${params.toString()}`;
}

export async function getStatsShareContentHash(request: StatsShareRequest, dataAsOf: string | null, data?: unknown): Promise<string> {
  const canonical = stableStatsShareJson({ rendererVersion: STATS_SHARE_RENDERER_VERSION, request, dataAsOf, data });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
