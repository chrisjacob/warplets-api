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
  type PerksDefinition,
  type PerksMetric,
  type PerksSubpage,
} from "./perksMockData";

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
const MOCKUP_NOTICE_DISMISSED_KEY = "warplets-perks-mockup-notice-dismissed-v1";
const MOCK_HOLDER_LIMIT = 100;
const PERK_IDS: PerksSubpage[] = ["memes", "nfts", "ai", "attention", "access"];

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
    return [
      { label: "Eligible Launches", value: formatInteger(46 * factor) },
      { label: "Claimed Distributions", value: formatInteger(39 * factor) },
      { label: "Airdrop Value Now", value: formatMoney(486 * factor) },
      { label: "Airdrop Value at ATH", value: formatMoney(1_842 * factor) },
      { label: "Illustrative Boost", value: `${(1 + Math.min(holder.ownedCount, 20) * 0.04).toFixed(2)}X` },
    ];
  }
  if (perk === "nfts") {
    return [
      { label: "Season Mints", value: formatInteger(12 * factor) },
      { label: "Upgrades", value: formatInteger(4.8 * factor) },
      { label: "Active Benefit Months", value: (31.5 * factor).toFixed(1) },
      { label: "Whitelist Savings", value: formatMoney(108 * factor) },
      { label: "Peak Floor Opportunity", value: formatMoney(152 * factor) },
    ];
  }
  if (perk === "ai") {
    const allowance = 228 * factor;
    const used = allowance * (0.62 + seededUnit(perk, holder.wallet, "usage") * 0.3);
    return [
      { label: "Sponsored Allowance", value: formatMoney(allowance) },
      { label: "Credits Used", value: formatMoney(used) },
      { label: "Credits Remaining", value: formatMoney(Math.max(0, allowance - used)) },
      { label: "Tools Accessed", value: formatInteger(3 + factor * 2.4) },
      { label: "Projects Shipped", value: formatInteger(factor * 1.7) },
    ];
  }
  if (perk === "attention") {
    const impressions = 9_420 * factor;
    return [
      { label: "Impressions", value: formatInteger(impressions) },
      { label: "Engagement Rate", value: `${(5.8 + seededUnit(perk, holder.wallet, "engagement") * 8.4).toFixed(1)}%` },
      { label: "Feed Rank", value: `#${formatInteger(30 + seededUnit(perk, holder.wallet, "rank") * 970)}` },
      { label: "Verified Actions", value: formatInteger(310 * factor) },
      { label: "Daily Unlock", value: `${Math.min(100, Math.round(68 + factor * 12))}%` },
    ];
  }
  return [
    { label: "Access Tier", value: holder.ownedCount >= 5 ? "10X Priority" : "Network" },
    { label: "Voting Influence", value: `${(1 + Math.min(holder.ownedCount, 20) * 0.06).toFixed(2)}X` },
    { label: "Memecoins Reviewed", value: formatInteger(146 * factor) },
    { label: "Signals Backed", value: formatInteger(14 * factor) },
    { label: "Contribution Score", value: formatInteger(1_000 * factor) },
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
          className: "flex h-4 cursor-help items-center justify-center rounded-full outline-none focus:ring-1 focus:ring-[#00FF00]/70",
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

function SectionHeading({ children, detail }: { children: string; detail?: string }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-xs font-black uppercase text-[#00FF00]">{children}</h2>
        {detail && <p className="mt-0.5 text-[11px] font-bold text-[#8bbf8b]">{detail}</p>}
      </div>
      <DemoBadge />
    </div>
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
          <div className="flex items-center gap-3 rounded-lg border border-[#00FF00]/15 bg-[#041204]/70 p-2">
            <div className="grid h-20 w-20 shrink-0 grid-cols-8 overflow-hidden rounded-md border border-[#00FF00]/30 bg-black">
              {Array.from({ length: 64 }, (_, index) => (
                <span
                  key={index}
                  className="border-[0.5px] border-black"
                  style={{ backgroundColor: `rgba(0,255,0,${0.12 + ((index * 17) % 80) / 100})` }}
                />
              ))}
            </div>
            <div>
              <span className="block text-[10px] font-black uppercase text-[#8bbf8b]">Final Season Canvas</span>
              <span className="mt-1 block text-xs font-black text-[#00FF00]">10,000 × 10,000 px</span>
              <span className="mt-1 block text-[10px] leading-4 text-[#8bbf8b]">Larger squares represent token tribes with more Season NFTs.</span>
            </div>
          </div>
        )}
        {definition.id === "attention" && (
          <div className="rounded-lg border border-[#00FF00]/15 bg-[#041204]/70 p-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-[#6f9f6f]"><span>Focused attention</span><span>{filter}</span></div>
            <svg viewBox="0 0 320 72" className="mt-1 h-[72px] w-full" role="img" aria-label={`Illustrative ${filter} attention trend`}>
              <path d="M0 62 C30 59 37 48 63 51 S98 42 120 44 S154 27 179 34 S212 17 238 22 S278 8 320 11" fill="none" stroke="#00FF00" strokeWidth="3" />
              <path d="M0 62 C30 59 37 48 63 51 S98 42 120 44 S154 27 179 34 S212 17 238 22 S278 8 320 11 L320 72 L0 72 Z" fill="rgba(0,255,0,0.08)" />
            </svg>
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
                      {cell}
                    </span>
                  ) : (
                    <span className="mt-0.5 block truncate text-[11px] font-black text-white">{cell}</span>
                  )}
                </div>
              ))}
            </div>
            {row.progress != null && definition.id === "memes" && row.airdropUsd && (
              <div className="mt-3 pt-1">
                <div className="relative grid grid-cols-10">
                  <span className="absolute left-[5%] right-[5%] top-[7px] h-0.5 bg-[#00FF00]/30" aria-hidden="true" />
                  <span
                    className="absolute left-[5%] top-[7px] h-0.5 bg-[#00FF00] transition-[width] duration-500"
                    style={{ width: `${Math.max(0, (Math.ceil(row.progress / 10) - 1) * 10)}%` }}
                    aria-hidden="true"
                  />
                  {row.airdropUsd.map((amount, dayIndex) => {
                    const passed = dayIndex < Math.ceil(row.progress! / 10);
                    return (
                      <div key={dayIndex} className="relative z-[1] min-w-0 text-center">
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
            {row.progress != null && definition.id !== "memes" && (
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
}: {
  definition: PerksDefinition;
  holder: PerksHolder;
  isDemo: boolean;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
}) {
  return (
    <section className="mt-4 rounded-xl border border-[#00FF00]/35 bg-[rgba(0,255,0,0.065)] p-3 transition hover:border-2 hover:border-[#00FF00] hover:p-[11px] hover:shadow-[0_0_14px_rgba(0,255,0,0.34)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-black uppercase text-[#00FF00]">{isDemo ? "Demo You" : "You"}</h2>
        <DemoBadge />
      </div>
      <div className="mt-3">
        <WarpletIdentity holder={holder} fallbackLabel={isDemo ? `Demo · ${holderLabel(holder)}` : undefined} onSearchWallet={onSearchWallet} onOpenWarpletDetails={onOpenWarpletDetails} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {buildYouMetrics(definition.id, holder).map((metric, index) => (
          <div key={metric.label} className={`${index === 4 ? "col-span-2" : ""} rounded-lg border border-[#00FF00]/15 bg-black/55 px-2 py-2`}>
            <span className="block text-[10px] font-black uppercase text-[#6f9f6f]">{metric.label}</span>
            <span className="mt-0.5 block text-sm font-black text-[#00FF00]">{metric.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Leaderboard({
  definition,
  holders,
  onSearchWallet,
  onOpenWarpletDetails,
}: {
  definition: PerksDefinition;
  holders: PerksHolder[];
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
}) {
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-black uppercase text-[#00FF00]">Top 10</h2>
        </div>
        <DemoBadge />
      </div>
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
                  <span className="block text-xs font-black text-[#00FF00]">{formatLeaderboardScore(definition.id, score)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FutureExplanation({ definition }: { definition: PerksDefinition }) {
  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/70">
      <div className="border-b border-[#00FF00]/15 px-3 py-3">
        <h2 className="text-xs font-black uppercase text-[#00FF00]">The Future {definition.title} Perk</h2>
      </div>
      <div className="divide-y divide-[#00FF00]/10">
        {definition.explanation.map((item) => (
          <div key={item.title} className="px-3 py-3">
            <h3 className="text-xs font-black uppercase text-[#00FF00]">{item.title}</h3>
            <p className="mt-1 text-xs leading-5 text-[#b8d7b8]">{item.body}</p>
          </div>
        ))}
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
}: {
  subpage: PerksSubpage;
  connectedWallet: string | null;
  viewerFid: number | null;
  viewerProfile?: PerksViewerProfile | null;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
}) {
  const definition = PERKS_DEFINITIONS[subpage];
  const [roster, setRoster] = useState<PerksHolder[]>(holderRosterCache ?? []);
  const [viewerHolder, setViewerHolder] = useState<PerksHolder | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(Boolean(connectedWallet || viewerFid));
  const [loadingHolders, setLoadingHolders] = useState(holderRosterCache == null);
  const [showMockupNotice, setShowMockupNotice] = useState(() => {
    if (typeof window === "undefined") return true;
    if (new URLSearchParams(window.location.search).get("mockup") === "1") return true;
    return window.localStorage.getItem(MOCKUP_NOTICE_DISMISSED_KEY) !== "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("mockup") !== "1") return;
    window.localStorage.removeItem(MOCKUP_NOTICE_DISMISSED_KEY);
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
              window.localStorage.setItem(MOCKUP_NOTICE_DISMISSED_KEY, "1");
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
        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-[#b8d7b8]">{definition.summary}</p>
      </header>

      <SectionHeading>{definition.statsTitle}</SectionHeading>
      <MetricGrid metrics={definition.globalMetrics} />
      <Explorer definition={definition} />

      <Leaderboard definition={definition} holders={topTen} onSearchWallet={onSearchWallet} onOpenWarpletDetails={onOpenWarpletDetails} />

      <SectionHeading>{definition.averageTitle}</SectionHeading>
      <MetricGrid metrics={definition.averageMetrics} />

      {(loadingViewer || (loadingHolders && !viewerHolder && roster.length === 0)) ? (
        <div className="mt-4 rounded-xl border border-[#00FF00]/20 bg-black/65 px-3 py-8 text-center text-xs font-bold text-[#8bbf8b]">Finding your Perks example...</div>
      ) : (
        <YouSpotlight definition={definition} holder={youHolder} isDemo={isDemoYou} onSearchWallet={onSearchWallet} onOpenWarpletDetails={onOpenWarpletDetails} />
      )}

      <FutureExplanation definition={definition} />

      <div className="mt-4 rounded-xl border border-[#FFFF00]/55 bg-[#FFFF00]/10 px-3 py-3 text-xs font-bold leading-5 text-[#fff7a8]">
        <strong className="block font-black uppercase text-[#FFFF00]">Future 10X Ecosystem Mockup</strong>
        <span className="block">Illustrative data, rankings and returns. Not actual benefits, promises, endorsements or performance.</span>
      </div>

    </main>
  );
}

export type { PerksSubpage } from "./perksMockData";
