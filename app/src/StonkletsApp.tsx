import { AppViewport } from "./AppViewport";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import MiniAppShell from "./MiniAppShell";
import SiteFooter from "./SiteFooter";
import FarcasterSignInControl from "./FarcasterSignInControl";
import { WebConnectModal } from "./WebConnectModal";
import { loadAppSession, logoutAppPrincipal, type AppSessionState } from "./appSession";
import { authenticateStonkletsFarcaster } from "./stonkletsFarcasterAuth";
import { StonkletsToast, type StonkletsToastMessage } from "./StonkletsToast";
import StonkletsNotificationsPrompt from "./StonkletsNotificationsPrompt";
import { configureAppSurface, getEmbeddedWalletProvider, signalAppReady } from "./surfaceAdapter";
import { resolveAppSurface } from "./appRuntime";
import { detectMiniAppContext } from "./miniAppContext";
import { configureFarcasterWallet, restoreFarcasterWallet } from "./walletController";
import { MiniAppHeader, MiniAppMenuPage, useMiniAppChrome } from "./miniAppChrome";
import { STONKLETS_APP_HOSTS, STONKLETS_APP_PATH, STONKLETS_APP_SLUG } from "../shared/stonkletsApp";
import { STONKLETS_CATALOG, emptyMarketMetrics } from "../shared/stonkletsCatalog";
import { isStonkletsFlapPreview } from "../shared/stonkletsFlapPreview";
import { isStonkletsVotesPreview, mockVoteCount } from "../shared/stonkletsVotes";
import StonkletLaunchVotes from "./StonkletLaunchVotes";
import { STONKLET_TRADE_DESTINATIONS, stonkletTradeUrl } from "../shared/stonkletsTrading";
import { fetchStonkletChart } from "./stonkletsChartRequests";
import { DEFAULT_STONKLET_CHANGE_RANGE, STONKLET_CHANGE_RANGE_LABELS, STONKLET_CHANGE_RANGES, parseStonkletChangeRange, type StonkletChangeRange } from "../shared/stonkletsTime";
import { filterAndSortStonklets, stonkletMetric, visibleStonkletsFavourites, type StonkletsMarketEntry as MarketEntry } from "./stonkletsMarket";
import BstocksNoticeModal, { hasAcceptedBstocksNotice, isBstocksNoticeForced } from "./BstocksNoticeModal";

type Page = "market" | "trade" | "portfolio" | "leaderboard" | "stats";
type MarketSide = "stock" | "stonklet";
type Layout = "compact" | "chart" | "single-chart" | "single-grid";
type OrderKey = "trending" | "marketCap" | "volume24h" | "holders" | "change" | "favourites" | "az";
type Direction = "asc" | "desc";

const ORDER_OPTIONS: { key: OrderKey; label: string; metric: boolean }[] = [
  { key: "trending", label: "Trending", metric: false },
  { key: "change", label: "% Change", metric: true },
  { key: "marketCap", label: "Market Cap", metric: true },
  { key: "volume24h", label: "24h Volume", metric: true },
  { key: "holders", label: "Holders", metric: true },
  { key: "favourites", label: "Favourites", metric: false },
  { key: "az", label: "A-Z", metric: false },
];

const LAYOUT_OPTIONS: { key: Layout; label: string }[] = [
  { key: "compact", label: "Compare grid layout" },
  { key: "chart", label: "Compare chart layout" },
  { key: "single-chart", label: "Single chart layout" },
  { key: "single-grid", label: "Single grid layout" },
];

function isGridLayout(layout: Layout): boolean {
  return layout === "compact" || layout === "single-grid";
}

function isSingleLayout(layout: Layout): boolean {
  return layout === "single-chart" || layout === "single-grid";
}

const MARKET_LOADING_PREFIX = "Loading: ";
const MARKET_LOADING_SUFFIXES = [
  "Live Stonklets market data...",
  "Checking the bonding curves...",
  "Following the smart money...",
  "Almost done I swear...",
  "Counting votes...",
  "It will be worth the wait...",
];
const MARKET_LOADING_INTERVAL_MS = 3_000;

function getMarketLoadingMessage(elapsedMs: number): string {
  const suffix = MARKET_LOADING_SUFFIXES[Math.floor(elapsedMs / MARKET_LOADING_INTERVAL_MS) % MARKET_LOADING_SUFFIXES.length]!;
  const cycleElapsed = elapsedMs % MARKET_LOADING_INTERVAL_MS;
  const typeDuration = 1_000;
  const holdDuration = 1_750;
  const deleteDuration = 250;
  let visibleCharacters = suffix.length;
  if (cycleElapsed < typeDuration) {
    visibleCharacters = Math.ceil((suffix.length * cycleElapsed) / typeDuration);
  } else if (cycleElapsed >= typeDuration + holdDuration) {
    visibleCharacters = Math.floor(suffix.length * (1 - Math.min(1, (cycleElapsed - typeDuration - holdDuration) / deleteDuration)));
  }
  return `${MARKET_LOADING_PREFIX}${suffix.slice(0, Math.max(0, visibleCharacters))}`;
}

function shortWallet(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function SearchHeartIcon({ filled = false, className = "h-5 w-5", strokeWidth = 2 }: { filled?: boolean; className?: string; strokeWidth?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" overflow="visible" className={`${className} ${filled ? "fill-current" : "fill-none"}`} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6c-1.8-1.7-4.7-1.7-6.5.1L12 7l-2.3-2.3c-1.8-1.8-4.7-1.8-6.5-.1-1.9 1.8-1.9 4.8-.1 6.6L12 20l8.9-8.8c1.8-1.8 1.8-4.8-.1-6.6Z" /></svg>;
}

function OrderDirectionIcon({ direction }: { direction: Direction }) {
  return <svg aria-label={direction === "asc" ? "Ascending" : "Descending"} role="img" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {direction === "asc" ? <path d="M8 3v10M4 7l4-4 4 4" /> : <path d="M8 3v10M4 9l4 4 4-4" />}
  </svg>;
}

function StonkletsDropdown({ label, valueLabel, children }: { label: string; valueLabel: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <div ref={rootRef} className="relative min-w-0">
    <button type="button" onClick={() => setOpen((value) => !value)} className="stonklets-dropdown-trigger flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#00FF00]/25 bg-black/70 px-3 py-2 text-left text-sm text-[#00FF00] outline-none transition-[border-color,box-shadow] focus-visible:border-[#00FF00] focus-visible:shadow-[0_0_10px_rgba(0,255,0,0.18)]" aria-haspopup="listbox" aria-expanded={open}>
      <span className="sr-only">{label}: </span><span className="min-w-0 flex-1 truncate text-left text-sm text-[#00FF00]">{valueLabel}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className="absolute left-0 right-0 z-30 mt-2 overflow-visible rounded-xl border border-[#00FF00]/30 bg-black p-2 shadow-2xl" role="listbox" aria-label={label} onClick={() => setOpen(false)}><div className="stonklets-dropdown-label px-2 pb-1 pt-0.5 text-left text-xs font-bold text-white" aria-hidden="true">{label}:</div>{children}</div>}
  </div>;
}

function StonkletsLayoutSwitcher({ layout, onSelect }: { layout: Layout; onSelect: (layout: Layout) => void }) {
  const currentIndex = LAYOUT_OPTIONS.findIndex((option) => option.key === layout);
  const current = LAYOUT_OPTIONS[currentIndex] ?? LAYOUT_OPTIONS[0]!;
  const next = LAYOUT_OPTIONS[(currentIndex + 1 + LAYOUT_OPTIONS.length) % LAYOUT_OPTIONS.length] ?? LAYOUT_OPTIONS[0]!;
  return <button type="button" aria-label={`Change results layout. Current layout: ${current.label}. Next layout: ${next.label}.`} title={current.label} onClick={() => onSelect(next.key)} className="stonklets-layout-menu flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#00FF00]/35 bg-transparent text-[#00FF00] hover:bg-[#041204] focus-visible:border-[#00FF00] focus-visible:outline-none">
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-6 w-6" fill="currentColor"><rect x="4" y="4" width="5" height="5" rx="1" /><rect x="11" y="4" width="5" height="5" rx="1" /><rect x="4" y="11" width="5" height="5" rx="1" /><rect x="11" y="11" width="5" height="5" rx="1" /></svg>
  </button>;
}

function StonkletsHeaderAccount({ session, miniAppProfile, simplifiedFarcaster, open, centered, onOpenChange, onConnect, onShowFavourites, onEnableNotifications, onDisconnect }: {
  session: AppSessionState | null;
  miniAppProfile: AppSessionState["farcasterProfile"];
  simplifiedFarcaster: boolean;
  open: boolean;
  centered: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: () => void;
  onShowFavourites: () => void;
  onEnableNotifications: () => void;
  onDisconnect: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const connected = simplifiedFarcaster || Boolean(session?.authenticated);
  const profile = simplifiedFarcaster ? miniAppProfile ?? session?.farcasterProfile : session?.farcasterProfile;
  const avatar = profile?.pfpUrl?.trim() || "/farcaster.webp";
  const username = profile?.username?.trim().replace(/^@/, "");
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (event.target instanceof Element && event.target.closest(".miniapp-header__title-badge")) return;
      onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [onOpenChange, open]);
  const run = (action: () => void) => { onOpenChange(false); action(); };
  return <div className="search-header-account" ref={rootRef}>
    {!connected ? <button type="button" className="search-header-connect-button" onClick={onConnect}>Connect</button> : <button type="button" className="search-header-avatar-button" aria-haspopup="menu" aria-expanded={open} aria-label="Open account menu" onClick={() => onOpenChange(!open)}>
      <span className="search-header-avatar-stack">
        {!simplifiedFarcaster && session?.walletAddress && <span className="search-header-avatar-frame search-header-avatar-frame--wallet"><img src="/base.webp" alt="Wallet" className="search-header-avatar-image" /></span>}
        {(simplifiedFarcaster || session?.farcasterFid) && <span className="search-header-avatar-frame search-header-avatar-frame--identity"><img src={avatar} alt={username ? `@${username}` : "Farcaster"} className="search-header-avatar-image" /></span>}
      </span>
    </button>}
    {open && <AppViewport portalled={centered} onMouseDown={(event) => event.stopPropagation()} className={`search-header-account-menu${centered ? " search-header-account-menu--centered" : ""}`} role="menu">
      {!simplifiedFarcaster && <button type="button" role="menuitem" className="search-header-account-menu__connection" onClick={() => run(onConnect)}><span className="search-header-account-menu__avatar-frame"><img src="/base.webp" alt="" /></span><span>{session?.walletAddress ? shortWallet(session.walletAddress) : "Connect wallet"}</span></button>}
      <button type="button" role="menuitem" className="search-header-account-menu__connection" onClick={() => simplifiedFarcaster ? onOpenChange(false) : run(onConnect)}><span className="search-header-account-menu__avatar-frame"><img src={avatar} alt="" /></span><span>{username ? `@${username}` : simplifiedFarcaster ? "Farcaster identity" : "Connect social"}</span></button>
      <button type="button" role="menuitem" onClick={() => run(onShowFavourites)}>My favourites</button>
      <button type="button" role="menuitem" onClick={() => run(onEnableNotifications)}>Enable notifications</button>
      {connected && !simplifiedFarcaster && <button type="button" role="menuitem" onClick={() => run(onDisconnect)}>Disconnect</button>}
    </AppViewport>}
  </div>;
}

const defaultEntries: MarketEntry[] = STONKLETS_CATALOG.map((entry) => ({
  ...entry,
  stockMetrics: emptyMarketMetrics(),
  stonkletMetrics: emptyMarketMetrics(),
  favourites: 0,
  momentum7d: 0,
  stockFavourites: 0,
  stockMomentum7d: 0,
  stockPeriodChange: null,
  stonkletPeriodChange: null,
}));

function basePath(): string {
  return (STONKLETS_APP_HOSTS as readonly string[]).includes(window.location.hostname.toLowerCase()) ? "" : STONKLETS_APP_PATH;
}

function currentPage(): Page {
  const relative = window.location.pathname.slice(basePath().length).replace(/^\/+|\/+$/g, "");
  return (["trade", "portfolio", "leaderboard", "stats"] as Page[]).includes(relative as Page) ? relative as Page : "market";
}

function safeParam<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function compactNumber(value: number | null, currency = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${currency ? "$" : ""}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function priceText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 6 : 2 }).format(value);
}

function changeText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const formatted = absolute >= 100_000
    ? `${(value / 1_000).toFixed(0)}K`
    : absolute >= 10_000
      ? `${(value / 1_000).toFixed(1)}K`
      : absolute >= 1_000
        ? `${(value / 1_000).toFixed(2)}K`
        : absolute >= 100
          ? value.toFixed(0)
          : value.toFixed(2);
  return `${value > 0 ? "+" : ""}${formatted}%`;
}

function favouriteCountText(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 100_000) return `${(value / 1_000).toFixed(0)}K`;
  if (absolute >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return Math.round(value).toLocaleString("en-US");
}

const CHARACTER_FALLBACKS: Record<string, string> = { ORBIT: "https://warplets.10x.meme/709.png", CHIP: "https://warplets.10x.meme/5019.png", CORE: "https://warplets.10x.meme/2844.png", VOLT: "https://warplets.10x.meme/936.png" };

function highResolutionStonkletImage(src: string): string {
  return src.replace(/^(https:\/\/warplets\.10x\.meme\/\d+)\.jpg(?=($|[?#]))/i, "$1.png");
}

function IdentityImage({ src, label, kind, pairedStockLogo }: { src: string; label: string; kind: MarketSide; pairedStockLogo?: string | undefined }) {
  const [failed, setFailed] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src);
  useEffect(() => {
    setActiveSrc(src);
    setFailed(false);
  }, [src]);
  return (
    <span className={`stonklets-identity-image stonklets-identity-image--${kind}`} aria-hidden="true">
      {!failed && <img src={activeSrc} alt="" loading="lazy" decoding="async" onError={() => { const fallback = kind === "stonklet" ? CHARACTER_FALLBACKS[label] : null; if (fallback && activeSrc !== fallback) setActiveSrc(fallback); else setFailed(true); }} />}
      {failed && <span>{label.slice(0, 2).toUpperCase()}</span>}
      {kind === "stonklet" && pairedStockLogo && <span className="stonklets-paired-stock-logo"><img src={pairedStockLogo} alt="" loading="lazy" decoding="async" onError={(event) => { if (event.currentTarget.parentElement) event.currentTarget.parentElement.hidden = true; }} /></span>}
    </span>
  );
}

function Heart({ active, count, disabled, onClick, variant = "grid" }: { active: boolean; count: number; disabled?: boolean; onClick: () => void; variant?: "grid" | "chart" }) {
  return <button type="button" className={`stonklets-heart stonklets-heart--${variant}${active ? " is-active" : ""}`} disabled={disabled} onClick={onClick} aria-pressed={active} aria-label={`${active ? "Remove" : "Add"} favourite. ${count} votes`} title={active ? "Remove from favourites" : "Add to favourites"}><b>{favouriteCountText(count)}</b><SearchHeartIcon filled={active} className={variant === "chart" ? "h-[17px] w-[17px] translate-y-px" : "h-3.5 w-3.5"} strokeWidth={2.2} /></button>;
}

function DeferredChart({ pairId, asset, range, periodChange, fallbackImage, previewSource }: { pairId: string; asset: MarketSide; range: StonkletChangeRange; periodChange: number | null; fallbackImage: string; previewSource?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [endpointPrices, setEndpointPrices] = useState<{ start: number; end: number } | null>(null);
  const [chartChange, setChartChange] = useState<number | null>(null);
  const displayedChange = chartChange ?? periodChange;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setNear(true); observer.disconnect(); } }, { rootMargin: "300px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (!near || !host) return;
    let disposed = false;
    const controller = new AbortController();
    let cleanup = () => {};
    setStatus("loading");
    setEndpointPrices(null);
    setChartChange(null);
    Promise.all([
      import("lightweight-charts"),
      fetchStonkletChart(`/api/stonklets/chart?pair=${encodeURIComponent(pairId)}&asset=${asset}&range=${range}${previewSource ? `&flap=1&source=${encodeURIComponent(previewSource)}` : ""}`, controller.signal).then(async (response) => {
        if (!response.ok) throw new Error("Chart unavailable");
        return response.json() as Promise<{ points?: { time: number; value: number; price: number }[]; periodChange?: number | null }>;
      }),
    ]).then(([charts, payload]) => {
      if (disposed || !host) return;
      const points = Array.isArray(payload.points) ? payload.points : [];
      if (points.length < 2) { setStatus("empty"); return; }
      const loadedChange = payload.periodChange ?? periodChange;
      setChartChange(loadedChange);
      const chart = charts.createChart(host, {
        width: Math.max(1, Math.round(host.clientWidth)),
        height: Math.max(1, Math.round(host.clientHeight)),
        layout: { background: { color: "transparent" }, textColor: "#8bbf8b", attributionLogo: true },
        grid: { vertLines: { visible: false }, horzLines: { color: "rgba(0,255,0,.09)" } },
        rightPriceScale: { visible: false }, leftPriceScale: { visible: false },
        timeScale: { visible: false, borderVisible: false },
        crosshair: { vertLine: { labelVisible: false }, horzLine: { labelVisible: true } },
      });
      const line = chart.addSeries(charts.LineSeries, {
        color: (loadedChange ?? 0) >= 0 ? "#00ff66" : "#ff496c",
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: "custom", formatter: (value: number) => `${value.toFixed(2)}%` },
      });
      line.setData(points.map((point) => ({ time: point.time as never, value: point.value })));
      const firstPoint = points[0]!;
      const lastPoint = points.at(-1)!;
      setEndpointPrices({ start: firstPoint.price, end: lastPoint.price });
      line.createPriceLine({ price: 0, color: "rgba(255,255,255,.35)", lineWidth: 1, lineStyle: charts.LineStyle.Dashed, axisLabelVisible: false, title: "0%" });
      const priceByTime = new Map(points.map((point) => [point.time, point.price]));
      const tooltip = document.createElement("div");
      tooltip.className = "stonklets-chart-tooltip";
      tooltip.hidden = true;
      host.appendChild(tooltip);
      chart.subscribeCrosshairMove((event) => {
        const timestamp = typeof event.time === "number" ? event.time : null;
        const price = timestamp == null ? null : priceByTime.get(timestamp);
        tooltip.hidden = price == null || !event.point;
        if (price == null || !event.point) return;
        tooltip.textContent = priceText(price);
        tooltip.style.left = `${Math.max(4, Math.min(event.point.x + 8, host.clientWidth - 82))}px`;
        tooltip.style.top = `${Math.max(24, event.point.y - 22)}px`;
      });
      chart.timeScale().fitContent();
      let resizeFrame = 0;
      const resizeObserver = new ResizeObserver(([entry]) => {
        if (!entry || disposed) return;
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        if (width < 1 || height < 1) return;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          if (disposed) return;
          chart.resize(width, height, true);
          chart.timeScale().fitContent();
        });
      });
      resizeObserver.observe(host);
      cleanup = () => {
        resizeObserver.disconnect();
        cancelAnimationFrame(resizeFrame);
        tooltip.remove();
        chart.remove();
      };
      setStatus("ready");
    }).catch(() => { if (!disposed) { setEndpointPrices(null); setStatus("error"); } });
    return () => { disposed = true; controller.abort(); cleanup(); };
  }, [asset, near, pairId, periodChange, range, previewSource]);
  const rangeLabel = STONKLET_CHANGE_RANGE_LABELS[range];
  return <div className="stonklets-chart" role="img" aria-label={status === "ready" ? `Normalized ${rangeLabel} percentage chart. Start price ${endpointPrices ? priceText(endpointPrices.start) : "unavailable"}. End price ${endpointPrices ? priceText(endpointPrices.end) : "unavailable"}. Change ${changeText(displayedChange)}` : status === "idle" || status === "loading" ? `Loading ${rangeLabel} market chart` : "Stonklet artwork shown while market chart data is unavailable"}>
    <div ref={hostRef} className="stonklets-chart-canvas" />
    {(status === "idle" || status === "loading") && <div className="stonklets-chart-loading" role="status" aria-label={`Loading ${rangeLabel} market chart`}><span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" /></div>}
    {(status === "empty" || status === "error") && <img className="stonklets-chart-fallback" src={fallbackImage} alt="" loading="lazy" decoding="async" />}
    {status === "ready" && displayedChange != null && <strong className={displayedChange >= 0 ? "is-positive" : "is-negative"}>{changeText(displayedChange)}</strong>}
    {status === "ready" && endpointPrices && <div className={`stonklets-chart-price-range ${(displayedChange ?? 0) >= 0 ? "is-positive-range" : "is-negative-range"}`} aria-hidden="true"><span>{priceText(endpointPrices.start)}</span><b>➜</b><span>{priceText(endpointPrices.end)}</span></div>}
  </div>;
}

function AssetCard({ entry, asset, range, favourite, busy, onFavourite }: { entry: MarketEntry; asset: MarketSide; range: StonkletChangeRange; favourite: boolean; busy: boolean; onFavourite: () => void }) {
  const identity = asset === "stock" ? entry.stock : entry.stonklet;
  const metrics = asset === "stock" ? entry.stockMetrics : entry.stonkletMetrics;
  const periodChange = asset === "stock" ? entry.stockPeriodChange : entry.stonkletPeriodChange;
  const favouriteCount = asset === "stock" ? entry.stockFavourites : entry.favourites;
  const voting = asset === "stonklet" && entry.launchStatus !== "launched";
  const ctaLabel = voting ? `Vote for $${entry.stonklet.symbol}/${entry.stock.symbol}` : `Trade $${identity.symbol}`;
  const tradeUrl = stonkletTradeUrl(entry, asset);
  return <article className="stonklets-asset-card">
    <div className="stonklets-card-header"><div className="stonklets-card-identity"><IdentityImage key={`${entry.id}:${asset}`} src={asset === "stock" ? entry.stock.logo : entry.stonklet.image} label={identity.symbol} kind={asset} pairedStockLogo={asset === "stonklet" ? entry.stock.logo : undefined} /><div><b>{identity.symbol}</b><span>{identity.name}</span></div></div><Heart active={favourite} count={favouriteCount} disabled={busy} onClick={onFavourite} variant="chart" /></div>
    {asset === "stonklet" && entry.launchStatus !== "launched"
      ? <div className="stonklets-chart" role="img" aria-label={`${entry.stonklet.name} artwork shown until launch`}><img className="stonklets-chart-fallback" src={highResolutionStonkletImage(entry.stonklet.image)} alt="" loading="lazy" decoding="async" /></div>
      : <DeferredChart pairId={entry.id} asset={asset} range={range} periodChange={periodChange} fallbackImage={highResolutionStonkletImage(entry.stonklet.image)} previewSource={asset === "stonklet" && entry.flapPreview ? entry.demoToken?.contractAddress : undefined} />}
    {asset === "stonklet" && entry.launchStatus !== "launched"
      ? <StonkletLaunchVotes id={entry.id} name={entry.stonklet.name} count={entry.favourites} />
      : <div className="stonklets-card-metrics"><span><small>MCap</small>{compactNumber(metrics.marketCap, true)}</span><span><small>24h Vol</small>{compactNumber(metrics.volume24h, true)}</span><span><small>Holders</small>{compactNumber(metrics.holders)}</span></div>}
    {voting ? <button type="button" className="stonklets-trade stonklets-chart-cta" disabled={busy} onClick={onFavourite}>{ctaLabel}</button>
      : tradeUrl ? <a className="stonklets-trade stonklets-chart-cta" href={tradeUrl} target="_blank" rel="noopener noreferrer">{ctaLabel}</a>
      : <button type="button" className="stonklets-trade stonklets-chart-cta" disabled>{ctaLabel}</button>}
  </article>;
}

function CompactRow({ entry, asset, range, favourite, busy, onFavourite }: { entry: MarketEntry; asset: MarketSide; range: StonkletChangeRange; favourite: boolean; busy: boolean; onFavourite: () => void }) {
  const identity = asset === "stock" ? entry.stock : entry.stonklet;
  const metrics = asset === "stock" ? entry.stockMetrics : entry.stonkletMetrics;
  const periodChange = asset === "stock" ? entry.stockPeriodChange : entry.stonkletPeriodChange;
  const unlaunchedStonklet = asset === "stonklet" && entry.launchStatus !== "launched";
  const ctaLabel = unlaunchedStonklet ? `Vote for $${entry.stonklet.symbol}/${entry.stock.symbol}` : `Trade $${identity.symbol}`;
  const tradeUrl = stonkletTradeUrl(entry, asset);
  return <div className={`stonklets-compact-row stonklets-compact-row--${asset}`}>
    <div className="stonklets-compact-identity"><IdentityImage key={`${entry.id}:${asset}`} src={asset === "stock" ? entry.stock.logo : entry.stonklet.image} label={identity.symbol} kind={asset} pairedStockLogo={asset === "stonklet" ? entry.stock.logo : undefined} /><span><b>{identity.symbol}</b><small>{identity.name}</small></span></div>
    {unlaunchedStonklet
      ? <StonkletLaunchVotes id={entry.id} name={entry.stonklet.name} count={entry.favourites} compact />
      : <><span data-label="MCap">{compactNumber(metrics.marketCap, true)}</span><span data-label="24h Vol">{compactNumber(metrics.volume24h, true)}</span><span data-label="Holders">{compactNumber(metrics.holders)}</span><span data-label={STONKLET_CHANGE_RANGE_LABELS[range]} className={periodChange == null ? "" : periodChange >= 0 ? "is-positive" : "is-negative"}>{changeText(periodChange)}</span></>}
    <Heart active={favourite} count={asset === "stock" ? entry.stockFavourites : entry.favourites} disabled={busy} onClick={onFavourite} />
    {unlaunchedStonklet ? <button type="button" className="stonklets-trade stonklets-grid-cta" disabled={busy} onClick={onFavourite} title={ctaLabel} aria-label={ctaLabel}>Vote</button>
      : tradeUrl ? <a className="stonklets-trade stonklets-grid-cta" href={tradeUrl} target="_blank" rel="noopener noreferrer" title={ctaLabel} aria-label={ctaLabel}>Trade</a>
      : <button type="button" className="stonklets-trade stonklets-grid-cta" disabled title={ctaLabel} aria-label={ctaLabel}>Trade</button>}
  </div>;
}

function Placeholder({ page, pair, asset }: { page: Exclude<Page, "market">; pair: MarketEntry | undefined; asset?: MarketSide }) {
  const labels = { trade: "Trade", portfolio: "Portfolio", leaderboard: "Leaderboard", stats: "Stats" };
  return <section className="stonklets-placeholder"><span className="stonklets-kicker">10X STONKLETS</span><h1>{labels[page]}</h1>{page === "trade" && pair ? <><p><b>{pair.stock.symbol}</b> × <b>${pair.stonklet.symbol}</b></p><p>Selected asset: <b>{asset === "stonklet" ? `$${pair.stonklet.symbol}` : pair.stock.symbol}</b></p>{asset === "stonklet" && pair.demoToken ? <div className="stonklets-demo-trade"><b>Live market-data demo</b><p>{pair.stonklet.name} is previewing {pair.demoToken.name} ({pair.demoToken.symbol}), a third-party Flap token. This is not the official 10X contract and trading is not enabled here.</p><a href={pair.demoToken.flapUrl} target="_blank" rel="noreferrer">Inspect source token on Flap ↗</a></div> : <p>{pair.stonklet.name} has not launched yet. Favourite it on Market to vote and opt into launch alerts.</p>}</> : <p>This part of the Stonklets market is coming soon.</p>}</section>;
}

export default function StonkletsApp() {
  const chrome = useMiniAppChrome(STONKLETS_APP_SLUG);
  const miniAppInitializationStartedRef = useRef(false);
  const miniAppReadySentRef = useRef(false);
  const [page, setPage] = useState<Page>(currentPage);
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const flapPreview = isStonkletsFlapPreview(new URL(window.location.href));
  const votesPreview = isStonkletsVotesPreview(new URL(window.location.href));
  const forceBstocksNotice = isBstocksNoticeForced(initial.toString());
  const [bstocksNoticeOpen, setBstocksNoticeOpen] = useState(
    () => forceBstocksNotice || !hasAcceptedBstocksNotice(window.localStorage),
  );
  const [search, setSearch] = useState(initial.get("q") ?? "");
  const [market, setMarket] = useState<MarketSide>(safeParam<MarketSide>(initial.get("market"), ["stock", "stonklet"], "stock"));
  const [order, setOrder] = useState<OrderKey>(safeParam(initial.get("order"), ORDER_OPTIONS.map((option) => option.key), "trending"));
  const [direction, setDirection] = useState<Direction>(safeParam<Direction>(initial.get("dir"), ["asc", "desc"], initial.get("order") === "az" ? "asc" : "desc"));
  const [changeRange, setChangeRange] = useState<StonkletChangeRange>(() => parseStonkletChangeRange(initial.get("change")) ?? DEFAULT_STONKLET_CHANGE_RANGE);
  const [layout, setLayout] = useState<Layout>(() => safeParam(initial.get("layout"), ["compact", "chart", "single-chart", "single-grid"], safeParam(localStorage.getItem("stonklets-layout"), ["compact", "chart", "single-chart", "single-grid"], "compact")));
  const [favouritesOnly, setFavouritesOnly] = useState(initial.get("favourites") === "1");
  const [rawEntries, setEntries] = useState<MarketEntry[]>(defaultEntries);
  const [loading, setLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const entries = useMemo(() => votesPreview ? rawEntries.map((entry) => ({ ...entry, launchStatus: STONKLET_TRADE_DESTINATIONS[entry.id] ? "launched" as const : "prelaunch" as const, favourites: mockVoteCount(entry.id) + (favourites.has(entry.id) ? 1 : 0) })) : rawEntries, [rawEntries, votesPreview, favourites]);
  const [stockFavourites, setStockFavourites] = useState<Set<string>>(new Set());
  const [favouriteIdentityReady, setFavouriteIdentityReady] = useState(false);
  const [favouriteFilterLoading, setFavouriteFilterLoading] = useState(false);
  const favouriteRequestVersion = useRef(0);
  const [session, setSession] = useState<AppSessionState | null>(null);
  const [isInMiniAppContext, setIsInMiniAppContext] = useState(false);
  const [miniAppProfile, setMiniAppProfile] = useState<AppSessionState["farcasterProfile"]>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [busyFavourite, setBusyFavourite] = useState<string | null>(null);
  const [toast, setToast] = useState<StonkletsToastMessage | null>(null);
  const showToast = (message: string, kind: StonkletsToastMessage["kind"] = "success") => setToast({ message, kind });
  const closeToast = useCallback(() => setToast(null), []);
  const [launchPrompt, setLaunchPrompt] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [headerAccountAnchor, setHeaderAccountAnchor] = useState<"title" | "avatar" | null>(null);
  const [marketLoadingMessage, setMarketLoadingMessage] = useState(MARKET_LOADING_PREFIX);

  const refreshSession = useCallback(() => loadAppSession().then(setSession).catch(() => setSession(null)), []);
  const loadFavourites = useCallback(async () => {
    if (votesPreview) return;
    const version = ++favouriteRequestVersion.current;
    const response = await fetch("/api/stonklet-favourites", { credentials: "same-origin" });
    if (!response.ok) return;
    const payload = await response.json() as { authenticated?: boolean; ids?: string[]; stockIds?: string[]; counts?: Record<string, { total?: number; momentum7d?: number }>; stockCounts?: Record<string, { total?: number; momentum7d?: number }> };
    if (version !== favouriteRequestVersion.current) return payload;
    setFavouriteIdentityReady(payload.authenticated === true);
    setFavourites(new Set(Array.isArray(payload.ids) ? payload.ids : []));
    setStockFavourites(new Set(Array.isArray(payload.stockIds) ? payload.stockIds : []));
    if (payload.counts || payload.stockCounts) setEntries((current) => current.map((entry) => ({
      ...entry,
      favourites: payload.counts?.[entry.id]?.total ?? entry.favourites,
      momentum7d: payload.counts?.[entry.id]?.momentum7d ?? entry.momentum7d,
      stockFavourites: payload.stockCounts?.[entry.id]?.total ?? entry.stockFavourites,
      stockMomentum7d: payload.stockCounts?.[entry.id]?.momentum7d ?? entry.stockMomentum7d,
    })));
    return payload;
  }, [votesPreview]);

  useEffect(() => {
    if (miniAppInitializationStartedRef.current) return;
    miniAppInitializationStartedRef.current = true;

    const initializeMiniAppSurface = async () => {
      try {
        const inMiniApp = await detectMiniAppContext(
          typeof sdk.isInMiniApp === "function" ? () => sdk.isInMiniApp() : undefined,
        );
        setIsInMiniAppContext(inMiniApp);
        configureAppSurface(resolveAppSurface(inMiniApp));
        configureFarcasterWallet(inMiniApp
          ? async () => {
              const provider = await getEmbeddedWalletProvider();
              if (!provider) throw new Error("Farcaster wallet is unavailable");
              return provider;
            }
          : null);

        if (!inMiniApp) return;

        if (!miniAppReadySentRef.current) {
          miniAppReadySentRef.current = true;
          try {
            await signalAppReady();
          } catch (error) {
            miniAppReadySentRef.current = false;
            console.warn("Stonklets mini app ready failed:", error);
          }
        }

        // Match Warplets: display the host's user immediately, even if session
        // verification is slow or temporarily unavailable. This is display data only.
        const hostContext = await sdk.context;
        setNotificationsEnabled(Boolean(hostContext.client.notificationDetails));
        const user = hostContext.user as unknown as Record<string, unknown>;
        const profileText = (...values: unknown[]) => values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? null;
        const fid = Number(user?.fid);
        const contextProfile: AppSessionState["farcasterProfile"] = Number.isInteger(fid) && fid > 0 ? {
          fid,
          username: profileText(user?.username),
          displayName: profileText(user?.displayName, user?.display_name),
          pfpUrl: profileText(user?.pfpUrl, user?.pfp_url, user?.pfp),
        } : null;
        setMiniAppProfile(contextProfile);

        const verified = await authenticateStonkletsFarcaster();
        setSession(verified);
        const verifiedFid = Number(verified.farcasterFid);
        if (Number.isInteger(verifiedFid) && verifiedFid > 0) {
          const fallback = contextProfile?.fid === verifiedFid ? contextProfile : null;
          setMiniAppProfile({
            fid: verifiedFid,
            username: profileText(verified.farcasterProfile?.username, fallback?.username),
            displayName: profileText(verified.farcasterProfile?.displayName, fallback?.displayName),
            pfpUrl: profileText(verified.farcasterProfile?.pfpUrl, fallback?.pfpUrl),
          });
        }
        await Promise.all([
          restoreFarcasterWallet(),
          loadFavourites(),
        ]);
      } catch (error) {
        console.warn("Stonklets mini app authentication failed:", error);
      }
    };

    void initializeMiniAppSurface();
  }, [loadFavourites, refreshSession]);

  useEffect(() => { void refreshSession(); void loadFavourites(); }, [loadFavourites, refreshSession]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/stonklets/market?range=${changeRange}${flapPreview ? "&flap=1" : ""}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Market data is unavailable");
      return response.json() as Promise<{ entries?: MarketEntry[]; stale?: boolean }>;
    }).then((payload) => { if (Array.isArray(payload.entries)) { setEntries(payload.entries); setStale(payload.stale === true); setMarketError(null); } }).catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setMarketError(error instanceof Error ? error.message : "Market data is unavailable"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [changeRange, flapPreview]);
  useEffect(() => {
    const onPop = () => setPage(currentPage());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!loading) {
      setMarketLoadingMessage(MARKET_LOADING_PREFIX);
      return;
    }
    const startedAt = Date.now();
    setMarketLoadingMessage(getMarketLoadingMessage(0));
    const interval = window.setInterval(() => setMarketLoadingMessage(getMarketLoadingMessage(Date.now() - startedAt)), 50);
    return () => window.clearInterval(interval);
  }, [loading]);
  useEffect(() => {
    if (page !== "market") return;
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (market !== "stock") params.set("market", market);
    if (order !== "trending") params.set("order", order);
    if (direction !== (order === "az" ? "asc" : "desc")) params.set("dir", direction);
    if (changeRange !== DEFAULT_STONKLET_CHANGE_RANGE) params.set("change", changeRange);
    if (layout !== "compact") params.set("layout", layout);
    if (favouritesOnly) params.set("favourites", "1");
    if (forceBstocksNotice) params.set("bstocksNotice", "1");
    if (flapPreview) params.set("flap", "1");
    if (votesPreview) params.set("votes", "1");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${basePath() || "/"}${query ? `?${query}` : ""}`);
  }, [changeRange, direction, favouritesOnly, forceBstocksNotice, flapPreview, votesPreview, layout, market, order, page, search]);

  const orderAvailable = useCallback((key: OrderKey) => key === "trending" || key === "favourites" || key === "az" || entries.some((entry) => stonkletMetric(entry, market, key) != null), [entries, market]);
  useEffect(() => { if (!orderAvailable(order)) { setOrder("trending"); setDirection("desc"); } }, [order, orderAvailable]);
  const selectedMarketFavourites = useMemo(() => visibleStonkletsFavourites(stockFavourites, favourites, market, isSingleLayout(layout)), [stockFavourites, favourites, market, layout]);
  const filtered = useMemo(() => filterAndSortStonklets({ entries, query: search, favourites: selectedMarketFavourites, favouritesOnly, market, order, direction }), [direction, entries, favouritesOnly, market, order, search, selectedMarketFavourites]);

  const goPage = (next: Page, pair?: MarketEntry, asset?: MarketSide) => {
    const path = next === "market" ? (basePath() || "/") : `${basePath()}/${next}`;
    const params = new URLSearchParams();
    if (pair) params.set("pair", pair.id);
    if (asset) params.set("asset", asset);
    if (flapPreview) params.set("flap", "1");
    if (votesPreview) params.set("votes", "1");
    window.history.pushState(window.history.state, "", `${path}${params.size ? `?${params}` : ""}`);
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleFavourite = async (entry: MarketEntry, asset: MarketSide) => {
    if (votesPreview) {
      const update = asset === "stock" ? setStockFavourites : setFavourites;
      update((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; });
      return;
    }
    if (!isInMiniAppContext && (!session?.authenticated || !favouriteIdentityReady)) { setConnectOpen(true); return; }
    let next = !(asset === "stock" ? stockFavourites : favourites).has(entry.id);
    const busyKey = `${entry.id}:${asset}`;
    setBusyFavourite(busyKey);
    try {
      if (isInMiniAppContext && (!session?.farcasterFid || !favouriteIdentityReady)) {
        setSession(await authenticateStonkletsFarcaster());
        const current = await loadFavourites();
        if (!current?.authenticated) throw new Error("Couldn't load your Farcaster favourites. Please try again.");
        next = !(asset === "stock" ? current.stockIds : current.ids)?.includes(entry.id);
      }
      const save = () => fetch("/api/stonklet-favourites", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ stonkletId: entry.id, asset, favourited: next, notifyOnLaunch: asset === "stonklet" && next }) });
      let response = await save();
      if (response.status === 401 && isInMiniAppContext) {
        setSession(await authenticateStonkletsFarcaster());
        response = await save();
      }
      const payload = await response.json() as { error?: string; ids?: string[]; stockIds?: string[]; counts?: Record<string, { total?: number; momentum7d?: number }>; stockCounts?: Record<string, { total?: number; momentum7d?: number }> };
      if (!response.ok) throw new Error(payload.error ?? "Favourite could not be saved");
      ++favouriteRequestVersion.current;
      setFavourites(new Set(payload.ids ?? []));
      setStockFavourites(new Set(payload.stockIds ?? []));
      setEntries((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        favourites: payload.counts?.[item.id]?.total ?? item.favourites,
        momentum7d: payload.counts?.[item.id]?.momentum7d ?? item.momentum7d,
        stockFavourites: payload.stockCounts?.[item.id]?.total ?? item.stockFavourites,
        stockMomentum7d: payload.stockCounts?.[item.id]?.momentum7d ?? item.stockMomentum7d,
      } : item));
      const identity = asset === "stock" ? entry.stock : entry.stonklet;
      showToast(asset === "stonklet"
        ? next ? `♥ ${identity.name} vote saved. Launch alerts are on.` : `${identity.name} removed from favourites.`
        : next ? `♥ ${identity.name} added to favourites.` : `${identity.name} removed from favourites.`);
      if (asset === "stonklet" && next && !notificationsEnabled && (isInMiniAppContext || typeof Notification === "undefined" || Notification.permission !== "granted")) setLaunchPrompt(true);
    } catch (error) { showToast(error instanceof Error ? error.message : "Favourite could not be saved", "error"); }
    finally { setBusyFavourite(null); }
  };
  const applyFavouriteFilter = async (enabled: boolean) => {
    if (!enabled || votesPreview) { setFavouritesOnly(enabled); return; }
    if (favouriteFilterLoading) return;
    setFavouriteFilterLoading(true);
    try {
      if (isInMiniAppContext && (!session?.farcasterFid || !favouriteIdentityReady)) {
        setSession(await authenticateStonkletsFarcaster());
      }
      let current = await loadFavourites();
      if (!current?.authenticated && isInMiniAppContext) {
        setSession(await authenticateStonkletsFarcaster());
        current = await loadFavourites();
      }
      if (!current) throw new Error("Couldn't load your favourites. Please try again.");
      if (!current.authenticated) {
        if (isInMiniAppContext) throw new Error("Couldn't load your Farcaster favourites. Please try again.");
        setConnectOpen(true);
        return;
      }
      setFavouritesOnly(true);
    } catch (error) { showToast(error instanceof Error ? error.message : "Couldn't load your favourites.", "error"); }
    finally { setFavouriteFilterLoading(false); }
  };
  const selectedPair = entries.find((entry) => entry.id === new URLSearchParams(window.location.search).get("pair"));
  const selectedAsset = safeParam<MarketSide>(new URLSearchParams(window.location.search).get("asset"), ["stock", "stonklet"], "stock");
  const launchedEntries = filtered.filter((entry) => entry.launchStatus === "launched");
  const votingEntries = filtered.filter((entry) => entry.launchStatus !== "launched" && entry.pairingStatus === "available");
  const upcomingEntries = filtered.filter((entry) => entry.launchStatus !== "launched" && entry.pairingStatus === "upcoming");
  const selectOrder = (next: OrderKey) => {
    if (next === order) setDirection((value) => value === "asc" ? "desc" : "asc");
    else { setOrder(next); setDirection(next === "az" ? "asc" : "desc"); }
  };
  const renderPairs = (items: MarketEntry[]) => items.map((entry) => {
    const first: MarketSide = market;
    const second: MarketSide = market === "stock" ? "stonklet" : "stock";
    const assets = isSingleLayout(layout) ? [first] : [first, second];
    const isFavourite = (asset: MarketSide) => (asset === "stock" ? stockFavourites : favourites).has(entry.id);
    const isBusy = (asset: MarketSide) => busyFavourite === `${entry.id}:${asset}`;
    return <article className={`stonklets-pair${layout === "single-grid" ? " stonklets-pair--single-grid" : ""}${layout === "single-chart" ? " stonklets-pair--single-chart" : ""}`} key={entry.id}>
      {isGridLayout(layout)
        ? assets.map((asset) => <CompactRow key={asset} entry={entry} asset={asset} range={changeRange} favourite={isFavourite(asset)} busy={isBusy(asset)} onFavourite={() => void toggleFavourite(entry, asset)} />)
        : <div className={`stonklets-chart-pair${layout === "single-chart" ? " stonklets-chart-pair--single" : ""}`}>{assets.map((asset) => <AssetCard key={asset} entry={entry} asset={asset} range={changeRange} favourite={isFavourite(asset)} busy={isBusy(asset)} onFavourite={() => void toggleFavourite(entry, asset)} />)}</div>}
    </article>;
  });
  const renderGroup = (name: "Launched" | "Voting" | "Upcoming", items: MarketEntry[]) => <section className="stonklets-market-group" aria-labelledby={`stonklets-group-${name.toLowerCase()}`}>
    <h2 id={`stonklets-group-${name.toLowerCase()}`} className="stonklets-group-heading">{name}<span>{items.length}</span></h2>
    {name === "Upcoming" && <button type="button" className="stonklets-upcoming-toggle" onClick={() => setShowUpcoming((value) => !value)} aria-expanded={showUpcoming}>{showUpcoming ? "Hide Upcoming Tokens" : "Show Upcoming Tokens"}</button>}
    {(name !== "Upcoming" || showUpcoming) && <>
    {items.length > 0 ? <div className={`stonklets-results${name === "Upcoming" ? " stonklets-results--upcoming" : ""}${isGridLayout(layout) ? " stonklets-results--grid" : ""}${layout === "single-grid" ? " stonklets-results--single-grid" : ""}`}>
      {isGridLayout(layout) && <div className="stonklets-compact-head"><span aria-hidden="true" /><span>MCap</span><span>24h Vol</span><span>Hold</span><span>{STONKLET_CHANGE_RANGE_LABELS[changeRange].toUpperCase()}</span></div>}
      {renderPairs(items)}
    </div> : !loading && <p className="stonklets-group-empty">{search || favouritesOnly ? "No matching tokens." : name === "Launched" ? "No Stonklets launched yet." : name === "Voting" ? "No Stonklets awaiting votes." : "No upcoming tokens."}</p>}
    </>}
  </section>;
  const header = <MiniAppHeader
    appSlug={STONKLETS_APP_SLUG}
    title="10X Stonklets"
    canGoBack={chrome.canGoBack}
    onBack={chrome.actions.goBack}
    onLogo={() => void chrome.actions.openHubRoot()}
    onMenu={chrome.actions.openMenu}
    onTitleMenu={() => setHeaderAccountAnchor((current) => current === "title" ? null : "title")}
    rightAccessory={<StonkletsHeaderAccount
      session={session}
      miniAppProfile={miniAppProfile}
      simplifiedFarcaster={isInMiniAppContext}
      open={headerAccountAnchor !== null}
      centered={headerAccountAnchor === "title"}
      onOpenChange={(open) => setHeaderAccountAnchor(open ? "avatar" : null)}
      onConnect={() => setConnectOpen(true)}
      onShowFavourites={() => { goPage("market"); void applyFavouriteFilter(true); }}
      onEnableNotifications={() => setLaunchPrompt(true)}
      onDisconnect={() => void logoutAppPrincipal("all").then(() => { setSession(null); setFavouriteIdentityReady(false); setFavourites(new Set()); setStockFavourites(new Set()); })}
    />}
  />;

  return <MiniAppShell>{bstocksNoticeOpen
    ? <BstocksNoticeModal onAccept={() => setBstocksNoticeOpen(false)} />
    : <>{header}{chrome.isMenuRoute ? <MiniAppMenuPage appSlug={STONKLETS_APP_SLUG} /> : <>
    <main className="stonklets-main">
      {flapPreview && <p className="stonklets-state" role="status">Local Flap preview · Stonklets use third-party live token data. <a href={basePath() || "/"}>Exit preview</a></p>}
      {votesPreview && <p className="stonklets-state" role="status">Local vote preview · Mock votes with sample Farcaster profile images.</p>}
      {/* Page navigation is temporarily hidden while Market is the primary page. */}
      {page !== "market" ? <Placeholder page={page} pair={selectedPair} asset={selectedAsset} /> : <div className="stonklets-market-page">
        <header className="stonklets-market-heading">
          <h1>GEN Z'S STONK MARKET</h1>
          <p className="stonklets-market-tagline"><strong>Reset the market. Be early. Win.</strong></p>
        </header>
        <section className="stonklets-search-row">
          <div className="relative flex min-w-0 flex-1">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#00FF00]"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg></span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, symbol, or CA" className="min-w-0 flex-1 rounded-xl border border-[#00FF00] bg-black/70 py-3 pl-10 pr-28 text-base text-[#00FF00] outline-none transition-[border-color,box-shadow] placeholder:text-[#8bbf8b] focus:border-[#00FF00] focus:shadow-[0_0_10px_rgba(0,255,0,0.22)]" />
            <div className="absolute bottom-1 right-1 top-1 flex items-center gap-1">
              {search && <button type="button" onClick={() => setSearch("")} className="flex h-full cursor-pointer items-center px-2 text-xs font-bold text-[#00FF00] hover:text-[#8bbf8b]">Reset</button>}
              <button type="button" aria-label={favouriteFilterLoading ? "Loading your favourites" : favouritesOnly ? "Remove favourite filter" : "Filter by my favourites"} title={favouritesOnly ? "Remove favourite filter" : "Filter by my favourites"} onClick={() => void applyFavouriteFilter(!favouritesOnly)} disabled={favouriteFilterLoading} aria-busy={favouriteFilterLoading} className="group/fav -ml-0.5 mr-1.5 inline-flex h-full w-9 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-[#00FF00] transition-colors hover:text-[#8bbf8b] disabled:animate-pulse" aria-pressed={favouritesOnly}><SearchHeartIcon filled={favouritesOnly} /></button>
            </div>
          </div>
        </section>
        <section className="stonklets-controls" aria-label="Market controls">
          <StonkletsDropdown label="Market" valueLabel={market === "stock" ? "Stocks" : "Stonklets"}>
            {(["stock", "stonklet"] as const).map((value) => { const active = market === value; return <button type="button" role="option" aria-selected={active} key={value} onClick={() => setMarket(value)} className={`stonklets-dropdown-option flex w-full cursor-pointer items-center rounded-lg border px-2 py-2 text-left text-xs ${active ? "is-active font-bold" : ""}`}><span>{value === "stock" ? "Stocks" : "Stonklets"}</span></button>; })}
          </StonkletsDropdown>
          <StonkletsDropdown label="Order" valueLabel={<span className="inline-flex min-w-0 items-center gap-1"><span className="truncate">{ORDER_OPTIONS.find((option) => option.key === order)?.label}</span><OrderDirectionIcon direction={direction} /></span>}>
            {ORDER_OPTIONS.map((option) => { const enabled = orderAvailable(option.key); const active = option.key === order; return <button type="button" role="option" aria-selected={active} key={option.key} disabled={!enabled} onClick={() => selectOrder(option.key)} className={`stonklets-dropdown-option flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left text-xs ${active ? "is-active font-bold" : ""} ${enabled ? "cursor-pointer" : "cursor-not-allowed opacity-35"}`}><span>{option.label}</span>{active && <OrderDirectionIcon direction={direction} />}</button>; })}
          </StonkletsDropdown>
          <StonkletsDropdown label="Change" valueLabel={STONKLET_CHANGE_RANGE_LABELS[changeRange]}>
            {STONKLET_CHANGE_RANGES.map((value) => { const active = changeRange === value; return <button type="button" role="option" aria-selected={active} key={value} onClick={() => setChangeRange(value)} className={`stonklets-dropdown-option flex w-full cursor-pointer items-center rounded-lg border px-2 py-2 text-left text-xs ${active ? "is-active font-bold" : ""}`}><span>{STONKLET_CHANGE_RANGE_LABELS[value]}</span></button>; })}
          </StonkletsDropdown>
          <StonkletsLayoutSwitcher layout={layout} onSelect={(next) => { setLayout(next); localStorage.setItem("stonklets-layout", next); }} />
        </section>
        {stale && <p className="stonklets-state">Market data is delayed; last-known values are shown.</p>}
        {marketError && <p className="stonklets-state is-error">{marketError}. Catalog and voting remain available.</p>}
        {loading && <p className="stonklets-loading" aria-live="polite">{marketLoadingMessage}</p>}
        {renderGroup("Launched", launchedEntries)}
        {renderGroup("Voting", votingEntries)}
        {renderGroup("Upcoming", upcomingEntries)}
        {!filtered.length && <p className="stonklets-empty-status">{favouritesOnly ? "No favourites found." : "No pairings found."}{search && <> <button type="button" onClick={() => setSearch("")}>Reset search</button>.</>}</p>}
        {!showUpcoming && launchedEntries.length === 0 && votingEntries.length === 0 && upcomingEntries.length > 0 && <p className="stonklets-empty-status">Matching results are in Upcoming Tokens.</p>}
        <aside className="stonklets-risk"><b>Know what you’re pairing.</b> bStocks provide tokenized economic exposure to real-world assets. Stonklets are separate meme tokens; their prices are not correlated with the referenced asset. Nothing here is investment advice.</aside>
      </div>}
    </main><SiteFooter legalSuffix={<a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="font-bold text-[#00FF00] underline decoration-[#00FF00] underline-offset-2 hover:text-[#8bff8b]">Charts by TradingView</a>} /></>}
    <WebConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} identityConnected={Boolean(session?.farcasterFid)} onWalletConnected={() => { void refreshSession(); void loadFavourites(); setConnectOpen(false); }} farcasterControl={<FarcasterSignInControl connected={Boolean(session?.farcasterFid)} onAuthenticated={() => { void refreshSession(); setConnectOpen(false); void loadFavourites(); }} />} />
    {launchPrompt && <StonkletsNotificationsPrompt inMiniApp={isInMiniAppContext} onClose={() => setLaunchPrompt(false)} onEnabled={() => setNotificationsEnabled(true)} onMessage={showToast} />}
    {toast && <StonkletsToast toast={toast} onClose={closeToast} />}</>}
  </MiniAppShell>;
}
