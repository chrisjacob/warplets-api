import { PERKS_SHARE_CONTENT } from "./perksShareContent";

export type PerksSubpage = "memes" | "rwas" | "nfts" | "ai" | "attention" | "alpha";

export type PerksMetric = {
  label: string;
  value: string;
  detail?: string;
};

export type PerksExplorerRow = {
  filter: string;
  cells: string[];
  stonklet?: {
    id: string;
    name: string;
    ticker: string;
    rwaToken: string;
    tokenId: number;
  };
  progress?: number;
  priceHistory?: number[];
  callIndex?: number;
  airdropUsd?: number[];
  imageSrc?: string;
  toolBadges?: Array<{
    name: string;
    logoSrc: string;
    tagline: string;
    invertLogo?: boolean;
  }>;
};

export type PerksDefinition = {
  id: PerksSubpage;
  title: string;
  eyebrow: string;
  futureTokenId?: number;
  statsTitle: string;
  summary: string;
  globalMetrics: PerksMetric[];
  averageTitle: string;
  averageMetrics: PerksMetric[];
  explorer: {
    title: string;
    description: string;
    filters: string[];
    columns: string[];
    rows: PerksExplorerRow[];
  };
  leaderboardMetric: string;
  explanation: Array<{ title: string; body: string; callout?: string }>;
};

function parseExplorerMetric(value: string): number {
  const normalized = value.replace(/[$,]/g, "").trim();
  const multiplier = normalized.endsWith("M") ? 1_000_000 : normalized.endsWith("K") ? 1_000 : 1;
  return Number(normalized.replace(/[MKd]$/, "")) * multiplier;
}

function formatCompactMetric(value: number, currency = false): string {
  const prefix = currency ? "$" : "";
  if (value >= 1_000_000) {
    const digits = value % 100_000 === 0 ? 1 : 2;
    return `${prefix}${(value / 1_000_000).toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, "")}M`;
  }
  if (value >= 1_000) {
    const digits = value % 1_000 === 0 ? 0 : 1;
    return `${prefix}${(value / 1_000).toFixed(digits).replace(/\.0$/, "")}K`;
  }
  return `${prefix}${value.toLocaleString("en-US")}`;
}

export function aggregateRwaExplorerRows(rows: PerksExplorerRow[], columns: string[]): PerksExplorerRow {
  if (rows.length === 0 || !rows[0].stonklet) throw new Error("RWA aggregation requires at least one Stonklet market row.");
  if (rows.length === 1) return rows[0];

  const valueAt = (row: PerksExplorerRow, label: string) => parseExplorerMetric(row.cells[columns.indexOf(label)] ?? "0");
  const total = (label: string) => rows.reduce((sum, row) => sum + valueAt(row, label), 0);
  const totalVolume = total("Lifetime Volume");
  const cellsByColumn: Record<string, string> = {
    Chain: `${rows.length} chains`,
    "Lifetime Volume": formatCompactMetric(totalVolume, true),
    "RWA Rewards": formatCompactMetric(total("RWA Rewards"), true),
    "RWA LP": formatCompactMetric(total("RWA LP"), true),
    "10X LP": formatCompactMetric(total("10X LP"), true),
    Burned: formatCompactMetric(total("Burned"), true),
  };

  return {
    filter: "All",
    stonklet: rows[0].stonklet,
    cells: columns.map((column) => cellsByColumn[column] ?? "—"),
  };
}

export const RWA_CHART_PERIODS = ["All", "7D", "30D", "90D", "1Y"] as const;
export const ATTENTION_CHART_PERIODS = ["All", "7D", "30D", "90D", "1Y"] as const;
export const RWA_YOU_REWARDS_DISPLAY = "$337";
export type RwaChartPeriod = typeof RWA_CHART_PERIODS[number];

export type RwaMarketChart = {
  name: string;
  marketCap: string;
  performance: Record<RwaChartPeriod, number[]>;
};

export type MarketCapMovement = {
  opening: number;
  current: number;
  change: number;
  label: string;
};

function parseMarketCap(value: string): number {
  const normalized = value.replace(/[$,]/g, "").trim().toUpperCase();
  const suffix = normalized.at(-1);
  const multiplier = suffix === "T"
    ? 1_000_000_000_000
    : suffix === "B"
      ? 1_000_000_000
      : suffix === "M"
        ? 1_000_000
        : suffix === "K"
          ? 1_000
          : 1;
  return Number(normalized.replace(/[TBMK]$/, "")) * multiplier;
}

function formatMarketCap(value: number): string {
  const compact = (divisor: number, suffix: string) => {
    const scaled = value / divisor;
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `$${scaled.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, "")}${suffix}`;
  };
  if (value >= 1_000_000_000_000) return compact(1_000_000_000_000, "T");
  if (value >= 1_000_000_000) return compact(1_000_000_000, "B");
  if (value >= 1_000_000) return compact(1_000_000, "M");
  if (value >= 1_000) return compact(1_000, "K");
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function createMarketCapMovement(current: number, change: number): MarketCapMovement {
  const multiplier = 1 + change / 100;
  const opening = multiplier > 0 ? current / multiplier : current;
  return {
    opening,
    current,
    change,
    label: `${formatMarketCap(opening)} → ${formatMarketCap(current)}`,
  };
}

export function getRwaMarketCapMovement(chart: RwaMarketChart, period: RwaChartPeriod): MarketCapMovement {
  const change = chart.performance[period].at(-1) ?? 0;
  return createMarketCapMovement(parseMarketCap(chart.marketCap), change);
}

// Approximate market-cap trajectories captured for this conceptual mockup. Public-company
// values follow recent market observations; SpaceX uses reported valuation/market snapshots.
export const RWA_MARKET_CHARTS: Record<string, RwaMarketChart> = {
  teslalet: {
    name: "Tesla",
    marketCap: "$1.49T",
    performance: {
      All: [0, -18, -5, 12, -9, 22, 38, 21, 49, 42, 64, 56],
      "7D": [0, 1, -1, 2, 4, 3, 6],
      "30D": [0, -3, 1, 5, 2, 8, 6, 10],
      "90D": [0, -7, -2, 4, 1, 10, 16, 12, 19],
      "1Y": [0, -12, -2, 14, 5, 23, 36, 27, 45, 38, 48],
    },
  },
  spacexlet: {
    name: "SpaceX",
    marketCap: "$1.49T",
    performance: {
      All: [0, 15, 32, 75, 68, 120, 190, 160, 260, 410, 330, 273],
      "7D": [0, -3, 2, -6, -11, -8, -4],
      "30D": [0, 8, 18, 10, -12, -25, -18, -9],
      "90D": [0, 12, 28, 46, 81, 54, 21, -8, -3],
      "1Y": [0, 24, 55, 100, 175, 240, 320, 360, 430, 315, 245],
    },
  },
  nvidialet: {
    name: "NVIDIA",
    marketCap: "$5.03T",
    performance: {
      All: [0, 35, 70, 58, 110, 150, 205, 180, 260, 330, 285, 295],
      "7D": [0, -2, 1, -4, -6, -3, -5],
      "30D": [0, 3, 6, 2, -5, -9, -6, -7],
      "90D": [0, 8, 15, 21, 13, 4, -6, -10, -8],
      "1Y": [0, 7, 18, 15, 28, 35, 31, 38, 42, 36, 26],
    },
  },
  googlelet: {
    name: "Google",
    marketCap: "$4.36T",
    performance: {
      All: [0, 10, 5, 22, 31, 28, 46, 55, 48, 70, 76, 83],
      "7D": [0, 1, 3, 2, 5, 4, 6],
      "30D": [0, -2, 3, 7, 5, 11, 9, 14],
      "90D": [0, 4, 9, 6, 15, 21, 18, 26, 29],
      "1Y": [0, 8, 15, 12, 27, 35, 31, 49, 64, 71, 74],
    },
  },
  hoodlet: {
    name: "Robinhood",
    marketCap: "$77.82B",
    performance: {
      All: [0, -25, -12, 18, 5, 42, 76, 58, 105, 142, 126, 154],
      "7D": [0, -2, 3, 1, 5, 2, 7],
      "30D": [0, 6, 2, 11, 18, 13, 24, 21],
      "90D": [0, -4, 8, 19, 12, 28, 41, 35, 48],
      "1Y": [0, 14, 6, 29, 45, 38, 57, 67, 86, 71, 102],
    },
  },
};

const STONKLET_CHART_SHAPES: Record<RwaChartPeriod, number[]> = {
  All: [0, 0.18, -0.06, 0.36, 0.19, 0.62, 0.41, 0.88, 0.7, 1.15, 0.91, 1],
  "7D": [0, 0.32, -0.18, 0.58, 0.27, 0.86, 1],
  "30D": [0, 0.22, -0.12, 0.46, 0.31, 0.72, 0.61, 1],
  "90D": [0, 0.2, -0.08, 0.42, 0.25, 0.68, 0.5, 0.92, 1],
  "1Y": [0, 0.16, -0.05, 0.34, 0.21, 0.58, 0.43, 0.67, 0.81, 0.69, 1],
};

const STONKLET_PERIOD_SCALE: Record<RwaChartPeriod, number> = {
  All: 1,
  "7D": 0.05,
  "30D": 0.12,
  "90D": 0.25,
  "1Y": 0.55,
};

const STONKLET_MARKET_SCENARIOS: Record<string, Partial<Record<RwaChartPeriod, number[]>>> = {
  // A fast launch that fails to hold attention. Every range catches the burst,
  // distribution and eventual loss instead of implying perpetual appreciation.
  "hoodlet-BSC": {
    All: [0, 95, 310, 680, 510, 260, 80, -25, -74, -88, -79, -68],
    "7D": [0, 62, 145, 78, 12, -38, -55],
    "30D": [0, 85, 260, 430, 275, 70, -28, -62],
    "90D": [0, 110, 340, 590, 430, 180, 15, -58, -74],
    "1Y": [0, 130, 390, 720, 560, 300, 115, -18, -67, -84, -72],
  },
  // Cooling after a sharp run, followed by only a partial 30-day recovery.
  "nvidialet-BSC": {
    "7D": [0, 24, 68, 35, -8, -27, -16],
    "30D": [0, 38, 105, 162, 96, 28, -12, 14],
  },
  // Volatile rotation through negative territory before a modest recovery.
  "googlelet-BSC": {
    "7D": [0, -9, -21, -15, 4, 17, 9],
    "30D": [0, 22, 61, 18, -24, -41, -13, 16],
  },
  // A secondary-chain boom, drawdown and recovery with a lower ending slope.
  "spacexlet-Robinhood": {
    "90D": [0, 75, 180, 310, 225, 72, -42, -16, 38],
    "1Y": [0, 90, 220, 410, 315, 470, 590, 405, 230, 330, 465],
  },
};

export function getIllustrativeStonkletPerformance(row: PerksExplorerRow, period: RwaChartPeriod): number[] {
  const scenario = STONKLET_MARKET_SCENARIOS[`${row.stonklet?.id ?? "stonklet"}-${row.filter}`]?.[period];
  if (scenario) return [...scenario];

  const volume = parseExplorerMetric(row.cells[1] ?? "0") / 1_000_000;
  const target = (180 + Math.sqrt(Math.max(0, volume)) * 250) * STONKLET_PERIOD_SCALE[period];
  const seed = Array.from(`${row.stonklet?.id ?? "stonklet"}-${row.filter}`).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const shape = STONKLET_CHART_SHAPES[period];
  return shape.map((point, index) => {
    if (index === 0) return 0;
    if (index === shape.length - 1) return Math.round(target);
    const jitter = Math.sin(seed * 0.17 + index * 1.73) * target * 0.09;
    return Math.round(point * target + jitter);
  });
}

export function getIllustrativeStonkletMarketCap(row: PerksExplorerRow): string {
  return formatCompactMetric(parseExplorerMetric(row.cells[1] ?? "0") / 10, true);
}

export function getStonkletMarketCapMovement(rows: PerksExplorerRow[], period: RwaChartPeriod): MarketCapMovement {
  const markets = rows.map((row) => {
    const current = parseExplorerMetric(row.cells[1] ?? "0") / 10;
    const change = getIllustrativeStonkletPerformance(row, period).at(-1) ?? 0;
    return createMarketCapMovement(current, change);
  });
  const current = markets.reduce((sum, market) => sum + market.current, 0);
  const opening = markets.reduce((sum, market) => sum + market.opening, 0);
  const change = opening > 0 ? ((current / opening) - 1) * 100 : 0;
  return {
    opening,
    current,
    change,
    label: `${formatMarketCap(opening)} → ${formatMarketCap(current)}`,
  };
}

export const PERKS_MOCK_DATA_VERSION = "perks-demo-v1";
export const PERKS_MOCKUP_NOTICE_DISMISSED_KEY = "warplets-perks-mockup-notice-dismissed-v1";

export const PERKS_DEFINITIONS: Record<PerksSubpage, PerksDefinition> = {
  memes: {
    id: "memes",
    title: "Memes",
    eyebrow: PERKS_SHARE_CONTENT.memes.eyebrow,
    statsTitle: "Token Stats",
    summary: PERKS_SHARE_CONTENT.memes.summary,
    globalMetrics: [
      { label: "Attention Tokens", value: "128" },
      { label: "Launch Days Skipped", value: "17" },
      { label: "Launch Liquidity", value: "$128K", detail: "Initial liquidity seeded across 128 Attention Token launches." },
      { label: "Airdrop Value Now", value: "$4.86M" },
      { label: "Airdrop Value at ATH", value: "$18.42M" },
      { label: "Combined Token ATH", value: "$312.6M" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Highest Level", value: "2X" },
      { label: "Airdrop Boost", value: "4.5X" },
      { label: "Eligible Launches", value: "46" },
      { label: "Airdrop Value Now", value: "$486" },
      { label: "Airdrop Value at ATH", value: "$1,842" },
      { label: "Best Airdrop Gain", value: "+14,600%" },
    ],
    explorer: {
      title: "Airdrop Explorer",
      description: "Attention Tokens community distribution airdrops.",
      filters: ["All", "Base", "BNB", "Solana", "Robinhood"],
      columns: ["Token", "Chain", "Launchpad", "Airdropped", "MCAP", "ATH"],
      rows: [
        { filter: "Base", cells: ["$BULL10X", "Base", "Clanker", "$278,700", "$1.8M", "$8.4M"], progress: 80, airdropUsd: [31000, 32800, 33700, 34600, 35200, 36100, 37200, 38100, 39000, 40100] },
        { filter: "Solana", cells: ["$TRENCH10X", "Solana", "Pump", "$124,500", "$920K", "$6.1M"], progress: 60, airdropUsd: [18200, 19400, 20100, 21300, 22400, 23100, 24200, 25100, 26300, 27100] },
        { filter: "BNB", cells: ["$BYTE10X", "BNB", "Four", "$178,400", "$2.3M", "$11.2M"], progress: 40, airdropUsd: [42600, 43900, 45100, 46800, 47900, 49200, 50500, 51800, 53200, 54700] },
        { filter: "Robinhood", cells: ["$HOOD10X", "Robinhood", "Pons", "$29,600", "$740K", "$3.9M"], progress: 20, airdropUsd: [14400, 15200, 16100, 16800, 17500, 18300, 19100, 19800, 20700, 21400] },
        { filter: "Base", cells: ["$GREEN10X", "Base", "Clanker", "$853,400", "$4.6M", "$18.7M"], progress: 100, airdropUsd: [72100, 74800, 77900, 80600, 83200, 86100, 89400, 92700, 96400, 100200] },
      ],
    },
    leaderboardMetric: "ATH airdrop",
    explanation: [
      { title: "Survival of the fittest", body: "10X analyses recent onchain volume, momentum and attention across chains, launchpads and social. The market surfaces trending memecoins with potential. The 10X community chooses a meme to launch an Attention Token for — or chooses to skip the day, and let our previous launch run for longer. We're not bound to one chain or one launchpad, we launch where the market is hottest (Solana, Base, Robinhood, BSC, etc) attracting capital & attention from everywhere." },
      { title: "A fourth graduation", body: "Launchpad tokens usually graduate through 3 phases: New → Almost Bonded → Migrated. Only ~1% \"make it\" from tens of thousands of new memecoins launched daily. Often those that migrate still die out too quickly. Attention Tokens can be thought of as a 4th level of graduation. Designed to amplify a meme with incentivised focused attention, rather than seeing it bleed out to hundreds of competing vamps." },
      { title: "Launch liquidity & community airdrops", body: "10X seeds every launch with an initial bonding-curve or AMM purchase. The amount is determined by community vote and available treasury. The acquired tokens are distributed to eligible community members over the following 10 days, with eligibility and boosts influenced by participation, holding 10X assets, supporting previous launches and useful bag work." },
      { title: "Known risk — not no risk", body: "Scheduled launches, community scrutiny and clearer rules aim to reduce unknowns around bundles, snipers and anonymous scam deployers. Stop spending 12-16 hours a day in the PVP memecoin trenches. Instead, join a single daily PVE community-driven fair launch. Attention Tokens remain highly speculative, highly volitile, and can still lose all value... but this game gives you a fighting chance.", callout: "With 10X you can be EARLY to every launch!" },
    ],
  },
  rwas: {
    id: "rwas",
    title: "RWAs",
    eyebrow: PERKS_SHARE_CONTENT.rwas.eyebrow,
    futureTokenId: 9736,
    statsTitle: "Stonk Stats",
    summary: PERKS_SHARE_CONTENT.rwas.summary,
    globalMetrics: [
      { label: "Stonklets", value: "5", detail: "Five unique Stonklet characters across seven chain-local markets." },
      { label: "Stonk Markets", value: "7", detail: "Five BSC markets and two Robinhood markets." },
      { label: "Lifetime Volume", value: "$184.2M" },
      { label: "RWA Rewards", value: "$4.86M", detail: "Illustrative rewards funded for qualifying Stonklet holders. Owning a 10X Warplet alone does not qualify for RWA rewards." },
      { label: "Permanent Liquidity", value: "$3.88M", detail: "$1.94M of Stonklet/RWA liquidity plus $1.94M of Stonklet/10X liquidity." },
      { label: "Burned", value: "$58,320", detail: "Illustrative buy-and-burn value from secondary Stonklet/10X pool fees, modeled at 3% of the $1.94M in 10X liquidity built—not as a share of lifetime volume." },
    ],
    averageTitle: "Average Warplet Holder",
    averageMetrics: [
      { label: "Early Entry", value: "4", detail: "Illustrative Stonklet markets entered early through Warplet notifications and access." },
      { label: "Holdings", value: "$1,000", detail: "Illustrative value of Stonklet holdings acquired through Warplet-enabled early access." },
      { label: "Rewards", value: "$200", detail: "Illustrative rewards on those Stonklet holdings. Warplet ownership alone does not earn RWA rewards." },
      { label: "Yield", value: "20%", detail: "Illustrative rewards divided by the Stonklet holdings value." },
      { label: "Airdrop Boost", value: "6.4X" },
      { label: "Airdrop Value At ATH", value: "$584" },
    ],
    explorer: {
      title: "Stonk Explorer",
      description: "Stonklets compete across multiple chains. Every market has its own volume, liquidity, rewards, and burns. Chain ↔ RWA ↔ Stonklet ↔ 10X reflexive market dynamics.",
      filters: ["All", "BSC", "Robinhood"],
      columns: ["Chain", "Lifetime Volume", "RWA Rewards", "RWA LP", "10X LP", "Burned"],
      rows: [
        {
          filter: "BSC",
          stonklet: { id: "teslalet", name: "Teslalet", ticker: "$TSLA10X", rwaToken: "$TSLAB", tokenId: 3389 },
          cells: ["BSC", "$84.2M", "$1.821M", "$728.4K", "$728.4K", "$21,852"],
        },
        {
          filter: "BSC",
          stonklet: { id: "spacexlet", name: "SpaceXlet", ticker: "$SPACEX10X", rwaToken: "$SPACEXB", tokenId: 5326 },
          cells: ["BSC", "$27.1M", "$690K", "$276K", "$276K", "$8,280"],
        },
        {
          filter: "Robinhood",
          stonklet: { id: "spacexlet", name: "SpaceXlet", ticker: "$SPACEX10X", rwaToken: "$SPACEXX", tokenId: 5326 },
          cells: ["Robinhood", "$16.5M", "$430K", "$172K", "$172K", "$5,160"],
        },
        {
          filter: "BSC",
          stonklet: { id: "nvidialet", name: "Nvidialet", ticker: "$NVDA10X", rwaToken: "$NVDAB", tokenId: 5599 },
          cells: ["BSC", "$26.4M", "$780K", "$312K", "$312K", "$9,360"],
        },
        {
          filter: "BSC",
          stonklet: { id: "googlelet", name: "Googlelet", ticker: "$GOOGL10X", rwaToken: "$GOOGLB", tokenId: 8687 },
          cells: ["BSC", "$17.8M", "$610K", "$244K", "$244K", "$7,320"],
        },
        {
          filter: "BSC",
          stonklet: { id: "hoodlet", name: "Hoodlet", ticker: "$HOOD10X", rwaToken: "$HOODB", tokenId: 5547 },
          cells: ["BSC", "$7.1M", "$307K", "$122.8K", "$122.8K", "$3,684"],
        },
        {
          filter: "Robinhood",
          stonklet: { id: "hoodlet", name: "Hoodlet", ticker: "$HOOD10X", rwaToken: "$HOODX", tokenId: 5547 },
          cells: ["Robinhood", "$5.1M", "$222K", "$88.8K", "$88.8K", "$2,664"],
        },
      ],
    },
    leaderboardMetric: "RWA Rewards",
    explanation: [
      { title: "Built for Risk. Grounded in Reality.", body: "Gen Z are entering markets after decades of compounding has already created enormous wealth for earlier generations. Stonklets are built for a new generation willing to take more risk in search of asymmetric upside ...while staying grounded in longer-term exposure to real-world value." },
      { title: "Meme Stonks, not Stocks", body: "A Stonklet is an independent memecoin associated with a major real-world asset. It does not represent, track or redeem for the stock. Specialist infrastructure handles tokenized asset exposure; 10X builds the character, incentives and attention market around it. Each Stonklet has a primary Stonklet/$RWA market and a secondary Stonklet/$10X market." },
      { title: "Tax: 1% in, 5% out", body: "Buying has a low friction 1% tax. Holding has no additional transaction tax and qualifying holders can earn RWA rewards. Selling contributes more heavily to the flywheel with a 5% tax: paper hands feed diamond hands. 50% of tax revenue funds tokenized-asset rewards for qualifying holders." },
      { title: "Volume compounds", body: "Trading activity progressively strengthens the market. 20% of tax revenue builds permanent Stonklet/$RWA liquidity and 20% builds permanent Stonklet/$10X liquidity. As volume grows, surviving Stonklets deepen their liquidity and can strengthen the wider 10X ecosystem through $10X buying, pairing and burns." },
      { title: "One character. Many markets.", body: "The same Stonklet can exist independently across multiple chains, while each market keeps its own contract, liquidity, volume, rewards, and burns. Holding 10X Warplets does not earn you RWA rewards, but you do get early New Stonk Market launch alerts, boosted airdrops and indirect $10X ecosystem exposure." },
      { title: "Your Turn to Be Early", body: "The underlying assets may already be worth billions or trillions. The Stonklet market starts at zero. A new attention economy, new liquidity and a new opportunity to participate from the beginning.", callout: "Reset the market. Be early." },
    ],
  },
  nfts: {
    id: "nfts",
    title: "NFTs",
    eyebrow: PERKS_SHARE_CONTENT.nfts.eyebrow,
    statsTitle: "Season Stats",
    summary: PERKS_SHARE_CONTENT.nfts.summary,
    globalMetrics: [
      { label: "Seasons", value: "12" },
      { label: "NFTs Minted", value: "120,000" },
      { label: "Upgrades Completed", value: "38,420" },
      { label: "Whitelist Savings", value: "$1.08M" },
      { label: "Combined ATH Floor", value: "$1.52M", detail: "Illustrative peak-floor value, not realized profit." },
      { label: "Perk Months", value: "314,500" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Season Mints", value: "12" },
      { label: "Upgrades", value: "5" },
      { label: "Mint Spend", value: "$12" },
      { label: "Whitelist Savings", value: "$108" },
      { label: "Combined ATH Floor", value: "$152" },
      { label: "Perk Months", value: "32" },
    ],
    explorer: {
      title: "Season Explorer",
      description: "Select a season to compare mint price, peak floor and community activity.",
      filters: ["S12", "S11", "S10", "S9", "S8", "S7", "S6", "S5", "S4", "S3", "S2", "S1"],
      columns: ["Season", "Mint", "Peak", "Multiple", "Owners (Unique)", "Total Volume", "Upgrades", "Leading Tribe", "$1B NFT"],
      rows: Array.from({ length: 12 }, (_, index) => {
        const season = 12 - index;
        const peak = 8.4 + season * 3.32;
        const seasonTokens: Record<number, string> = {
          1: "BTC",
          2: "ETH",
          3: "UNI",
          4: "SOL",
          5: "10X",
          6: "BTC",
          7: "10X",
          8: "10X",
          9: "ETH",
          10: "SOL",
          11: "SOL",
          12: "ANSEM",
        };
        const leadingToken = seasonTokens[season];
        const ownerCount = 2_645 + season * 40;
        const ownerPercentage = Math.round((ownerCount / 10_000) * 100);
        const totalVolume = 61_452 + season * 5_167;
        return {
          filter: `S${season}`,
          cells: [
            `Season ${season}`,
            "$1.00",
            `$${peak.toFixed(2)}`,
            `${peak.toFixed(1)}X`,
            `${ownerCount.toLocaleString("en-US")} (${ownerPercentage}%)`,
            `$${totalVolume.toLocaleString("en-US")}`,
            (2180 + season * 171).toLocaleString("en-US"),
            `$${leadingToken}`,
            `$${(18 + season * 2.4).toFixed(1)}K`,
          ],
          imageSrc: `/perks/s${season}_${leadingToken.toLowerCase()}.jpg`,
        };
      }),
    },
    leaderboardMetric: "Combined ATH Floor",
    explanation: [
      { title: "A new Season every month", body: "Each 10X Season contains 10,000 NFTs on Ethereum, dropped via OpenSea, for maximum volume & attention. 10X Warplet holders get whitelist entry at the best price. Season NFTs have only one trait (\"Level\"), and it follows the same exponential 1X–10X rarity pattern as 10X Warplets. 10X = 10 NFTs, 9X = 20, 8X = 40, ... 1X = 4,890! Higher levels boost your perks." },
      { title: "Upgrade and re-roll", body: "Combine two NFTs at the same Level to upgrade your NFT. One is guaranteed to rise by one Level while the other re-rolls across the full rarity distribution, creating a small chance of a much rarer result. Example: Combine two Level 3X NFTs, it upgrades one to Level 4X and the other re-rolls and could result in a Level 1X... or 2X... or 6X... or 10X! (if you're lucky)" },
      { title: "Benefits that compound", body: "An NFT's Level remains active for the same number of months: 10X for ten months through 1X for one month. Active Levels can improve launch whitelists, airdrop boosts, AI compute, attention and network access. NFTs are upgrade material, tribe territory, and benefit boosters — gamifying utility and status." },
      { title: "Owner-directed attention", body: "Owners claim their NFT in our mini app and choose a token tribe to support. This sets their NFT name, description, image and URL to drive attention to a crypto project. Tribes battle to control more NFTs and higher levels. Matching choices combine into larger logo realestate on a final 10,000 × 10,000 pixel Season canvas that becomes the $1B NFT." },
      { title: "The $1B NFT", body: "The completed Season canvas is Dutch-auctioned as a sponsorship asset, starting at $1B and rapidly dropping over 30 days. Its owner receives twelve months of promotion across the future 10X network. Proceeds from the sale fuel more 10X ecosystem growth and perks.", callout: "Every month, crypto's hottest tokens are minted into history." },
    ],
  },
  ai: {
    id: "ai",
    title: "AI",
    eyebrow: PERKS_SHARE_CONTENT.ai.eyebrow,
    statsTitle: "Builder Stats",
    summary: PERKS_SHARE_CONTENT.ai.summary,
    globalMetrics: [
      { label: "Sponsored AI", value: "$420K" },
      { label: "Credits Consumed", value: "$397K" },
      { label: "Builders Supported", value: "1,842" },
      { label: "Projects Shipped", value: "286" },
      { label: "Tools Available", value: "16" },
      { label: "Credit Utilization", value: "94.5%" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Sponsored AI", value: "$228" },
      { label: "Credits Used", value: "$197" },
      { label: "Credits Remaining", value: "$31" },
      { label: "Model Tokens", value: "22.4M" },
      { label: "Image / Video Jobs", value: "31" },
      { label: "Projects Shipped", value: "1" },
    ],
    explorer: {
      title: "Compute Explorer",
      description: "AI allocation and output across the tools community members use.",
      filters: ["All", "Coding", "Image", "Video", "Private"],
      columns: ["Category", "Sponsored", "Used", "Members", "Tools", "Output"],
      rows: [
        {
          filter: "Coding",
          cells: ["Coding", "$180K", "96%", "812", "4", "114 apps"],
          toolBadges: [
            { name: "Codex", logoSrc: "/perks/ai-tools/codex.svg", tagline: "Build and ship with an AI coding agent." },
            { name: "Claude Code", logoSrc: "/perks/ai-tools/claude-code.svg", tagline: "Delegate complex work across your codebase." },
            { name: "Cursor", logoSrc: "/perks/ai-tools/cursor.svg", tagline: "Bring AI-native editing into your workflow." },
            { name: "GitHub Copilot", logoSrc: "/perks/ai-tools/github-copilot.svg", tagline: "Pair-program across code, reviews and CLI." },
          ],
        },
        {
          filter: "Image",
          cells: ["Image", "$90K", "94%", "744", "4", "48K images"],
          toolBadges: [
            { name: "Midjourney", logoSrc: "/perks/ai-tools/midjourney-sailboat.png", tagline: "Create high-impact visual concepts.", invertLogo: true },
            { name: "Adobe Firefly", logoSrc: "/perks/ai-tools/adobe-firefly-official.png", tagline: "Generate production-ready creative assets." },
            { name: "Ideogram", logoSrc: "/perks/ai-tools/ideogram.png", tagline: "Design images with strong text rendering." },
            { name: "Leonardo.Ai", logoSrc: "/perks/ai-tools/leonardo-ai.png", tagline: "Produce and refine creator-ready artwork." },
          ],
        },
        {
          filter: "Video",
          cells: ["Video", "$75K", "89%", "318", "4", "6,420 clips"],
          toolBadges: [
            { name: "Runway", logoSrc: "/perks/ai-tools/runway.png", tagline: "Generate and edit cinematic video.", invertLogo: true },
            { name: "Kling AI", logoSrc: "/perks/ai-tools/kling-ai.png", tagline: "Create expressive motion from prompts." },
            { name: "Google Veo", logoSrc: "/perks/ai-tools/google-veo.png", tagline: "Build high-fidelity video with native audio." },
            { name: "OpenAI Sora", logoSrc: "/perks/ai-tools/openai-sora.svg", tagline: "Turn ideas into polished video scenes." },
          ],
        },
        {
          filter: "Private",
          cells: ["Private", "$75K", "98%", "410", "4", "9.1B tokens"],
          toolBadges: [
            { name: "Venice.ai", logoSrc: "/perks/ai-tools/venice-ai.png", tagline: "Create with private, uncensored inference.", invertLogo: true },
            { name: "Proton Lumo", logoSrc: "/perks/ai-tools/proton-lumo.png", tagline: "Keep sensitive AI work confidential.", invertLogo: true },
            { name: "Duck.ai", logoSrc: "/perks/ai-tools/duck-ai.svg", tagline: "Use multiple AI models with added privacy." },
            { name: "Ollama", logoSrc: "/perks/ai-tools/ollama.svg", tagline: "Run open models locally on your hardware." },
          ],
        },
      ],
    },
    leaderboardMetric: "sponsored AI",
    explanation: [
      { title: "Runway instead of one-off grants", body: "10X can sponsor practical AI access for builders and creators, reducing recurring costs and helping community projects move faster for longer. AI is the most impactful leverage we can provide to 10X your progress!" },
      { title: "Shared access with fair limits", body: "Organization plans, partner packages and onchain inference credits would use per-member allowances so support reaches more people while scaling with ecosystem revenue." },
      { title: "Tools for every kind of creator", body: "Potential categories include coding, research, image and video production, plus privacy-focused inference. Provider examples are exploratory; no partnership is implied." },
      { title: "Celebrate shipping", body: "Project showcases connect sponsored compute to shipped tools, content and experiments around 10X and the wider Farcaster ecosystem. We're creating an army of bag workers and builders, amplified by AI!", callout: "Intelligence is the ultimate engine for progress." },
    ],
  },
  attention: {
    id: "attention",
    title: "Attention",
    eyebrow: PERKS_SHARE_CONTENT.attention.eyebrow,
    statsTitle: "Distribution Stats",
    summary: PERKS_SHARE_CONTENT.attention.summary,
    globalMetrics: [
      { label: "Impressions", value: "94.2M" },
      { label: "Engagements", value: "6.8M" },
      { label: "Posts Promoted", value: "24,800" },
      { label: "Verified Actions", value: "3.1M" },
      { label: "Engagement Rate", value: "7.2%" },
      { label: "Airdrops Unlocked", value: "$3.64M" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Posts", value: "3" },
      { label: "Impressions", value: "9,420" },
      { label: "Engagement", value: "680" },
      { label: "Engagement Rate", value: "7.2%" },
      { label: "Feed Rank", value: "#500" },
      { label: "Daily Airdrop", value: "$3.64" },
    ],
    explorer: {
      title: "Attention Explorer",
      description: "Focused-feed activity and progressive unlocks.",
      filters: [...ATTENTION_CHART_PERIODS],
      columns: ["Range", "Impressions", "Engagements", "Posts", "Actions", "Unlock"],
      rows: [
        { filter: "All", cells: ["All Time", "94.2M", "6.8M", "24,800", "3.1M", "78%"], progress: 78 },
        { filter: "7D", cells: ["7 Days", "2.8M", "246K", "1,920", "118K", "82%"], progress: 82 },
        { filter: "30D", cells: ["30 Days", "14.6M", "1.1M", "7,430", "510K", "79%"], progress: 79 },
        { filter: "90D", cells: ["90 Days", "35.8M", "2.7M", "13,900", "1.22M", "78%"], progress: 78 },
        { filter: "1Y", cells: ["1 Year", "76.4M", "5.5M", "22,100", "2.51M", "78%"], progress: 78 },
      ],
    },
    leaderboardMetric: "impressions",
    explanation: [
      { title: "One daily post. One focused feed.", body: "Community members can publish one thing per day into a Farcaster-powered feed designed to concentrate discovery rather than scatter it across thousands of timelines. Driving DAUs onto Farcaster, a builder-first, crypto-native social platform — where CT really belongs." },
      { title: "Earn attention through contribution", body: "Holdings and Levels can boost ranking, while useful bag work—likes, comments, quotes, shares and original creation—helps strong community members travel further. We win by working together." },
      { title: "Scroll to unlock", body: "The daily Attention Token airdrop unlocks progressively while members explore the feed. Meaningful interactions can accelerate progress without turning the experience into a passive faucet... Scroll-to-Earn, and engage to earn faster!" },
      { title: "Distribution beyond the feed", body: "We're building \"one feed to rule them all\"! The homepage for crypto, where news breaks, alpha drops and new KOLs are minted. Content starts in the 10X feed and spreads virally out to larger platforms. Popular community posts receive broader promotion through the 10X network.", callout: "D.R.E.A.M: Distribution rules everything around me... attention is king." },
    ],
  },
  alpha: {
    id: "alpha",
    title: "Alpha",
    eyebrow: PERKS_SHARE_CONTENT.alpha.eyebrow,
    statsTitle: "Network Stats",
    summary: PERKS_SHARE_CONTENT.alpha.summary,
    globalMetrics: [
      { label: "Members", value: "37,420" },
      { label: "Chains Represented", value: "6" },
      { label: "Coins Reviewed", value: "1,460" },
      { label: "Community Votes", value: "682K" },
      { label: "Signals Promoted", value: "410" },
      { label: "Median Call Move", value: "+138%", detail: "Illustrative mock performance, not a forecast." },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Coins Reviewed", value: "146" },
      { label: "Votes Cast", value: "68" },
      { label: "Signals Backed", value: "14" },
      { label: "PnL %", value: "+38%" },
      { label: "Community Score", value: "670" },
      { label: "Voting Influence", value: "1.69X" },
    ],
    explorer: {
      title: "Signal Explorer",
      description: "Cross-chain intelligence, community decisions and subsequent market movement.",
      filters: ["All", "Ethereum", "Base", "Solana", "BNB", "Robinhood", "Hyperliquid"],
      columns: ["Coin", "Chain", "Momentum", "Vote", "Decision", "Move"],
      rows: [
        { filter: "Base", cells: ["$GREEN", "Base", "96", "84%", "Launch", "+1,842%"], priceHistory: [20, 19, 22, 18, 21, 24, 23, 26, 31, 48, 95, 408], callIndex: 4 },
        { filter: "Solana", cells: ["$DEEP", "Solana", "91", "71%", "Watch", "+386%"], priceHistory: [30, 12, 55, 21, 26, 33, 29, 61, 44, 70, 65, 126], callIndex: 4 },
        { filter: "BNB", cells: ["$FOUR", "BNB", "88", "77%", "Launch", "-45%"], priceHistory: [18, 24, 15, 28, 22, 19, 14, 17, 11, 13, 8, 12], callIndex: 4 },
        { filter: "Ethereum", cells: ["$MAIN", "Ethereum", "83", "65%", "Skip", "-68%"], priceHistory: [68, 72, 66, 75, 70, 50, 58, 36, 42, 25, 29, 22], callIndex: 4 },
        { filter: "Robinhood", cells: ["$BELL", "Robinhood", "79", "69%", "Watch", "+241%"], priceHistory: [15, 18, 17, 20, 19, 37, 35, 36, 58, 55, 78, 65], callIndex: 4 },
        { filter: "Hyperliquid", cells: ["$HYPE", "Hyperliquid", "86", "73%", "Launch", "+612%"], priceHistory: [20, 60, 15, 80, 23, 110, 42, 150, 61, 140, 90, 164], callIndex: 4 },
      ],
    },
    leaderboardMetric: "community score",
    explanation: [
      { title: "Cross-chain common ground", body: "The 10X Network brings Base, Solana, BNB, Ethereum, Robinhood and emerging ecosystems into one Farcaster-native community.\n\nToken Tribes... without Chain-Tribalism.\nBag Workers... without Mob Mentality.\nProject Believers... without Exit Shaming.\n\nWe're here to build, trade, take profits and have fun!" },
      { title: "See coins early", body: "Members can review the daily market-analysis shortlist and influence whether 10X launches or skips (to let a runner continue running). The Network also votes on Listing Liquidity for the 10X Airdrop, plus the Chain and Launchpad based on where the market is hottest." },
      { title: "Alpha that can renew", body: "10X Warplets provide the founding network while future Season NFTs offer entry points for new members and perks boosts for existing members. Higher Levels can shape voting influence and unlock VIP areas." },
      { title: "Uniting builders and traders", body: "Builders need Traders. Traders need Builders. The Network is designed to connect people who create, distribute, collect, trade and fund crazy ideas — online first, with future IRL experiences as the treasury grows.", callout: "10X your crypto crew!" },
    ],
  },
};
