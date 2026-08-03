import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  formatStatsShareIdentity,
  getStatsShareActivityLabel,
  getStatsShareMarketLabel,
  getStatsShareRangeLabel,
  type StatsShareCreateResponse,
  type StatsShareHolder,
  type StatsShareSnapshot,
} from "./statsShare";

type RecordValue = Record<string, unknown>;

const GREEN = "#00ff00";
const PURPLE = "#7959ff";

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function number(value: unknown): number | null {
  const nested = record(value);
  const candidate = "value" in nested ? nested.value : value;
  const parsed = typeof candidate === "number" ? candidate : Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(data: RecordValue, ...keys: string[]): unknown {
  const metrics = record(data.metrics);
  const summary = record(data.summary);
  for (const key of keys) {
    if (data[key] != null) return data[key];
    if (metrics[key] != null) return metrics[key];
    if (summary[key] != null) return summary[key];
  }
  return null;
}

function formatInteger(value: unknown): string {
  const parsed = number(value);
  return parsed == null ? "—" : Math.round(parsed).toLocaleString("en-US");
}

function formatEth(value: unknown): string {
  const parsed = number(value);
  if (parsed == null) return "—";
  return `${parsed.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
}

function formatPercent(value: unknown, digits = 1): string {
  const parsed = number(value);
  if (parsed == null) return "—";
  return `${parsed.toLocaleString("en-US", { maximumFractionDigits: digits })}%`;
}

function formatListedPercent(value: unknown): string {
  const parsed = number(value);
  return parsed != null && parsed > 0 && parsed < 1 ? "<1%" : formatPercent(parsed);
}

function asOfLabel(value: string | null): string {
  if (!value) return "Snapshot data";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Snapshot data" : `Updated ${parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

function MetricTile({ label, value, purple = false }: { label: string; value: string; purple?: boolean }) {
  const color = purple ? PURPLE : GREEN;
  return (
    <div style={{ border: `2px solid ${color}88`, borderRadius: 18, background: purple ? "#17102f" : "#001902", padding: "15px 18px", minHeight: 86 }}>
      <div style={{ color: purple ? "#aa95ff" : "#86b886", fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color, fontSize: 27, lineHeight: 1.15, fontWeight: 950, marginTop: 8 }}>{value}</div>
    </div>
  );
}

function OverviewCard({ snapshot }: { snapshot: StatsShareSnapshot }) {
  const data = record(snapshot.data);
  const listed = record(metric(data, "listed", "listedCount"));
  const owners = record(metric(data, "ownersUnique", "uniqueOwners", "owners"));
  const farcaster = record(metric(data, "farcasterHolders", "socialHolders"));
  const coverage = record(metric(data, "identityCoverage"));
  const fair = record(metric(data, "fairOwnership"));
  const greenMetrics = [
    ["Items", formatInteger(metric(data, "items", "totalItems", "supply") ?? 10_000)],
    ["Floor Price", formatEth(metric(data, "floorPrice", "floor"))],
    ["1D Floor %", formatPercent(metric(data, "floorChange1dPercent", "floorChange1dPct", "oneDayFloorChangePct"), 2)],
    ["Top Offer", formatEth(metric(data, "topOffer", "collectionTopOffer"))],
    ["24H Volume", formatEth(metric(data, "volume24h", "oneDayVolume"))],
    ["Total Volume", formatEth(metric(data, "totalVolume", "totalVolumeSinceEpoch"))],
    ["Listed", `${formatInteger(listed.count ?? metric(data, "listedCount"))} (${formatListedPercent(listed.percentage ?? listed.pct ?? metric(data, "listedPct"))})`],
    ["Owners (Unique)", `${formatInteger(owners.count ?? metric(data, "uniqueOwnerCount", "ownerCount") ?? owners)} (${formatPercent(owners.percentage ?? owners.pct ?? metric(data, "uniqueOwnerPct"))})`],
    ["Farcaster Holders", formatInteger(farcaster.count)],
    ["Farcaster Holders %", formatPercent(coverage.percentage ?? coverage.pct ?? metric(data, "identityCoveragePct"))],
  ];
  const purpleMetrics = [
    ["OG Warplet Sold", "Never!"],
    ["Airdrop Retention", formatPercent(fair.cohortRetentionPercentage ?? fair.cohortRetentionPct ?? fair.jul2CohortRetentionPct, 2)],
    ["Airdrop Followers", "48,891,855"],
    ["Airdrop NFTs", "$1,269,859"],
    ["Airdrop Portfolios", "$4,945,633"],
    ["Airdrop Volume", "$2.7B"],
    ["Hold Exactly One", formatInteger(fair.exactlyOneWallets ?? fair.singleItemHolders ?? fair.holdersWithOne)],
    ["Hold Multiple", formatInteger(fair.multipleWallets ?? fair.multiItemHolders ?? fair.holdersWithMultiple)],
    ["Top 10 Own", formatPercent(fair.top10Percentage ?? fair.top10Pct, 2)],
    ["Top 100 Own", formatPercent(fair.top100Percentage ?? fair.top100Pct, 2)],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, height: "100%" }}>
      <section style={{ border: `2px solid ${GREEN}77`, borderRadius: 24, background: "#001203", padding: 22 }}>
        <div style={{ color: GREEN, fontSize: 27, fontWeight: 950 }}>10X Warplets NFT Collection</div>
        <div style={{ color: "#b8e6b8", fontSize: 16, marginTop: 6 }}>Where Builders, Traders and Attention align.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
          {greenMetrics.map(([label, value]) => <MetricTile key={label} label={label} value={value} />)}
        </div>
      </section>
      <section style={{ border: `2px solid ${PURPLE}99`, borderRadius: 24, background: "#0c071b", padding: 22 }}>
        <div style={{ color: PURPLE, fontSize: 27, fontWeight: 950, textTransform: "uppercase" }}>Fair Launch. Mass Distribution.</div>
        <div style={{ color: "#c0b2fb", fontSize: 16, marginTop: 6 }}>The Warplets diamond hands. 10,000 wallet Farcaster airdrop.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
          {purpleMetrics.map(([label, value]) => <MetricTile key={label} label={label} value={value} purple />)}
        </div>
      </section>
    </div>
  );
}

type ChartPoint = { label: string; value: number };

function chartRows(data: RecordValue, metricName: string): ChartPoint[] {
  const series = record(data.series);
  let candidates = metricName === "price"
    ? series.salePrices ?? data.salePrices ?? data.prices
    : metricName === "floor"
      ? series.floor ?? data.floorHistory ?? data.floor
      : series.daily ?? data.daily ?? data.dailyActivity;
  if (!Array.isArray(candidates) && (metricName === "sale" || metricName === "listing" || metricName === "offer" || metricName === "send")) {
    candidates = record(data.chart).buckets;
    if (!Array.isArray(candidates)) return [];
    return candidates.flatMap((candidate, index) => {
      const bucket = record(candidate);
      const event = record(record(bucket.events)[metricName]);
      const count = number(event.count) ?? 0;
      const value = metricName === "send" ? count : number(event.averagePriceEth);
      if (value == null && count === 0) return [];
      const date = typeof bucket.startAt === "string" ? new Date(bucket.startAt) : null;
      const label = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : String(index);
      return [{ label, value: value ?? 0 }];
    });
  }
  if (!Array.isArray(candidates)) return [];
  const valueKeys = metricName === "price"
    ? ["movingPrice", "salePrice", "priceEth", "price", "medianSalePrice", "averagePrice"]
    : metricName === "floor"
      ? ["floorPrice", "floorEth", "floor"]
      : metricName === "volume" ? ["volume", "volumeEth", "eth"] : metricName === "sales" ? ["sales", "saleCount", "count"] : [`${metricName}Price`, metricName, "count"];
  const normalized = candidates.flatMap((candidate, index) => {
    const row = record(candidate);
    const value = valueKeys.map((key) => number(row[key])).find((item) => item != null);
    if (value == null) return [];
    const rawLabel = row.label ?? row.date ?? row.day ?? row.at ?? row.soldAt ?? row.capturedAt ?? row.bucket ?? index;
    const parsedDate = typeof rawLabel === "string" ? new Date(rawLabel) : null;
    const label = parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : String(rawLabel);
    return [{ label, value }];
  });
  if (metricName !== "price") return normalized;
  return normalized.map((point, index) => {
    const window = normalized.slice(Math.max(0, index - 2), index + 1);
    return { ...point, value: window.reduce((sum, candidate) => sum + candidate.value, 0) / window.length };
  });
}

function changePercent(rows: ChartPoint[], halfPeriod = false): number | null {
  if (rows.length < 2) return null;
  const startIndex = halfPeriod ? Math.max(0, Math.floor(rows.length / 2) - 1) : 0;
  const start = rows[startIndex]?.value;
  const end = rows.at(-1)?.value;
  return start && end != null ? ((end - start) / Math.abs(start)) * 100 : null;
}

function MarketOrActivityCard({ snapshot }: { snapshot: StatsShareSnapshot }) {
  const data = record(snapshot.data);
  const isMarket = snapshot.kind === "market";
  const request = snapshot.request.kind === "market" || snapshot.request.kind === "activity" ? snapshot.request : null;
  const metricName = request?.kind === "market" ? request.metric : request?.kind === "activity" ? request.event : "sales";
  const range = request && "range" in request ? request.range : "all";
  const rows = chartRows(data, metricName);
  const eventCount = number(data.count) ?? 0;
  const label = isMarket
    ? getStatsShareMarketLabel(metricName as "price" | "floor" | "volume" | "sales")
    : getStatsShareActivityLabel(metricName as "sale" | "listing" | "offer" | "send", eventCount);
  const headlineMetric = isMarket
    ? metricName === "sales" ? metric(data, "sales", "saleCount")
      : metricName === "volume" ? metric(data, "volume", "periodVolume", "totalVolume")
        : rows.at(-1)?.value
    : eventCount;
  const headline = isMarket
    ? metricName === "sales" ? formatInteger(headlineMetric) : formatEth(headlineMetric)
    : `${formatInteger(headlineMetric)} ${label}`;
  const change = isMarket ? changePercent(rows, metricName === "volume" || metricName === "sales") : null;
  const color = isMarket ? GREEN : metricName === "sale" ? "#ff3333" : metricName === "listing" ? "#ffff00" : metricName === "offer" ? "#33aaff" : GREEN;
  return (
    <div style={{ height: "100%", border: `2px solid ${color}77`, borderRadius: 28, background: "linear-gradient(160deg,#001404,#000 65%)", padding: 42 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ color, fontSize: 22, fontWeight: 950, textTransform: "uppercase" }}>10X Warplets — {label}</div>
          <div style={{ color: "white", fontSize: 58, lineHeight: 1.1, fontWeight: 950, marginTop: 14 }}>{headline}</div>
        </div>
        <div style={{ minWidth: 125, flexShrink: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ color: "#b5d0b5", fontSize: 22, fontWeight: 900 }}>{getStatsShareRangeLabel(range)}</div>
          {change != null && <div style={{ color: change >= 0 ? GREEN : "#ff5555", fontSize: 28, fontWeight: 950, marginTop: 12 }}>{change > 0 ? "+" : ""}{change.toFixed(1)}%</div>}
        </div>
      </div>
      <div style={{ marginTop: 40, border: `1px solid ${color}55`, borderRadius: 20, background: "#000a", padding: "20px 18px 0" }}>
        {rows.length > 0 ? (
          <LineChart width={1060} height={470} data={rows} margin={{ top: 20, right: 30, left: 25, bottom: 35 }}>
            <CartesianGrid stroke="#154015" strokeDasharray="4 8" vertical={false} />
            <XAxis dataKey="label" stroke="#709570" tick={{ fill: "#88aa88", fontSize: 13 }} minTickGap={50} />
            <YAxis stroke="#709570" tick={{ fill: "#88aa88", fontSize: 13 }} width={70} />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={5} dot={false} isAnimationActive={false} />
          </LineChart>
        ) : <div style={{ height: 470, display: "grid", placeItems: "center", color: "#8bbf8b", fontSize: 24, fontWeight: 900 }}>No activity found.</div>}
      </div>
      <div style={{ color: "#789978", fontSize: 14, marginTop: 17, textAlign: "right" }}>{asOfLabel(snapshot.dataAsOf)}</div>
    </div>
  );
}

function HolderAvatar({ holder }: { holder: StatsShareHolder }) {
  const initials = (holder.displayName || holder.username || holder.wallet).replace(/^@/, "").slice(0, 2).toUpperCase();
  return holder.pfpUrl
    ? <img src={holder.pfpUrl} alt="" crossOrigin="anonymous" style={{ width: 74, height: 74, borderRadius: 16, objectFit: "cover", background: "#062006" }} />
    : <div style={{ width: 74, height: 74, borderRadius: 16, display: "grid", placeItems: "center", color: GREEN, background: "#062006", fontSize: 25, fontWeight: 950 }}>{initials}</div>;
}

function HolderCard({ holder, slot, large = false }: { holder?: StatsShareHolder; slot: number; large?: boolean }) {
  if (!holder) return <div style={{ height: large ? 350 : 112, border: "2px dashed #315231", borderRadius: 18, background: "#04100488" }} />;
  return (
    <div style={{ height: large ? 350 : 112, display: "flex", alignItems: "center", gap: large ? 32 : 18, border: `2px solid ${GREEN}66`, borderRadius: 18, background: "#031604", padding: large ? 36 : 17 }}>
      <div style={{ color: GREEN, width: large ? 120 : 65, fontSize: large ? 56 : 28, fontWeight: 950, textAlign: "center" }}>#{holder.rank ?? slot}</div>
      <HolderAvatar holder={holder} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "white", fontSize: large ? 38 : 22, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatStatsShareIdentity(holder, "farcaster")}</div>
        <div style={{ color: "#8bbf8b", fontSize: large ? 23 : 16, fontWeight: 800, marginTop: 7 }}>{formatInteger(holder.ownedCount)} Warplets · {formatPercent(holder.ownedPct, 2)}</div>
        {holder.bestRarityRank && <div style={{ color: GREEN, fontSize: large ? 21 : 14, marginTop: 5 }}>Best rarity #{formatInteger(holder.bestRarityRank)}</div>}
      </div>
    </div>
  );
}

function HoldersCard({ snapshot }: { snapshot: StatsShareSnapshot }) {
  const data = record(snapshot.data);
  const isRank = snapshot.kind === "holder-rank";
  const rows = (isRank ? [data.row] : Array.isArray(data.rows) ? data.rows : []).filter(Boolean) as StatsShareHolder[];
  const total = number(data.totalHolders) ?? 0;
  if (isRank) {
    const holder = rows[0];
    return (
      <div style={{ height: "100%", border: `2px solid ${GREEN}77`, borderRadius: 28, background: "linear-gradient(160deg,#001704,#000 65%)", padding: 60 }}>
        <div style={{ color: GREEN, fontSize: 28, fontWeight: 950 }}>YOUR RANK</div>
        <div style={{ color: "white", fontSize: 72, fontWeight: 950, margin: "8px 0 35px" }}>#{formatInteger(holder?.rank)} <span style={{ color: "#8bbf8b", fontSize: 30 }}>of {formatInteger(total)}</span></div>
        <HolderCard holder={holder} slot={1} large />
        <div style={{ color: "#789978", fontSize: 16, marginTop: 32, textAlign: "right" }}>{asOfLabel(snapshot.dataAsOf)}</div>
      </div>
    );
  }
  const friendMode = snapshot.kind === "holders-top10-friends";
  return (
    <div style={{ height: "100%", border: `2px solid ${GREEN}77`, borderRadius: 28, background: "linear-gradient(160deg,#001704,#000 65%)", padding: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <div style={{ color: GREEN, fontSize: 34, fontWeight: 950 }}>{friendMode ? "YOUR TOP 10 RANKED FRIENDS" : "TOP 10 HOLDERS"}</div>
        <div style={{ color: "#8bbf8b", fontSize: 16 }}>{asOfLabel(snapshot.dataAsOf)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(5,112px)", gridAutoFlow: "column", gap: 11 }}>
        {Array.from({ length: 10 }, (_, index) => <HolderCard key={index} holder={rows[index]} slot={index + 1} />)}
      </div>
    </div>
  );
}

function SnapshotCard({ snapshot, ready }: { snapshot: StatsShareSnapshot; ready: boolean }) {
  return (
    <main data-stats-share-ready={ready ? "true" : "false"} style={{ boxSizing: "border-box", width: 1200, height: 800, padding: 18, overflow: "hidden", color: "white", background: "#000", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {snapshot.kind === "overview" ? <OverviewCard snapshot={snapshot} />
        : snapshot.kind === "market" || snapshot.kind === "activity" ? <MarketOrActivityCard snapshot={snapshot} />
          : <HoldersCard snapshot={snapshot} />}
    </main>
  );
}

const FIXTURE_HOLDERS: StatsShareHolder[] = Array.from({ length: 10 }, (_, index) => ({
  rank: index + 1,
  wallet: `0x${String(index + 1).padStart(40, "0")}`,
  fid: 9_000 + index,
  username: index === 8 ? null : `collector${index + 1}`,
  displayName: index === 8 ? "Display Name Friend" : `Collector ${index + 1}`,
  pfpUrl: null,
  xUsername: index === 7 ? "verified_x_friend" : null,
  ownedCount: 80 - index * 4,
  ownedPct: 0.8 - index * 0.04,
  bestRarityRank: index + 1,
  previewTokenIds: [index + 1],
  remainingCount: 79 - index * 4,
  floorValueEth: 8 - index * 0.4,
}));

function fixtureSnapshot(fixture: string): StatsShareSnapshot {
  const common = {
    id: "00000000000000000000000000000000",
    imageKey: "fixture.png",
    imageReady: true,
    rendererVersion: "stats-share-v1",
    dataAsOf: "2026-08-04T00:00:00.000Z",
    createdAt: "2026-08-04T00:00:00.000Z",
  };
  if (fixture === "overview") return {
    ...common, kind: "overview", request: { kind: "overview" }, title: "Share Collection Overview", farcasterText: "10X Warplets — NFT Collection Overview", twitterText: "10X Warplets — NFT Collection Overview", launchPath: "/stats",
    data: { metrics: { items: 10_000, floorPrice: 0.1, floorChange1dPercent: 12.4, topOffer: 0.08, volume24h: 4.25, totalVolume: 315.7, listed: { count: 32, percentage: 0.32 }, ownersUnique: { count: 8_992, percentage: 89.92 }, farcasterHolders: { count: 8_540 }, identityCoverage: { percentage: 94.97 }, fairOwnership: { cohortRetentionPercentage: 99.95, exactlyOneWallets: 8_200, multipleWallets: 792, top10Percentage: 0.18, top100Percentage: 1.08 } } },
  };
  const chart = Array.from({ length: 16 }, (_, index) => ({ date: `Jul ${index + 1}`, sales: 8 + (index % 5) * 4, volume: 0.8 + index * 0.12, price: 0.09 + Math.sin(index / 2) * 0.015, floorPrice: 0.075 + index * 0.002, salePrice: 0.09 + Math.sin(index / 2) * 0.015, sale: 4 + index % 7, salePriceValue: 0.1 }));
  if (fixture.startsWith("market-")) {
    const metricName = fixture.slice(7) as "price" | "floor" | "volume" | "sales";
    return { ...common, kind: "market", request: { kind: "market", metric: metricName, range: "30d" }, title: `Share ${getStatsShareMarketLabel(metricName)}`, farcasterText: "Market fixture", twitterText: "Market fixture", launchPath: "/stats/market?range=30d", data: { metric: metricName, metrics: { sales: 126, volume: 18.42 }, series: { daily: chart, salePrices: chart, floor: chart } } };
  }
  if (fixture.startsWith("activity-")) {
    const event = fixture.slice(9) as "sale" | "listing" | "offer" | "send";
    const activityRows = chart.map((row, index) => ({ ...row, [`${event}Price`]: 0.05 + index * 0.004, [event]: 3 + index % 5 }));
    return { ...common, kind: "activity", request: { kind: "activity", event, range: "7d" }, title: "Share Activity", farcasterText: "Activity fixture", twitterText: "Activity fixture", launchPath: `/stats/social?range=7d&event=${event}`, data: { event, count: 29, series: { daily: activityRows }, chart: { buckets: activityRows }, daily: activityRows } };
  }
  if (fixture === "rank") return { ...common, kind: "holder-rank", request: { kind: "holder-rank", fid: 9000 }, title: "Share Your Rank", farcasterText: "Rank fixture", twitterText: "Rank fixture", launchPath: "/stats/holders", data: { row: FIXTURE_HOLDERS[0], totalHolders: 8_992 } };
  const friends = fixture === "friends" || fixture === "friends-short";
  return { ...common, kind: friends ? "holders-top10-friends" : "holders-top10", request: friends ? { kind: "holders-top10-friends", viewerFid: 9000 } : { kind: "holders-top10" }, title: friends ? "Share Top 10 Friends" : "Share Top 10 Holders", farcasterText: "Leaderboard fixture", twitterText: "Leaderboard fixture", launchPath: "/stats/holders", data: { rows: fixture === "friends-short" ? FIXTURE_HOLDERS.slice(0, 4) : FIXTURE_HOLDERS, totalHolders: 8_992 } };
}

export function StatsShareFixturePage({ fixture }: { fixture: string }) {
  return <SnapshotCard snapshot={fixtureSnapshot(fixture)} ready />;
}

export default function StatsShareCardPage({ shareId, renderOnly }: { shareId: string; renderOnly: boolean }) {
  const [response, setResponse] = useState<StatsShareCreateResponse | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/stats/shares/${encodeURIComponent(shareId)}`, { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (result) => {
        const body = await result.json() as StatsShareCreateResponse & { error?: string };
        if (!result.ok) throw new Error(body.error || `Snapshot failed (${result.status})`);
        setResponse(body);
      })
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [shareId]);
  const imageUrls = useMemo(() => {
    if (!response) return [];
    const data = record(response.snapshot.data);
    const rows = (response.snapshot.kind === "holder-rank" ? [data.row] : Array.isArray(data.rows) ? data.rows : []) as StatsShareHolder[];
    return rows.map((row) => row?.pfpUrl).filter((value): value is string => Boolean(value));
  }, [response]);
  useEffect(() => {
    if (!response) return;
    let cancelled = false;
    const settle = async () => {
      await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 1500))]);
      await Promise.all(imageUrls.map((src) => new Promise<void>((resolve) => {
        const image = new Image();
        const timer = window.setTimeout(resolve, 1500);
        image.onload = image.onerror = () => { window.clearTimeout(timer); resolve(); };
        image.src = src;
      })));
      if (!cancelled) setReady(true);
    };
    void settle();
    return () => { cancelled = true; };
  }, [imageUrls, response]);
  if (error) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "black", color: "#ff7777", fontFamily: "sans-serif" }}>{error}</div>;
  if (!response) return <div style={{ width: 1200, height: 800, display: "grid", placeItems: "center", background: "black", color: GREEN, font: "900 24px sans-serif" }}>Preparing Stats snapshot…</div>;
  if (renderOnly) return <SnapshotCard snapshot={response.snapshot} ready={ready} />;
  return (
    <div style={{ minHeight: "100vh", background: "#000", padding: "32px 16px", overflow: "auto" }}>
      <div style={{ width: 1200, transformOrigin: "top center", margin: "0 auto" }}><SnapshotCard snapshot={response.snapshot} ready={ready} /></div>
      <div style={{ margin: "24px auto", textAlign: "center" }}><a href={response.snapshot.launchPath} style={{ display: "inline-block", color: "#000", background: GREEN, borderRadius: 999, padding: "13px 24px", font: "900 15px sans-serif", textDecoration: "none" }}>Open live Stats</a></div>
    </div>
  );
}
