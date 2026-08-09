import { useEffect, useMemo, useState } from "react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { hapticSelectionChanged, hapticTap } from "./haptics";
import {
  PERKS_DEFINITIONS,
  PERKS_MOCK_DATA_VERSION,
  PERKS_MOCKUP_NOTICE_DISMISSED_KEY,
  type PerksDefinition,
  type PerksMetric,
  type PerksSubpage,
} from "./perksMockData";
import { PERKS_SHARE_CONTENT } from "./perksShareContent";

type PerksHolder = {
  rank: number | null;
  wallet: string;
  ownedCount: number;
  bestRarityRank: number | null;
  bestTokenId: number | null;
  originalFidTokenId?: number | null;
  username: string | null;
  displayName: string | null;
};

type PerksHolderEnvelope = {
  rows?: unknown[];
  row?: unknown;
  holder?: unknown;
};

type PerksViewerProfile = {
  username?: string | null;
  displayName?: string | null;
};

const FALLBACK_WARPLET_TOKEN_ID = 548;
const DEMO_HOLDER_SESSION_KEY = "warplets-perks-demo-holder-v1";
const MOCK_HOLDER_LIMIT = 100;
const PERK_IDS: PerksSubpage[] = ["memes", "nfts", "ai", "attention", "alpha"];

let holderRosterCache: PerksHolder[] | null = null;
let holderRosterRequest: Promise<PerksHolder[]> | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeHolder(value: unknown): PerksHolder | null {
  const row = asRecord(value);
  const wallet = asString(row?.wallet)?.toLowerCase() ?? null;
  if (!row || !wallet) return null;
  const profile = asRecord(row.profile);
  return {
    rank: asNumber(row.rank),
    wallet,
    ownedCount: Math.max(0, Math.round(asNumber(row.ownedCount ?? row.owned_count) ?? 0)),
    bestRarityRank: asNumber(row.bestRarityRank ?? row.best_rarity_rank),
    bestTokenId: asNumber(row.bestTokenId ?? row.best_token_id),
    originalFidTokenId: asNumber(row.originalFidTokenId ?? row.original_fid_token_id),
    username: asString(row.username ?? profile?.username),
    displayName: asString(row.displayName ?? row.display_name ?? profile?.displayName ?? profile?.display_name),
  };
}

async function loadHolderRoster(): Promise<PerksHolder[]> {
  if (holderRosterCache) return holderRosterCache;
  if (!holderRosterRequest) {
    holderRosterRequest = fetch(`/api/stats/holders?limit=${MOCK_HOLDER_LIMIT}`, {
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Holder examples failed (${response.status})`);
      const payload = await response.json() as PerksHolderEnvelope;
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const normalized = rows.map(normalizeHolder).filter((holder): holder is PerksHolder => Boolean(holder));
      holderRosterCache = normalized;
      return normalized;
    }).finally(() => {
      holderRosterRequest = null;
    });
  }
  return holderRosterRequest;
}

async function loadViewerHolder(wallet: string | null, fid: number | null): Promise<PerksHolder | null> {
  const params = new URLSearchParams();
  if (wallet) params.set("wallet", wallet);
  else if (fid) params.set("fid", String(fid));
  else return null;
  const response = await fetch(`/api/stats/holders/me?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Your holder example failed (${response.status})`);
  const payload = await response.json() as PerksHolderEnvelope;
  return normalizeHolder(payload.row ?? payload.holder);
}

function getWarpletPreviewImageUrl(tokenId: number): string {
  return `https://warplets.10x.meme/${tokenId}.jpg`;
}

function getWarpletVideoUrl(tokenId: number): string {
  return `https://warplets.10x.meme/${tokenId}.mp4`;
}

function shortWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

function holderLabel(holder: PerksHolder): string {
  return holder.username ? `@${holder.username.replace(/^@/, "")}` : shortWallet(holder.wallet);
}

function hashValue(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(perk: PerksSubpage, wallet: string, salt = "value"): number {
  return hashValue(`${PERKS_MOCK_DATA_VERSION}:${perk}:${wallet.toLowerCase()}:${salt}`) / 0xffffffff;
}

function holderBenefitFactor(perk: PerksSubpage, holder: PerksHolder): number {
  const ownedBoost = Math.log2(Math.max(1, holder.ownedCount + 1)) * 0.11;
  const rarityBoost = holder.bestRarityRank == null
    ? 0
    : Math.max(0, (10_001 - holder.bestRarityRank) / 10_000) * 0.22;
  return 0.72 + seededUnit(perk, holder.wallet, "benefit") * 1.38 + ownedBoost + rarityBoost;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  });
}

function formatAirdropDayValue(value: number): string {
  if (value < 1_000) return `$${Math.max(0, Math.floor(value)).toLocaleString("en-US")}`;
  return `$${Math.floor(value / 1_000).toLocaleString("en-US")}K`;
}

function formatExactAirdropValue(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function leaderboardScore(perk: PerksSubpage, holder: PerksHolder): number {
  const base = perk === "memes" ? 1_842
    : perk === "nfts" ? 152
      : perk === "ai" ? 228
        : perk === "attention" ? 9_420
          : 1_000;
  return base * holderBenefitFactor(perk, holder);
}

function formatLeaderboardScore(perk: PerksSubpage, score: number): string {
  if (perk === "memes" || perk === "nfts" || perk === "ai") return formatMoney(score);
  if (perk === "attention") return `${formatInteger(score)} views`;
  return `${formatInteger(score)} pts`;
}

function buildYouMetrics(perk: PerksSubpage, holder: PerksHolder): PerksMetric[] {
  const factor = holderBenefitFactor(perk, holder);
  if (perk === "memes") {
    const youFactor = Math.max(1.12, factor);
    return [
      { label: "Highest Level", value: `${Math.min(10, Math.max(3, Math.ceil(2 + youFactor)))}X` },
      { label: "Airdrop Boost", value: `${(4.5 + youFactor * 0.8).toFixed(1)}X` },
      { label: "Eligible Launches", value: formatInteger(46 * youFactor) },
      { label: "Airdrop Value Now", value: formatMoney(486 * youFactor) },
      { label: "Airdrop Value at ATH", value: formatMoney(1_842 * youFactor) },
      { label: "Best Airdrop Gain", value: `+${formatInteger(14_600 * youFactor)}%` },
    ];
  }
  if (perk === "nfts") {
    const youFactor = Math.max(1.12, factor);
    return [
      { label: "Season Mints", value: formatInteger(12 * youFactor) },
      { label: "Upgrades", value: formatInteger(5 * youFactor) },
      { label: "Mint Spend", value: formatMoney(12 * youFactor) },
      { label: "Whitelist Savings", value: formatMoney(108 * youFactor) },
      { label: "Combined ATH Floor", value: formatMoney(152 * youFactor) },
      { label: "Perk Months", value: formatInteger(32 * youFactor) },
    ];
  }
  if (perk === "ai") {
    const youFactor = Math.max(1.12, factor);
    const sponsored = 228 * youFactor;
    const used = 197 * youFactor;
    const remaining = sponsored - used;
    return [
      { label: "Sponsored AI", value: formatMoney(sponsored) },
      { label: "Credits Used", value: formatMoney(used) },
      { label: "Credits Remaining", value: formatMoney(remaining) },
      { label: "Model Tokens", value: `${(22.4 * youFactor).toFixed(1)}M` },
      { label: "Image / Video Jobs", value: Math.ceil(31 * youFactor).toLocaleString("en-US") },
      { label: "Projects Shipped", value: Math.ceil(youFactor).toLocaleString("en-US") },
    ];
  }
  if (perk === "attention") {
    const youFactor = Math.max(1.12, factor);
    const impressions = 9_420 * youFactor;
    return [
      { label: "Posts", value: Math.ceil(3 * youFactor).toLocaleString("en-US") },
      { label: "Impressions", value: formatInteger(impressions) },
      { label: "Engagement", value: formatInteger(680 * youFactor) },
      { label: "Engagement Rate", value: `${(7.2 + youFactor * 1.4).toFixed(1)}%` },
      { label: "Feed Rank", value: `#${formatInteger(500 / youFactor)}` },
      { label: "Daily Airdrop", value: formatMoney(3.64 * youFactor) },
    ];
  }
  const youFactor = Math.max(1.12, factor);
  return [
    { label: "Coins Reviewed", value: formatInteger(146 * youFactor) },
    { label: "Votes Cast", value: formatInteger(68 * youFactor) },
    { label: "Signals Backed", value: formatInteger(14 * youFactor) },
    { label: "PnL %", value: "+652%" },
    { label: "Community Score", value: formatInteger(1_000 * youFactor) },
    { label: "Voting Influence", value: "3.72X" },
  ];
}

function selectDemoHolder(roster: PerksHolder[], excludedWallets: Set<string>): PerksHolder | null {
  if (typeof window === "undefined") return null;
  const eligible = roster.filter((holder) =>
    (holder.rank ?? 101) >= 11 &&
    (holder.rank ?? 101) <= 100 &&
    !excludedWallets.has(holder.wallet));
  if (eligible.length === 0) return null;
  const storedWallet = window.sessionStorage.getItem(DEMO_HOLDER_SESSION_KEY)?.toLowerCase() ?? null;
  const stored = storedWallet ? eligible.find((holder) => holder.wallet === storedWallet) : null;
  if (stored) return stored;
  const random = new Uint32Array(1);
  window.crypto?.getRandomValues?.(random);
  const picked = eligible[(random[0] || Date.now()) % eligible.length];
  window.sessionStorage.setItem(DEMO_HOLDER_SESSION_KEY, picked.wallet);
  return picked;
}

function DemoBadge() {
  return (
    <span className="inline-flex shrink-0 rounded-full border border-[#FFFF00]/65 bg-[#FFFF00]/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#FFFF00]">
      Demo Data
    </span>
  );
}

function AirdropDayTooltip({ value, children }: { value: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 0, close: 60 }, move: false });
  const focus = useFocus(context);
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps({
          "aria-label": value,
          className: "mx-auto flex h-4 cursor-help items-center justify-center rounded-full outline-none focus:ring-1 focus:ring-[#00FF00]/70",
        })}
      >
        {children}
      </button>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({
              className: "z-[70] whitespace-nowrap rounded-lg border border-[#00FF00]/40 bg-black px-3 py-2 text-[11px] font-bold leading-snug text-[#00FF00] shadow-2xl",
            })}
          >
            {value}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function AttentionTrendChart({ range }: { range: string }) {
  const data = useMemo(() => {
    const pointCount = range === "7D" ? 7 : range === "30D" ? 30 : 90;
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    return Array.from({ length: pointCount }, (_, index) => {
      const date = new Date(end);
      date.setDate(end.getDate() - (pointCount - index - 1));
      const weekday = date.getDay();
      const weekendDip = weekday === 0 ? 0.76 : weekday === 6 ? 0.83 : 1;
      const growth = 18_000 + index * (range === "7D" ? 2_850 : range === "30D" ? 980 : 410);
      const naturalMovement = 1 + Math.sin(index * 1.17) * 0.065 + Math.cos(index * 0.43) * 0.035;
      return { date, value: Math.round(growth * weekendDip * naturalMovement) };
    });
  }, [range]);

  const width = 320;
  const height = 112;
  const left = 34;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const values = data.map((point) => point.value);
  const minValue = Math.min(...values) * 0.92;
  const maxValue = Math.max(...values) * 1.05;
  const valueSpan = Math.max(1, maxValue - minValue);
  const points = data.map((point, index) => ({
    ...point,
    x: left + (index / Math.max(1, data.length - 1)) * (width - left - right),
    y: top + ((maxValue - point.value) / valueSpan) * (height - top - bottom),
  }));
  const linePoints = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const formatDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const formatValue = (value: number) => `${Math.round(value / 1000)}K`;

  return (
    <svg
      key={range}
      viewBox={`0 0 ${width} ${height}`}
      className="mt-1 h-28 w-full overflow-visible"
      role="img"
      aria-label={`Illustrative ${range} focused-attention trend rising over time with weekend dips`}
    >
      {[0, 0.5, 1].map((ratio) => {
        const y = top + ratio * (height - top - bottom);
        return <line key={ratio} x1={left} x2={width - right} y1={y} y2={y} stroke="rgba(0,255,0,0.11)" strokeDasharray="3 5" />;
      })}
      <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} stroke="rgba(0,255,0,0.3)" />
      <polyline
        points={linePoints}
        pathLength="1"
        fill="none"
        stroke="#00FF00"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="perks-attention-chart-line"
      />
      {points.map((point, index) => (
        <circle
          key={point.date.toISOString()}
          cx={point.x}
          cy={point.y}
          r="2.5"
          fill="#00FF00"
          stroke="#032503"
          strokeWidth="1"
          className="perks-attention-chart-point"
          style={{ animationDelay: `${900 + index * Math.max(12, 120 / data.length)}ms` }}
        />
      ))}
      <text x={left - 4} y={top + 4} textAnchor="end" fill="#6f9f6f" fontSize="8" fontWeight="800">{formatValue(maxValue)}</text>
      <text x={left - 4} y={height - bottom + 3} textAnchor="end" fill="#6f9f6f" fontSize="8" fontWeight="800">{formatValue(minValue)}</text>
      <text x={left} y={height - 6} fill="#6f9f6f" fontSize="8" fontWeight="800">{formatDate(data[0].date)}</text>
      <text x={width - right} y={height - 6} textAnchor="end" fill="#6f9f6f" fontSize="8" fontWeight="800">{formatDate(data[data.length - 1].date)}</text>
    </svg>
  );
}

function MetricGrid({ metrics }: { metrics: PerksMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          title={metric.detail}
          className="min-h-[76px] rounded-xl border border-[#00FF00]/25 bg-[rgba(0,255,0,0.045)] px-3 py-3 transition hover:border-2 hover:border-[#00FF00] hover:px-[11px] hover:py-[11px] hover:shadow-[0_0_12px_rgba(0,255,0,0.35)]"
        >
          <span className="block text-[11px] font-black uppercase leading-4 text-[#8bbf8b]">{metric.label}</span>
          <span className="mt-1.5 block break-words text-lg font-black leading-5 text-[#00FF00]">{metric.value}</span>
        </div>
      ))}
    </div>
  );
}

function PerksDashboardPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/70">
      <div className="flex items-center justify-between gap-2 border-b border-[#00FF00]/15 px-3 py-3">
        <h2 className="text-xs font-black uppercase text-[#00FF00]">{title}</h2>
        <DemoBadge />
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function MockTokenChart({ values, callIndex, move }: { values: number[]; callIndex: number; move: string }) {
  const width = 320;
  const height = 82;
  const padX = 8;
  const padTop = 16;
  const padBottom = 10;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(1, maximum - minimum);
  const points = values.map((value, index) => ({
    x: padX + (index / Math.max(1, values.length - 1)) * (width - padX * 2),
    y: padTop + ((maximum - value) / spread) * (height - padTop - padBottom),
  }));
  const safeCallIndex = Math.max(0, Math.min(points.length - 1, callIndex));
  const call = points[safeCallIndex];
  const pointString = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const isNegative = move.trim().startsWith("-");
  const chartColor = isNegative ? "#ff3333" : "#00FF00";
  const chartBorderClass = isNegative ? "border-[#ff3333]/35" : "border-[#00FF00]/35";
  const mutedTextClass = isNegative ? "text-[#c77b7b]" : "text-[#8bbf8b]";
  const moveTextClass = isNegative ? "text-[#ff3333]" : "text-[#00FF00]";

  return (
    <div className={`mt-3 rounded-md border bg-black px-2 pb-1 pt-2 ${chartBorderClass}`}>
      <div className="flex items-center justify-between text-[9px] font-black uppercase">
        <span className={mutedTextClass}>Mock price chart</span>
        <span className={moveTextClass}>Move {move}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 block h-[82px] w-full overflow-visible" role="img" aria-label={`Mock token chart showing the 10X call and a ${move} move since`}>
        <polyline points={pointString} fill="none" stroke={chartColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={call.x} x2={call.x} y1={10} y2={height - 4} stroke={chartColor} strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />
        <circle cx={call.x} cy={call.y} r="4" fill={chartColor} stroke="#001900" strokeWidth="2" />
        <text x={call.x} y="8" textAnchor="middle" fill={chartColor} fontSize="8" fontWeight="900">10X CALL</text>
      </svg>
    </div>
  );
}

function Explorer({ definition }: { definition: PerksDefinition }) {
  const [filter, setFilter] = useState(definition.explorer.filters[0]);
  useEffect(() => setFilter(definition.explorer.filters[0]), [definition.id, definition.explorer.filters]);
  const rows = definition.explorer.rows.filter((row) => {
    if (definition.id === "attention" || definition.id === "nfts") return row.filter === filter;
    return filter === "All" || row.filter === filter;
  });

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/70">
      <div className="border-b border-[#00FF00]/15 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xs font-black uppercase text-[#00FF00]">{definition.explorer.title}</h2>
            <p className="mt-1 text-[11px] leading-4 text-[#8bbf8b]">{definition.explorer.description}</p>
          </div>
          <DemoBadge />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {definition.explorer.filters.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                void hapticSelectionChanged();
                setFilter(option);
              }}
              className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] font-black transition ${
                filter === option
                  ? "border-[#00FF00] bg-[#00FF00] text-[rgb(0,80,0)]"
                  : "border-[#00FF00]/35 bg-black text-[#00FF00] hover:border-[#00FF00]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 p-2">
        {definition.id === "nfts" && (
          <div className="rounded-lg border border-[#00FF00]/15 bg-[#041204]/70 p-2">
            <div className="px-1 pb-3 pt-1">
              <span className="block text-xs font-black uppercase text-[#00FF00]">Season $1B NFT Canvas</span>
              <span className="mt-1 block text-[10px] leading-4 text-[#8bbf8b]">Larger squares represent token tribes with more Season NFTs.</span>
            </div>
            <div className="aspect-square w-full overflow-hidden rounded-md border border-[#00FF00]/30 bg-black">
              <img
                src={rows[0]?.imageSrc}
                alt={`${rows[0]?.cells[0] ?? "Selected season"} final canvas`}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        )}
        {definition.id === "attention" && (
          <div className="rounded-lg border border-[#00FF00]/15 bg-[#041204]/70 p-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-[#6f9f6f]"><span>Focused attention</span><span>{filter}</span></div>
            <AttentionTrendChart range={filter} />
          </div>
        )}
        {rows.map((row, rowIndex) => (
          <div key={`${row.filter}-${row.cells[0]}-${rowIndex}`} className="rounded-lg border border-[#00FF00]/15 bg-[#041204]/70 p-2 transition hover:border-2 hover:border-[#00FF00] hover:p-[7px] hover:shadow-[0_0_12px_rgba(0,255,0,0.35)]">
            <div className="grid grid-cols-3 gap-x-2 gap-y-2">
              {row.cells.map((cell, index) => (
                <div key={`${definition.explorer.columns[index]}-${index}`} className="min-w-0">
                  <span className="block truncate text-[10px] font-black uppercase text-[#6f9f6f]">{definition.explorer.columns[index]}</span>
                  {definition.id === "memes" && definition.explorer.columns[index] === "Airdropped" ? (
                    <span className="mt-0.5 inline-flex max-w-full rounded-full border border-[#00FF00]/55 bg-[#032503] px-1.5 py-px text-[10px] font-black text-[#00FF00]">
                      {row.airdropUsd
                        ? formatExactAirdropValue(
                            row.airdropUsd
                              .slice(0, Math.ceil((row.progress ?? 0) / 10))
                              .reduce((total, amount) => total + amount, 0),
                          )
                        : cell}
                    </span>
                  ) : (
                    <span className="mt-0.5 block truncate text-[11px] font-black text-white">{cell}</span>
                  )}
                </div>
              ))}
            </div>
            {row.tools && row.tools.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {row.tools.map((tool) => (
                  <span
                    key={tool}
                    className="inline-flex rounded-full border border-[#00FF00]/45 bg-[#032503] px-2 py-1 text-[10px] font-black text-[#00FF00]"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}
            {definition.id === "alpha" && row.priceHistory && row.priceHistory.length > 1 && (
              <MockTokenChart
                values={row.priceHistory}
                callIndex={row.callIndex ?? 0}
                move={row.cells[definition.explorer.columns.indexOf("Move")] ?? "—"}
              />
            )}
            {row.progress != null && definition.id === "memes" && row.airdropUsd && (
              <div className="mt-3 pt-1">
                <div className="relative isolate grid grid-cols-10">
                  <span
                    className="absolute left-[5%] top-[7px] z-0 h-0.5 w-[90%] bg-[#00FF00]/30"
                    aria-hidden="true"
                  />
                  <span
                    className="absolute left-[5%] top-[7px] z-0 h-0.5 bg-[#00FF00] transition-[width] duration-500"
                    style={{ width: `${Math.max(0, (Math.ceil(row.progress / 10) - 1) * 10)}%` }}
                    aria-hidden="true"
                  />
                  {row.airdropUsd.map((amount, dayIndex) => {
                    const passed = dayIndex < Math.ceil(row.progress! / 10);
                    return (
                      <div key={dayIndex} className="relative z-10 min-w-0 text-center">
                        <AirdropDayTooltip value={`Day ${dayIndex + 1}: ${formatExactAirdropValue(amount)}`}>
                          {passed ? (
                            <span className="block whitespace-nowrap rounded-full border border-[#00FF00]/65 bg-[#032503] px-1 py-px text-[8px] font-black leading-3 text-[#00FF00]">
                              {formatAirdropDayValue(amount)}
                            </span>
                          ) : (
                            <span className="block h-3 w-3 rounded-full border-2 border-[#00FF00]/55 bg-black" />
                          )}
                        </AirdropDayTooltip>
                        <span className={`mt-1 block text-[8px] font-black leading-3 ${passed ? "text-[#8bbf8b]" : "text-[#4f744f]"}`}>
                          Day {dayIndex + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {row.progress != null && definition.id !== "memes" && definition.id !== "attention" && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full border border-[#00FF00]/25 bg-black" title={`${row.progress}%`}>
                <span className="block h-full bg-[#00FF00] transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, row.progress))}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function WarpletIdentity({
  holder,
  fallbackLabel,
  onSearchWallet,
  onOpenWarpletDetails,
}: {
  holder: PerksHolder;
  fallbackLabel?: string;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
}) {
  const tokenId = holder.originalFidTokenId ?? holder.bestTokenId ?? FALLBACK_WARPLET_TOKEN_ID;
  const canSearchWallet = /^0x[a-f0-9]{40}$/i.test(holder.wallet);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        title={`Open Warplet #${tokenId}`}
        onClick={() => {
          void hapticTap();
          onOpenWarpletDetails(tokenId);
        }}
        className="shrink-0 cursor-pointer rounded-lg outline-none ring-[#00FF00] focus:ring-2"
      >
        <img src={getWarpletPreviewImageUrl(tokenId)} alt={`Warplet #${tokenId}`} className="h-12 w-12 rounded-lg object-cover" loading="lazy" decoding="async" />
      </button>
      {canSearchWallet ? <button
        type="button"
        title="Search this holder's Warplets"
        onClick={() => {
          void hapticTap();
          onSearchWallet(holder.wallet);
        }}
        className="min-w-0 cursor-pointer text-left outline-none"
      >
        <span className="block truncate text-xs font-black text-[#00FF00] underline-offset-2 hover:underline">{fallbackLabel ?? holderLabel(holder)}</span>
        <span className="block truncate text-[10px] font-bold text-[#8bbf8b]">
          {holder.ownedCount} Warplet{holder.ownedCount === 1 ? "" : "s"} · Best #{holder.bestRarityRank?.toLocaleString("en-US") ?? "—"}
        </span>
      </button> : <span className="min-w-0 text-left">
        <span className="block truncate text-xs font-black text-[#00FF00]">{fallbackLabel ?? "Demo You"}</span>
        <span className="block truncate text-[10px] font-bold text-[#8bbf8b]">Branded Warplet example</span>
      </span>}
    </div>
  );
}

function YouSpotlight({
  definition,
  holder,
  isDemo,
  onSearchWallet,
  onOpenWarpletDetails,
  embedded = false,
}: {
  definition: PerksDefinition;
  holder: PerksHolder;
  isDemo: boolean;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  embedded?: boolean;
}) {
  const content = (
    <>
      {!embedded && (
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-black uppercase text-[#00FF00]">{isDemo ? "Demo You" : "You"}</h2>
        <DemoBadge />
      </div>
      )}
      <div className={embedded ? "" : "mt-3"}>
        <WarpletIdentity holder={holder} fallbackLabel={isDemo ? `Demo · ${holderLabel(holder)}` : undefined} onSearchWallet={onSearchWallet} onOpenWarpletDetails={onOpenWarpletDetails} />
      </div>
      <div className="mt-3">
        <MetricGrid metrics={buildYouMetrics(definition.id, holder)} />
      </div>
    </>
  );

  if (embedded) return content;
  return (
    <section className="mt-4 rounded-xl border border-[#00FF00]/35 bg-[rgba(0,255,0,0.065)] p-3 transition hover:border-2 hover:border-[#00FF00] hover:p-[11px] hover:shadow-[0_0_14px_rgba(0,255,0,0.34)]">
      {content}
    </section>
  );
}

function Leaderboard({
  definition,
  holders,
  onSearchWallet,
  onOpenWarpletDetails,
  embedded = false,
}: {
  definition: PerksDefinition;
  holders: PerksHolder[];
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  embedded?: boolean;
}) {
  return (
    <section className={embedded ? "" : "mt-4"}>
      {!embedded && (
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-black uppercase text-[#00FF00]">Top 10</h2>
        </div>
        <DemoBadge />
      </div>
      )}
      {holders.length === 0 ? (
        <div className="rounded-xl border border-[#00FF00]/20 bg-black/65 px-3 py-8 text-center text-xs font-bold text-[#8bbf8b]">
          Live holder examples are temporarily unavailable.
        </div>
      ) : (
        <div className="space-y-2">
          {holders.map((holder, index) => {
            const score = leaderboardScore(definition.id, holder);
            return (
              <article
                key={holder.wallet}
                title="Current holder identity · illustrative benefit"
                className="flex items-center gap-2 rounded-xl border border-[#00FF00]/25 bg-black/70 p-2 transition hover:border-2 hover:border-[#00FF00] hover:p-[7px] hover:shadow-[0_0_12px_rgba(0,255,0,0.35)]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#00FF00]/45 bg-[#00FF00]/10 text-[10px] font-black text-[#00FF00]">#{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <WarpletIdentity holder={holder} onSearchWallet={onSearchWallet} onOpenWarpletDetails={onOpenWarpletDetails} />
                </div>
                <div className="max-w-[84px] shrink-0 text-right">
                  <span className="block text-[10px] font-black uppercase leading-3 text-[#6f9f6f]">{definition.leaderboardMetric}</span>
                  <span className="block whitespace-nowrap text-xs font-black text-[#00FF00]">{formatLeaderboardScore(definition.id, score)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FutureExplanation({ definition, onShare }: { definition: PerksDefinition; onShare: () => void }) {
  const shareContent = PERKS_SHARE_CONTENT[definition.id];
  const tokenId = shareContent.tokenId;

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/70">
      <div className="border-b border-[#00FF00]/15 px-3 py-3">
        <h2 className="text-xs font-black uppercase text-[#00FF00]">The Future {definition.title} Perk</h2>
      </div>
      <div>
        <div className="p-3">
          <video
            key={tokenId}
            src={getWarpletVideoUrl(tokenId)}
            poster={getWarpletPreviewImageUrl(tokenId)}
            aria-label={`Animated 10X Warplet #${tokenId}`}
            className="aspect-square w-full rounded-xl object-cover"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          />
        </div>
        {definition.explanation.map((item, index) => (
          <div
            key={item.title}
            className={`px-3 pt-3 ${item.callout ? "pb-0" : "pb-3"} ${index > 0 ? "border-t border-[#00FF00]/10" : ""}`}
          >
            <h3 className="text-xs font-black uppercase text-[#00FF00]">{item.title}</h3>
            <p className="mt-1 whitespace-pre-line text-xs leading-5 text-[#b8d7b8]">{item.body}</p>
            {item.callout && (
              <span className="mt-4 block py-2 text-center text-xl font-black uppercase leading-[1.5] text-[#00FF00]">
                {shareContent.callout}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="px-3 pb-3 pt-4">
        <button type="button" onClick={() => { void hapticTap(); onShare(); }} className="w-full cursor-pointer rounded-[20px] border border-[#0a990a] bg-[#00FF00] px-4 py-3 text-sm font-black text-[rgb(0,80,0)] shadow-[3px_6px_0_#0a990a] active:translate-y-0.5">
          {shareContent.cta}
        </button>
      </div>
    </section>
  );
}

export default function PerksPage({
  subpage,
  connectedWallet,
  viewerFid,
  viewerProfile,
  onSearchWallet,
  onOpenWarpletDetails,
  onShare,
}: {
  subpage: PerksSubpage;
  connectedWallet: string | null;
  viewerFid: number | null;
  viewerProfile?: PerksViewerProfile | null;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  onShare: (subpage: PerksSubpage) => void;
}) {
  const definition = PERKS_DEFINITIONS[subpage];
  const [roster, setRoster] = useState<PerksHolder[]>(holderRosterCache ?? []);
  const [viewerHolder, setViewerHolder] = useState<PerksHolder | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(Boolean(connectedWallet || viewerFid));
  const [loadingHolders, setLoadingHolders] = useState(holderRosterCache == null);
  const [showMockupNotice, setShowMockupNotice] = useState(() => {
    if (typeof window === "undefined") return true;
    if (new URLSearchParams(window.location.search).get("mockup") === "1") return true;
    return window.localStorage.getItem(PERKS_MOCKUP_NOTICE_DISMISSED_KEY) !== "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("mockup") !== "1") return;
    window.localStorage.removeItem(PERKS_MOCKUP_NOTICE_DISMISSED_KEY);
    setShowMockupNotice(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingHolders(holderRosterCache == null);
    loadHolderRoster()
      .then((holders) => { if (!cancelled) setRoster(holders); })
      .catch(() => { if (!cancelled) setRoster([]); })
      .finally(() => { if (!cancelled) setLoadingHolders(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setViewerHolder(null);
    setLoadingViewer(Boolean(connectedWallet || viewerFid));
    if (!connectedWallet && !viewerFid) return () => { cancelled = true; };
    loadViewerHolder(connectedWallet, viewerFid)
      .then((holder) => {
        if (cancelled) return;
        if (holder) {
          setViewerHolder(holder);
          return;
        }
        setViewerHolder({
          rank: null,
          wallet: connectedWallet?.toLowerCase() ?? `fid:${viewerFid}`,
          ownedCount: 0,
          bestRarityRank: null,
          bestTokenId: FALLBACK_WARPLET_TOKEN_ID,
          username: viewerProfile?.username ?? null,
          displayName: viewerProfile?.displayName ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setViewerHolder({
          rank: null,
          wallet: connectedWallet?.toLowerCase() ?? `fid:${viewerFid}`,
          ownedCount: 0,
          bestRarityRank: null,
          bestTokenId: FALLBACK_WARPLET_TOKEN_ID,
          username: viewerProfile?.username ?? null,
          displayName: viewerProfile?.displayName ?? null,
        });
      })
      .finally(() => { if (!cancelled) setLoadingViewer(false); });
    return () => { cancelled = true; };
  }, [connectedWallet, viewerFid, viewerProfile?.displayName, viewerProfile?.username]);

  const topTen = useMemo(() => [...roster]
    .sort((left, right) => leaderboardScore(subpage, right) - leaderboardScore(subpage, left) || left.wallet.localeCompare(right.wallet))
    .slice(0, 10), [roster, subpage]);
  const excludedWallets = useMemo(() => {
    const wallets = new Set<string>();
    for (const perk of PERK_IDS) {
      [...roster]
        .sort((left, right) => leaderboardScore(perk, right) - leaderboardScore(perk, left) || left.wallet.localeCompare(right.wallet))
        .slice(0, 10)
        .forEach((holder) => wallets.add(holder.wallet));
    }
    return wallets;
  }, [roster]);
  const demoHolder = useMemo(() => selectDemoHolder(roster, excludedWallets), [excludedWallets, roster]);
  const youHolder = viewerHolder ?? demoHolder ?? {
    rank: null,
    wallet: "demo:warplet",
    ownedCount: 0,
    bestRarityRank: null,
    bestTokenId: FALLBACK_WARPLET_TOKEN_ID,
    username: null,
    displayName: null,
  };
  const isDemoYou = !connectedWallet && !viewerFid;

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-12 pt-4">
      {showMockupNotice && (
        <div className="relative rounded-xl border border-[#FFFF00]/55 bg-[#FFFF00]/10 px-3 py-3 pr-10 text-xs font-bold leading-5 text-[#fff7a8]">
          <strong className="block font-black uppercase text-[#FFFF00]">Future 10X Ecosystem Mockup</strong>
          <span className="block">Illustrative data, rankings and returns. Not actual benefits, promises, endorsements or performance.</span>
          <button
            type="button"
            aria-label="Close future ecosystem mockup notice"
            title="Close"
            onClick={() => {
              void hapticTap();
              window.localStorage.setItem(PERKS_MOCKUP_NOTICE_DISMISSED_KEY, "1");
              setShowMockupNotice(false);
            }}
            className="absolute right-2 top-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[#FFFF00]/45 bg-black text-[#FFFF00] transition hover:bg-[#1a1a00] active:scale-95"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}

      <header className="py-5 text-center">
        <h1 className="text-3xl font-black uppercase text-[#00FF00]">{definition.eyebrow}</h1>
        <p className="mx-auto mt-2 max-w-sm px-4 text-xs leading-5 text-[#b8d7b8]">{definition.summary}</p>
      </header>

      <PerksDashboardPanel title={definition.statsTitle}>
        <MetricGrid metrics={definition.globalMetrics} />
      </PerksDashboardPanel>
      <Explorer definition={definition} />

      <PerksDashboardPanel title="Top 10">
        <Leaderboard embedded definition={definition} holders={topTen} onSearchWallet={onSearchWallet} onOpenWarpletDetails={onOpenWarpletDetails} />
      </PerksDashboardPanel>

      <PerksDashboardPanel title={definition.averageTitle}>
        <MetricGrid metrics={definition.averageMetrics} />
      </PerksDashboardPanel>

      {(loadingViewer || (loadingHolders && !viewerHolder && roster.length === 0)) ? (
        <PerksDashboardPanel title={isDemoYou ? "Demo You" : "You"}>
          <div className="py-5 text-center text-xs font-bold text-[#8bbf8b]">Finding your Perks example...</div>
        </PerksDashboardPanel>
      ) : (
        <PerksDashboardPanel title={isDemoYou ? "Demo You" : "You"}>
          <YouSpotlight embedded definition={definition} holder={youHolder} isDemo={isDemoYou} onSearchWallet={onSearchWallet} onOpenWarpletDetails={onOpenWarpletDetails} />
        </PerksDashboardPanel>
      )}

      <FutureExplanation definition={definition} onShare={() => onShare(subpage)} />

      <div className="mt-12 rounded-xl border border-[#FFFF00]/55 bg-[#FFFF00]/10 px-3 py-3 text-xs font-bold leading-5 text-[#fff7a8]">
        <strong className="block font-black uppercase text-[#FFFF00]">Future 10X Ecosystem Mockup</strong>
        <span className="block">Illustrative data, rankings and returns. Not actual benefits, promises, endorsements or performance.</span>
      </div>

    </main>
  );
}

export type { PerksSubpage } from "./perksMockData";
