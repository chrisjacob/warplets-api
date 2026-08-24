import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  formatStatsShareIdentity,
  getStatsShareActivityLabel,
  getStatsShareMarketLabel,
  getStatsShareRangeLabel,
  STATS_SHARE_RENDERER_VERSION,
  type StatsShareCreateResponse,
  type StatsShareHolder,
  type StatsShareMarketMetric,
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
  const valueFontSize = value.length >= 13 ? 43 : value.length >= 11 ? 46 : 48;
  return (
    <div style={{ border: `2px solid ${color}88`, borderRadius: 18, background: purple ? "linear-gradient(145deg,#201343 0%,#100925 52%,#030106 100%)" : "linear-gradient(145deg,#002609 0%,#001405 52%,#000401 100%)", padding: "12px 18px", minHeight: 0 }}>
      <div style={{ color: purple ? "#aa95ff" : "#86b886", fontSize: 22, lineHeight: 1.1, fontWeight: 900, textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ color, fontSize: valueFontSize, lineHeight: 1.08, fontWeight: 950, marginTop: 11, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

const OVERVIEW_FALLBACK_WARPLETS = [94, 234, 548, 1358, 1589, 3258, 3786, 4318, 4334, 4512, 9697];

function OverviewWarpletStrips({ tokenIds }: { tokenIds: number[] }) {
  const deterministicFallbacks = Array.from({ length: 22 }, (_, index) => ((index * 197 + 93) % 10_000) + 1);
  const prioritizedTokenIds = [...tokenIds, ...OVERVIEW_FALLBACK_WARPLETS, ...deterministicFallbacks]
    .filter((tokenId, index, all) => Number.isInteger(tokenId) && tokenId > 0 && tokenId <= 10_000 && all.indexOf(tokenId) === index)
    .slice(0, 22);
  const leftColumn = Array<number>(11);
  const rightColumn = Array<number>(11);
  const centerOutRows = [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10];
  const centerOutSlots: Array<readonly [number[], number]> = [];
  centerOutRows.forEach((row) => centerOutSlots.push([leftColumn, row], [rightColumn, row]));
  prioritizedTokenIds.forEach((tokenId, priorityIndex) => {
    const [strip, slot] = centerOutSlots[priorityIndex];
    strip[slot] = tokenId;
  });
  const strip = (side: "left" | "right", ids: number[]) => (
    <div style={{ position: "absolute", top: 0, bottom: 0, [side]: 0, width: 100, overflow: "hidden", background: "#001203" }}>
      <div style={{ width: 100, height: 1100, marginTop: -50 }}>
        {ids.map((tokenId) => (
          <img
            key={tokenId}
            src={`https://warplets.10x.meme/${tokenId}.jpg`}
            alt=""
            width={100}
            height={100}
            style={{ display: "block", width: 100, height: 100, objectFit: "cover", imageRendering: "auto" }}
          />
        ))}
      </div>
    </div>
  );
  return (
    <>{strip("left", leftColumn)}{strip("right", rightColumn)}</>
  );
}

function OverviewCard({ snapshot }: { snapshot: StatsShareSnapshot }) {
  const data = record(snapshot.data);
  const listed = record(metric(data, "listed", "listedCount"));
  const owners = record(metric(data, "ownersUnique", "uniqueOwners", "owners"));
  const farcaster = record(metric(data, "farcasterHolders", "socialHolders"));
  const coverage = record(metric(data, "identityCoverage"));
  const fair = record(metric(data, "fairOwnership"));
  const warpletTokenIds = Array.isArray(data.warpletTokenIds)
    ? data.warpletTokenIds.map(Number).filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0 && tokenId <= 10_000)
    : [];
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
  const panel = snapshot.request.kind === "overview" ? snapshot.request.panel : "collection";
  const purple = panel === "fair-launch";
  const displayedMetrics = purple ? purpleMetrics : greenMetrics;
  return (
    <div style={{ position: "relative", width: 1000, height: 1000 }}>
      <OverviewWarpletStrips tokenIds={warpletTokenIds} />
      <section style={{ boxSizing: "border-box", position: "absolute", top: 0, bottom: 0, left: 100, width: 800, display: "flex", flexDirection: "column", background: purple ? "linear-gradient(160deg,#1b0d3d 0%,#0b061a 48%,#000 100%)" : "linear-gradient(160deg,#00300b 0%,#001505 48%,#000 100%)", padding: 38 }}>
        <div style={{ color: purple ? PURPLE : GREEN, fontSize: 41, lineHeight: 1.1, fontWeight: 950, letterSpacing: purple ? -1.3 : -0.4, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {purple ? "Fair Launch. Mass Distribution." : "10X Warplets NFT Collection"}
        </div>
        <div style={{ color: purple ? "#c0b2fb" : "#b8e6b8", fontSize: 26, lineHeight: 1.2, marginTop: 9, whiteSpace: "nowrap" }}>
          {purple ? "The Warplets diamond hands. 10,000 wallet Farcaster airdrop." : "Where Builders, Traders and Attention align."}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(5, minmax(0, 1fr))", gap: 10, marginTop: 24, minHeight: 0, flex: 1 }}>
          {displayedMetrics.map(([label, value]) => <MetricTile key={label} label={label} value={value} purple={purple} />)}
        </div>
      </section>
    </div>
  );
}

type ChartPoint = { label: string; value: number };
type ActivitySharePoint = { label: string; value: number | null; count: number; avatarUrl: string | null; markerKey: string };

function chartRows(data: RecordValue, metricName: string): ChartPoint[] {
  const series = record(data.series);
  let candidates = metricName === "price"
    ? series.salePrices ?? data.salePrices ?? data.prices
    : metricName === "floor"
      ? series.floor ?? data.floorHistory ?? data.floor
      : metricName === "listings"
        ? series.listings ?? data.listings
        : metricName === "offers"
          ? series.offers ?? data.offers
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
      : metricName === "volume" ? ["volume", "volumeEth", "eth"]
        : metricName === "listings" ? ["listings", "listingCount", "count"]
          : metricName === "offers" ? ["offers", "offerCount", "count"]
            : metricName === "sales" ? ["sales", "saleCount", "count"] : [`${metricName}Price`, metricName, "count"];
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
  if (halfPeriod) {
    const midpoint = Math.ceil(rows.length / 2);
    const first = rows.slice(0, midpoint).reduce((sum, row) => sum + row.value, 0);
    const second = rows.slice(midpoint).reduce((sum, row) => sum + row.value, 0);
    return first > 0 ? ((second - first) / first) * 100 : null;
  }
  const start = rows[0]?.value;
  const end = rows.at(-1)?.value;
  return start && end != null ? ((end - start) / Math.abs(start)) * 100 : null;
}

function activityShareRows(data: RecordValue, eventName: "sale" | "listing" | "offer" | "send"): ActivitySharePoint[] {
  const buckets = record(data.chart).buckets;
  if (!Array.isArray(buckets)) return [];
  const firstEventIndex = buckets.findIndex((candidate) => (number(record(record(record(candidate).events)[eventName]).count) ?? 0) > 0);
  return buckets.map((candidate, index) => {
    const bucket = record(candidate);
    const event = record(record(bucket.events)[eventName]);
    const representative = record(event.representativeEvent);
    const markerParty = record(eventName === "sale" ? representative.to : representative.from);
    const count = number(event.count) ?? 0;
    const averagePrice = event.averagePriceEth == null ? null : number(event.averagePriceEth);
    const value = eventName === "send"
      ? firstEventIndex >= 0 ? 0 : null
      : averagePrice ?? (firstEventIndex > 0 && index < firstEventIndex ? 0 : null);
    const date = typeof bucket.startAt === "string" ? new Date(bucket.startAt) : null;
    return {
      label: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : String(index),
      value,
      count,
      avatarUrl: typeof markerParty.pfpUrl === "string" ? markerParty.pfpUrl : null,
      markerKey: String(representative.key ?? `${eventName}-${index}`),
    };
  });
}

function activityCountChange(rows: ActivitySharePoint[]): number | null {
  if (rows.length < 2) return null;
  const midpoint = Math.ceil(rows.length / 2);
  const first = rows.slice(0, midpoint).reduce((sum, row) => sum + row.count, 0);
  const second = rows.slice(midpoint).reduce((sum, row) => sum + row.count, 0);
  return first > 0 ? ((second - first) / first) * 100 : second > 0 ? 100 : 0;
}

function ActivityShareMarker(props: Record<string, unknown>) {
  const cx = number(props.cx) ?? 0;
  const cy = number(props.cy) ?? 0;
  const payload = record(props.payload);
  const count = number(payload.count) ?? 0;
  if (count <= 0 || payload.value == null) return <g />;
  const avatarUrl = typeof payload.avatarUrl === "string" ? payload.avatarUrl : null;
  const markerKey = String(payload.markerKey ?? `${cx}-${cy}`).replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `activity-share-avatar-${markerKey}-${Math.round(cx)}-${Math.round(cy)}`;
  const radius = 21;
  const countLabel = count.toLocaleString("en-US");
  const chipWidth = Math.max(34, 16 + countLabel.length * 10);
  const markerColor = typeof props.stroke === "string" ? props.stroke : GREEN;
  const chipBackground = markerColor.toLowerCase() === "#ff3333"
    ? "#250303"
    : markerColor.toLowerCase() === "#ffff00"
      ? "#252503"
      : markerColor.toLowerCase() === "#33aaff"
        ? "#031825"
        : "#032503";
  return <g>
    <defs><clipPath id={clipId}><circle cx={cx} cy={cy} r={radius} /></clipPath></defs>
    <circle cx={cx} cy={cy} r={radius} fill="#000" />
    {avatarUrl
      ? <image href={avatarUrl} x={cx - radius} y={cy - radius} width={radius * 2} height={radius * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
      : <circle cx={cx} cy={cy} r={radius} fill={markerColor} fillOpacity={0.45} />}
    <rect x={cx - chipWidth / 2} y={cy - radius - 27} width={chipWidth} height={22} rx={9} fill={chipBackground} stroke={markerColor} strokeWidth={2} />
    <text x={cx} y={cy - radius - 11} textAnchor="middle" fill={markerColor} fontSize={16} fontWeight={900}>{countLabel}</text>
  </g>;
}

function MarketOrActivityCard({ snapshot }: { snapshot: StatsShareSnapshot }) {
  const data = record(snapshot.data);
  const isMarket = snapshot.kind === "market";
  const request = snapshot.request.kind === "market" || snapshot.request.kind === "activity" ? snapshot.request : null;
  const metricName = request?.kind === "market" ? request.metric : request?.kind === "activity" ? request.event : "sales";
  const range = request && "range" in request ? request.range : "all";
  const activityRows = !isMarket ? activityShareRows(data, metricName as "sale" | "listing" | "offer" | "send") : [];
  const rows = isMarket ? chartRows(data, metricName) : activityRows;
  const eventCount = number(data.count) ?? 0;
  const label = isMarket
    ? getStatsShareMarketLabel(metricName as "price" | "floor" | "volume" | "listings" | "offers" | "sales")
    : getStatsShareActivityLabel(metricName as "sale" | "listing" | "offer" | "send", eventCount);
  const headlineMetric = isMarket
    ? metricName === "sales" ? metric(data, "sales", "saleCount")
      : metricName === "listings" ? metric(data, "listingActivity", "listings")
        : metricName === "offers" ? metric(data, "offerActivity", "offers")
      : metricName === "volume" ? metric(data, "volume", "periodVolume", "totalVolume")
        : rows.at(-1)?.value
    : eventCount;
  const headline = isMarket
    ? metricName === "sales" || metricName === "listings" || metricName === "offers" ? formatInteger(headlineMetric) : formatEth(headlineMetric)
    : `${formatInteger(headlineMetric)} ${label}`;
  const change = isMarket
    ? changePercent(rows as ChartPoint[], metricName === "volume" || metricName === "sales" || metricName === "listings" || metricName === "offers")
    : activityCountChange(activityRows);
  const color = isMarket ? GREEN : metricName === "sale" ? "#ff3333" : metricName === "listing" ? "#ffff00" : metricName === "offer" ? "#33aaff" : GREEN;
  const subject = !isMarket && request?.kind === "activity" && request.tokenId ? `10X Warplet #${request.tokenId}` : "10X Warplets";
  return (
    <div style={{ boxSizing: "border-box", height: "100%", border: `2px solid ${color}77`, borderRadius: 28, background: isMarket ? `linear-gradient(160deg,${color}12,#000 65%)` : `radial-gradient(ellipse at top left,${color}20 0%,${color}0b 34%,#000 68%)`, padding: "32px 24px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ color, fontSize: 38, fontWeight: 950, textTransform: "uppercase" }}>{subject} — {label}</div>
          <div style={{ color: "white", fontSize: 72, lineHeight: 1.08, fontWeight: 950, marginTop: 10 }}>{headline}</div>
        </div>
        <div style={{ minWidth: 125, flexShrink: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ color: "#b5d0b5", fontSize: 38, fontWeight: 900 }}>{getStatsShareRangeLabel(range)}</div>
          {change != null && <div style={{ color: change >= 0 ? GREEN : "#ff5555", fontSize: 46, fontWeight: 950, marginTop: 8 }}>{change > 0 ? "+" : ""}{change.toFixed(1)}%</div>}
        </div>
      </div>
      <div style={{ marginTop: isMarket ? 24 : 28 }}>
        {rows.length > 0 ? (
          <LineChart width={912} height={720} data={rows} margin={{ top: isMarket ? 8 : 58, right: 4, left: 0, bottom: 54 }}>
            <CartesianGrid stroke="#154015" strokeDasharray="4 8" vertical={false} />
            <XAxis dataKey="label" stroke="#709570" tick={{ fill: "#88aa88", fontSize: 30 }} tickMargin={14} minTickGap={80} padding={!isMarket ? { left: 24, right: 24 } : undefined} />
            <YAxis stroke="#709570" tick={{ fill: "#88aa88", fontSize: 30 }} tickMargin={8} width={112} padding={!isMarket ? { bottom: 24 } : undefined} />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={5} dot={isMarket ? false : <ActivityShareMarker stroke={color} />} connectNulls={!isMarket} isAnimationActive={false} />
          </LineChart>
        ) : <div style={{ height: 720, display: "grid", placeItems: "center", color: "#8bbf8b", fontSize: 30, fontWeight: 900 }}>No activity found.</div>}
      </div>
      <div style={{ color: "#789978", fontSize: 22, marginTop: 2, textAlign: "right" }}>{asOfLabel(snapshot.dataAsOf)}</div>
    </div>
  );
}

function MarketAllMiniChart({ data, metricName, range, index }: { data: RecordValue; metricName: StatsShareMarketMetric; range: string; index: number }) {
  const rows = chartRows(data, metricName);
  const countMetric = metricName === "sales" ? metric(data, "sales", "saleCount")
    : metricName === "listings" ? metric(data, "listingActivity", "listings")
      : metricName === "offers" ? metric(data, "offerActivity", "offers") : null;
  const headlineMetric = countMetric ?? (metricName === "volume" ? metric(data, "volume", "periodVolume", "totalVolume") : rows.at(-1)?.value);
  const headline = metricName === "sales" || metricName === "listings" || metricName === "offers"
    ? formatInteger(headlineMetric)
    : formatEth(headlineMetric);
  const change = changePercent(rows, metricName === "volume" || metricName === "sales" || metricName === "listings" || metricName === "offers");
  return (
    <section style={{ boxSizing: "border-box", width: 480, height: 315, overflow: "hidden", borderRight: index % 2 === 0 ? `2px solid ${GREEN}77` : undefined, borderBottom: index < 4 ? `2px solid ${GREEN}77` : undefined, background: "linear-gradient(160deg,#001404,#000 68%)", padding: "14px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "0 8px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: GREEN, fontSize: 20, lineHeight: 1, fontWeight: 950, textTransform: "uppercase", whiteSpace: "nowrap" }}>{getStatsShareMarketLabel(metricName)}</div>
          <div style={{ color: "white", fontSize: 34, lineHeight: 1.05, fontWeight: 950, marginTop: 6, whiteSpace: "nowrap" }}>{headline}</div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ color: "#b5d0b5", fontSize: 17, fontWeight: 900 }}>{getStatsShareRangeLabel(range as "7d" | "30d" | "90d" | "1y" | "all")}</div>
          {change != null && <div style={{ color: change >= 0 ? GREEN : "#ff5555", fontSize: 22, fontWeight: 950, marginTop: 4 }}>{change > 0 ? "+" : ""}{change.toFixed(1)}%</div>}
        </div>
      </div>
      {rows.length > 0 ? (
        <LineChart width={460} height={227} data={rows} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#154015" strokeDasharray="3 7" vertical={false} />
          <XAxis dataKey="label" stroke="#709570" tick={{ fill: "#88aa88", fontSize: 16 }} tickMargin={8} minTickGap={48} />
          <YAxis stroke="#709570" tick={{ fill: "#88aa88", fontSize: 16 }} tickMargin={5} width={70} />
          <Line type="monotone" dataKey="value" stroke={GREEN} strokeWidth={3} dot={false} isAnimationActive={false} />
        </LineChart>
      ) : <div style={{ height: 227, display: "grid", placeItems: "center", color: "#8bbf8b", fontSize: 18, fontWeight: 900 }}>No data found.</div>}
    </section>
  );
}

function MarketAllCard({ snapshot }: { snapshot: StatsShareSnapshot }) {
  const data = record(snapshot.data);
  const range = snapshot.request.kind === "market-all" ? snapshot.request.range : "all";
  const metrics: StatsShareMarketMetric[] = ["price", "floor", "volume", "listings", "offers", "sales"];
  return (
    <div style={{ boxSizing: "border-box", position: "relative", width: 1000, height: 1000, padding: "16px 18px 0", background: "#000" }}>
      <div style={{ display: "grid", gridTemplateColumns: "480px 480px", gridTemplateRows: "315px 315px 315px", gap: 0, overflow: "hidden", border: `2px solid ${GREEN}77`, borderRadius: 18 }}>
        {metrics.map((metricName, index) => <MarketAllMiniChart key={metricName} data={data} metricName={metricName} range={range} index={index} />)}
      </div>
      <div style={{ boxSizing: "border-box", height: 35, display: "flex", alignItems: "center", justifyContent: "flex-end", color: "#789978", background: "#000", fontSize: 18, lineHeight: 1, textAlign: "right" }}>{asOfLabel(snapshot.dataAsOf)}</div>
    </div>
  );
}

function HolderAvatar({ holder, size = 74, round = false }: { holder: StatsShareHolder; size?: number; round?: boolean }) {
  const initials = (holder.displayName || holder.username || holder.wallet).replace(/^@/, "").slice(0, 2).toUpperCase();
  return holder.pfpUrl
    ? <img src={holder.pfpUrl} alt="" width={size * 2} height={size * 2} decoding="sync" style={{ display: "block", width: size, height: size, borderRadius: round ? 999 : 16, objectFit: "cover", imageRendering: "auto", background: "#062006" }} />
    : <div style={{ width: size, height: size, borderRadius: round ? 999 : 16, display: "grid", placeItems: "center", color: GREEN, background: "#062006", fontSize: 25, fontWeight: 950 }}>{initials}</div>;
}

function HolderCard({ holder, slot, large = false }: { holder?: StatsShareHolder; slot: number; large?: boolean }) {
  if (!holder) return <div style={{ height: large ? 520 : "100%", border: "2px dashed #315231", borderRadius: 18, background: "#04100488" }} />;
  return (
    <div style={{ boxSizing: "border-box", height: large ? 520 : "100%", display: "flex", alignItems: "center", gap: large ? 32 : 18, border: `2px solid ${GREEN}66`, borderRadius: 18, background: "#031604", padding: large ? 36 : 17 }}>
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

function RankHolderCard({ holder, active }: { holder: StatsShareHolder; active: boolean }) {
  const accent = active ? "#ffff00" : GREEN;
  const identity = formatStatsShareIdentity(holder, "farcaster");
  return (
    <section style={{ boxSizing: "border-box", height: 242, border: `2px solid ${accent}88`, borderRadius: 24, background: active ? "linear-gradient(145deg,rgba(255,255,0,.10),#081004 58%,#010401)" : "linear-gradient(145deg,#062208,#021005 58%,#000)", padding: "22px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ minWidth: 104, border: `3px solid ${accent}`, borderRadius: 999, color: accent, background: `${accent}18`, padding: "8px 15px", fontSize: 29, lineHeight: 1, fontWeight: 950, textAlign: "center" }}>#{formatInteger(holder.rank)}</div>
        <div style={{ border: `3px solid ${accent}`, borderRadius: 999, overflow: "hidden", width: 82, height: 82, flexShrink: 0 }}><HolderAvatar holder={holder} size={82} round /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ color: accent, fontSize: 31, lineHeight: 1.05, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{identity}</div>
            {active && <span style={{ borderRadius: 7, background: "#ffff00", color: "#000", padding: "4px 8px", fontSize: 17, lineHeight: 1, fontWeight: 950 }}>YOU</span>}
          </div>
          {holder.username && holder.displayName && <div style={{ color: "#8bbf8b", fontSize: 21, marginTop: 7 }}>{holder.displayName}</div>}
        </div>
        <div style={{ minWidth: 105, textAlign: "right" }}>
          <div style={{ color: GREEN, fontSize: 44, lineHeight: 1, fontWeight: 950 }}>{formatInteger(holder.ownedCount)}</div>
          <div style={{ color: "#8bbf8b", fontSize: 20, fontWeight: 800, marginTop: 7 }}>{formatPercent(holder.ownedPct, 2)}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "105px minmax(0,1fr) 150px", alignItems: "end", gap: 18, marginTop: 16 }}>
        <div style={{ color: "#8bbf8b", fontSize: 18, lineHeight: 1.15, fontWeight: 850, textTransform: "uppercase" }}>Best<div style={{ color: GREEN, fontSize: 26, marginTop: 4 }}>#{formatInteger(holder.bestRarityRank)}</div></div>
        <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
          {holder.previewTokenIds.slice(0, 5).map((tokenId) => <img key={tokenId} src={`https://warplets.10x.meme/${tokenId}.jpg`} alt="" width={192} height={192} decoding="sync" style={{ display: "block", width: 96, height: 96, borderRadius: 6, objectFit: "cover", imageRendering: "auto", background: "#061606" }} />)}
          {holder.previewTokenIds.length < 5 && holder.remainingCount > 0 && <div style={{ width: 96, height: 96, borderRadius: 6, display: "grid", placeItems: "center", color: GREEN, background: "#061606", fontSize: 22, fontWeight: 950 }}>+{formatInteger(holder.remainingCount)}</div>}
        </div>
        <div style={{ color: "#8bbf8b", fontSize: 18, lineHeight: 1.15, fontWeight: 850, textAlign: "right", textTransform: "uppercase" }}>Floor value<div style={{ color: "#33aaff", fontSize: 24, marginTop: 5, whiteSpace: "nowrap" }}>{formatEth(holder.floorValueEth)}</div></div>
      </div>
    </section>
  );
}

function Top10HolderCard({ holder, slot, friendMode }: { holder?: StatsShareHolder; slot: number; friendMode: boolean }) {
  if (!holder) return <div style={{ height: "100%", border: `2px dashed ${friendMode ? PURPLE : GREEN}55`, borderRadius: 18, background: friendMode ? "#0d0820aa" : "#041004aa" }} />;
  const active = holder.isViewer === true;
  const accent = active ? "#ffff00" : friendMode || holder.isTopFriend ? PURPLE : GREEN;
  const identity = formatStatsShareIdentity(holder, "farcaster");
  return (
    <section style={{ boxSizing: "border-box", height: "100%", overflow: "hidden", border: `2px solid ${accent}88`, borderRadius: 18, background: active ? "linear-gradient(145deg,rgba(255,255,0,.10),#080b03 68%,#000)" : friendMode ? "linear-gradient(145deg,#160c35,#070313 68%,#000)" : "linear-gradient(145deg,#062208,#021005 68%,#000)", padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 62, border: `2px solid ${accent}`, borderRadius: 999, color: accent, background: `${accent}18`, padding: "6px 8px", fontSize: 20, lineHeight: 1, fontWeight: 950, textAlign: "center" }}>#{formatInteger(holder.rank ?? slot)}</div>
        <div style={{ width: 54, height: 54, flexShrink: 0, overflow: "hidden", border: `2px solid ${accent}`, borderRadius: 999 }}><HolderAvatar holder={holder} size={54} round /></div>
        <div style={{ minWidth: 0, flex: 1, color: accent, fontSize: 24, lineHeight: 1.2, paddingBottom: 2, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{identity}</div>
        <div style={{ minWidth: 48, textAlign: "right" }}>
          <div style={{ color: active ? "#ffff00" : accent, fontSize: 29, lineHeight: 1, fontWeight: 950 }}>{formatInteger(holder.ownedCount)}</div>
          <div style={{ color: friendMode && !active ? "#b9aaff" : "#8bbf8b", fontSize: 13, fontWeight: 800, marginTop: 4 }}>{formatPercent(holder.ownedPct, 2)}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr) 100px", alignItems: "end", gap: 10, marginTop: 8 }}>
        <div style={{ color: friendMode && !active ? "#b9aaff" : "#8bbf8b", fontSize: 12, lineHeight: 1.1, fontWeight: 850, textTransform: "uppercase" }}>Best<div style={{ color: accent, fontSize: 17, marginTop: 3 }}>#{formatInteger(holder.bestRarityRank)}</div></div>
        <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
          {holder.previewTokenIds.slice(0, 4).map((tokenId) => <img key={tokenId} src={`https://warplets.10x.meme/${tokenId}.jpg`} alt="" width={116} height={116} decoding="sync" style={{ display: "block", width: 58, height: 58, borderRadius: 4, objectFit: "cover", imageRendering: "auto", background: "#061606" }} />)}
        </div>
        <div style={{ color: friendMode && !active ? "#b9aaff" : "#8bbf8b", fontSize: 11, lineHeight: 1.1, fontWeight: 850, textAlign: "right", textTransform: "uppercase" }}>Floor value<div style={{ color: "#33aaff", fontSize: 15, marginTop: 4, whiteSpace: "nowrap" }}>{formatEth(holder.floorValueEth)}</div></div>
      </div>
    </section>
  );
}

function HoldersCard({ snapshot }: { snapshot: StatsShareSnapshot }) {
  const data = record(snapshot.data);
  const isRank = snapshot.kind === "holder-rank";
  const rows = (isRank ? [data.row] : Array.isArray(data.rows) ? data.rows : []).filter(Boolean) as StatsShareHolder[];
  const total = number(data.totalHolders) ?? 0;
  if (isRank) {
    const holder = data.row as StatsShareHolder | undefined;
    const rankRows = (Array.isArray(data.rows) ? data.rows : holder ? [holder] : []).filter(Boolean) as StatsShareHolder[];
    return (
      <div style={{ boxSizing: "border-box", position: "relative", height: "100%", border: "2px solid #ffff00aa", borderRadius: 28, background: "radial-gradient(circle at 8% 4%,rgba(255,255,0,.18),transparent 34%),linear-gradient(160deg,#181800,#030300 58%,#000 82%)", padding: "44px 42px 30px" }}>
        <div style={{ color: "#ffff00", fontSize: 41, lineHeight: 1, fontWeight: 950, textTransform: "uppercase" }}>Leaderboard Rank: #{formatInteger(holder?.rank)} of {formatInteger(total)}</div>
        <div style={{ display: "grid", gridTemplateRows: "repeat(3,242px)", gap: 20, marginTop: 34 }}>
          {rankRows.map((row) => <RankHolderCard key={row.wallet} holder={row} active={row.wallet === holder?.wallet} />)}
        </div>
        <div style={{ position: "absolute", right: 42, bottom: 26, color: "#9b9b6d", fontSize: 18, textAlign: "right" }}>{asOfLabel(snapshot.dataAsOf)}</div>
      </div>
    );
  }
  const friendMode = snapshot.kind === "holders-top10-friends";
  const theme = friendMode ? PURPLE : GREEN;
  return (
    <div style={{ boxSizing: "border-box", position: "relative", height: "100%", border: `2px solid ${theme}99`, borderRadius: 28, background: friendMode ? "radial-gradient(circle at 8% 4%,rgba(121,89,255,.24),transparent 34%),linear-gradient(160deg,#10082b,#030108 65%,#000)" : "radial-gradient(circle at 8% 4%,rgba(0,255,0,.16),transparent 34%),linear-gradient(160deg,#001704,#000 65%)", padding: "30px 32px 42px" }}>
      <div style={{ color: theme, fontSize: 36, lineHeight: 1, fontWeight: 950, marginBottom: 18 }}>{friendMode ? "LEADERBOARD: TOP 10 FRIENDS" : "LEADERBOARD: TOP 10 HOLDERS"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(5,minmax(0,1fr))", gridAutoFlow: "column", gap: 10, height: 820 }}>
        {Array.from({ length: 10 }, (_, index) => <Top10HolderCard key={index} holder={rows[index]} slot={index + 1} friendMode={friendMode} />)}
      </div>
      <div style={{ position: "absolute", right: 32, bottom: 16, color: friendMode ? "#9f91d1" : "#789978", fontSize: 16, textAlign: "right" }}>{asOfLabel(snapshot.dataAsOf)}</div>
    </div>
  );
}

function SnapshotCard({ snapshot, ready }: { snapshot: StatsShareSnapshot; ready: boolean }) {
  return (
    <main data-stats-share-ready={ready ? "true" : "false"} style={{ boxSizing: "border-box", width: 1000, height: 1000, padding: snapshot.kind === "overview" || snapshot.kind === "market-all" ? 0 : 18, overflow: "hidden", color: "white", background: "#000", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {snapshot.kind === "overview" ? <OverviewCard snapshot={snapshot} />
        : snapshot.kind === "market-all" ? <MarketAllCard snapshot={snapshot} />
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
  isViewer: index === 0,
  isTopFriend: false,
}));

function fixtureSnapshot(fixture: string): StatsShareSnapshot {
  const common = {
    id: "00000000000000000000000000000000",
    imageKey: "fixture.png",
    imageReady: true,
    rendererVersion: STATS_SHARE_RENDERER_VERSION,
    dataAsOf: "2026-08-04T00:00:00.000Z",
    createdAt: "2026-08-04T00:00:00.000Z",
  };
  if (fixture === "overview" || fixture === "overview-collection" || fixture === "overview-fair-launch") return {
    ...common, kind: "overview", request: { kind: "overview", panel: fixture === "overview-fair-launch" ? "fair-launch" : "collection" }, title: fixture === "overview-fair-launch" ? "Share Fair Launch Stats" : "Share NFT Collection Stats", farcasterText: "10X Warplets — Overview Stats", twitterText: "10X Warplets — Overview Stats", launchPath: "/stats",
    data: { metrics: { items: 10_000, floorPrice: 0.1, floorChange1dPercent: 12.4, topOffer: 0.08, volume24h: 4.25, totalVolume: 315.7, listed: { count: 32, percentage: 0.32 }, ownersUnique: { count: 8_992, percentage: 89.92 }, farcasterHolders: { count: 8_540 }, identityCoverage: { percentage: 94.97 }, fairOwnership: { cohortRetentionPercentage: 99.95, exactlyOneWallets: 8_200, multipleWallets: 792, top10Percentage: 0.18, top100Percentage: 1.08 } }, warpletTokenIds: OVERVIEW_FALLBACK_WARPLETS.slice(0, 10) },
  };
  const chart = Array.from({ length: 16 }, (_, index) => ({ date: `Jul ${index + 1}`, sales: 8 + (index % 5) * 4, volume: 0.8 + index * 0.12, price: 0.09 + Math.sin(index / 2) * 0.015, floorPrice: 0.075 + index * 0.002, salePrice: 0.09 + Math.sin(index / 2) * 0.015, sale: 4 + index % 7, salePriceValue: 0.1 }));
  if (fixture.startsWith("market-")) {
    if (fixture === "market-all") return { ...common, kind: "market-all", request: { kind: "market-all", range: "30d" }, title: "Share All Market Stats", farcasterText: "10X Warplets — Market Stats (30 Days)", twitterText: "10X Warplets — Market Stats (30 Days)", launchPath: "/stats/market?range=30d", data: { metrics: { sales: 126, volume: 18.42, listingActivity: 84, offerActivity: 215 }, series: { daily: chart, salePrices: chart, floor: chart, listings: chart.map((row, index) => ({ ...row, listings: 4 + index % 6 })), offers: chart.map((row, index) => ({ ...row, offers: 9 + index % 8 })) } } };
    const metricName = fixture.slice(7) as "price" | "floor" | "volume" | "listings" | "offers" | "sales";
    return { ...common, kind: "market", request: { kind: "market", metric: metricName, range: "30d" }, title: `Share ${getStatsShareMarketLabel(metricName)}`, farcasterText: "Market fixture", twitterText: "Market fixture", launchPath: "/stats/market?range=30d", data: { metric: metricName, metrics: { sales: 126, volume: 18.42, listingActivity: 84, offerActivity: 215 }, series: { daily: chart, salePrices: chart, floor: chart, listings: chart.map((row, index) => ({ ...row, listings: 4 + index % 6 })), offers: chart.map((row, index) => ({ ...row, offers: 9 + index % 8 })) } } };
  }
  if (fixture.startsWith("activity-") || fixture.startsWith("item-activity-")) {
    const itemActivity = fixture.startsWith("item-activity-");
    const event = fixture.slice(itemActivity ? 14 : 9) as "sale" | "listing" | "offer" | "send";
    const counts = [1, 0, 4, 0, 7, 3, 14];
    const prices = [0.005, null, 0.0015, null, 0.0008, 0.0005, 0.0004];
    const buckets = counts.map((count, index) => ({
      index,
      startAt: new Date(Date.UTC(2026, 6, 5 + index * 4)).toISOString(),
      endAt: new Date(Date.UTC(2026, 6, 9 + index * 4)).toISOString(),
      events: {
        [event]: {
          count,
          averagePriceEth: event === "send" ? 0 : prices[index],
          representativeEvent: count > 0 ? {
            key: `${event}-${index}`,
            tokenId: 94 + index,
            priceEth: prices[index],
            from: { wallet: `0x${String(index + 1).padStart(40, "0")}`, pfpUrl: `https://warplets.10x.meme/${94 + index}.jpg` },
            to: { wallet: `0x${String(index + 11).padStart(40, "0")}`, pfpUrl: `https://warplets.10x.meme/${548 + index}.jpg` },
          } : null,
        },
      },
    }));
    return { ...common, kind: "activity", request: { kind: "activity", event, range: "7d", ...(itemActivity ? { tokenId: 4512 } : {}) }, title: itemActivity ? "Share Item #4512 Activity" : "Share Activity", farcasterText: "Activity fixture", twitterText: "Activity fixture", launchPath: itemActivity ? "/?warplet=4512" : `/stats/social?range=7d&event=${event}`, data: { event, count: 29, eventCounts: { [event]: 29 }, chart: { buckets } } };
  }
  if (fixture === "rank") return { ...common, kind: "holder-rank", request: { kind: "holder-rank", fid: 9000 }, title: "Share Your Rank", farcasterText: "Rank fixture", twitterText: "Rank fixture", launchPath: "/stats/holders", data: { row: FIXTURE_HOLDERS[0], rows: FIXTURE_HOLDERS.slice(0, 3), totalHolders: 8_992 } };
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
        const responseBody = await result.text();
        if (!responseBody) throw new Error(`Snapshot service returned an empty response (${result.status})`);
        let body: StatsShareCreateResponse & { error?: string };
        try {
          body = JSON.parse(responseBody) as StatsShareCreateResponse & { error?: string };
        } catch {
          throw new Error(`Snapshot service returned an invalid response (${result.status})`);
        }
        if (!result.ok) throw new Error(body.error || `Snapshot failed (${result.status})`);
        setResponse(body);
      })
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [shareId]);
  const imageUrls = useMemo(() => {
    if (!response) return [];
    const data = record(response.snapshot.data);
    const rows = (Array.isArray(data.rows) ? data.rows : response.snapshot.kind === "holder-rank" ? [data.row] : []) as StatsShareHolder[];
    const overviewTokenIds = (response.snapshot.kind === "overview" || response.snapshot.kind === "market-all") && Array.isArray(data.warpletTokenIds)
      ? data.warpletTokenIds.map(Number).filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0 && tokenId <= 10_000)
      : [];
    const activityAvatarUrls = response.snapshot.kind === "activity" && Array.isArray(record(data.chart).buckets)
      ? (record(data.chart).buckets as unknown[]).flatMap((candidate) => {
          const events = record(record(candidate).events);
          return ["sale", "listing", "offer", "send"].flatMap((eventName) => {
            const representative = record(record(events[eventName]).representativeEvent);
            const party = record(eventName === "sale" ? representative.to : representative.from);
            return typeof party.pfpUrl === "string" ? [party.pfpUrl] : [];
          });
        })
      : [];
    return [
      ...rows.map((row) => row?.pfpUrl).filter((value): value is string => Boolean(value)),
      ...rows.flatMap((row) => row?.previewTokenIds ?? []).map((tokenId) => `https://warplets.10x.meme/${tokenId}.jpg`),
      ...overviewTokenIds.map((tokenId) => `https://warplets.10x.meme/${tokenId}.jpg`),
      ...activityAvatarUrls,
    ];
  }, [response]);
  useEffect(() => {
    if (!response) return;
    let cancelled = false;
    const settle = async () => {
      await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 1500))]);
      await Promise.all(imageUrls.map((src) => new Promise<void>((resolve) => {
        const image = new Image();
        const timer = window.setTimeout(resolve, 5000);
        image.onload = image.onerror = () => { window.clearTimeout(timer); resolve(); };
        image.src = src;
      })));
      if (!cancelled) setReady(true);
    };
    void settle();
    return () => { cancelled = true; };
  }, [imageUrls, response]);
  if (error) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "black", color: "#ff7777", fontFamily: "sans-serif" }}>{error}</div>;
  if (!response) return <div style={{ width: 1000, height: 1000, display: "grid", placeItems: "center", background: "black", color: GREEN, font: "900 24px sans-serif" }}>Preparing Stats snapshot…</div>;
  if (renderOnly) return <SnapshotCard snapshot={response.snapshot} ready={ready} />;
  return (
    <div style={{ minHeight: "100vh", background: "#000", padding: "32px 16px", overflow: "auto" }}>
      <div style={{ width: 1000, transformOrigin: "top center", margin: "0 auto" }}><SnapshotCard snapshot={response.snapshot} ready={ready} /></div>
      <div style={{ margin: "24px auto", textAlign: "center" }}><a href={response.snapshot.launchPath} style={{ display: "inline-block", color: "#000", background: GREEN, borderRadius: 999, padding: "13px 24px", font: "900 15px sans-serif", textDecoration: "none" }}>Open live Stats</a></div>
    </div>
  );
}
