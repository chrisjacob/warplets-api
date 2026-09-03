export type StonkletPairingStatus = "available" | "upcoming";
export type StonkletLaunchStatus = "prelaunch" | "launched";
export type MarketDataStatus = "live" | "stale" | "unavailable";
export type FlapDemoLifecycle = "bonding" | "migrated";

export interface FlapDemoToken {
  name: string;
  symbol: string;
  contractAddress: `0x${string}`;
  expectedLifecycle: FlapDemoLifecycle;
  poolAddress: `0x${string}` | null;
  quoteSymbol: string;
  chartTokenSide: "base" | "quote" | null;
  flapUrl: string;
}

export interface StonkletCatalogEntry {
  id: string;
  stock: { name: string; symbol: string; contractAddress: string | null; logo: string };
  pairingStatus: StonkletPairingStatus;
  stonklet: { name: string; symbol: string; contractAddress: string | null; image: string };
  launchStatus: StonkletLaunchStatus;
  flapUrl: string;
  launchedAt: string | null;
  demoToken: FlapDemoToken | null;
}

export interface StonkletDemoMarketState {
  lifecycle: FlapDemoLifecycle;
  progress: number | null;
  poolAddress: string | null;
  quoteTokenAddress: string | null;
  provider: "flap-onchain" | "flap+dexpaprika";
  updatedAt: string | null;
  status: MarketDataStatus;
}

export interface MarketMetrics {
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  holders: number | null;
  liquidity: number | null;
  change5m: number | null;
  change1h: number | null;
  change4h: number | null;
  change24h: number | null;
  updatedAt: string | null;
  status: MarketDataStatus;
}

const imageIds = [709, 134, 3873, 1955, 760, 5019, 2844, 936, 2601, 414, 3210, 1777, 2280, 608, 3644, 1210, 4021, 877, 1538, 3088, 2721, 468, 3311, 1904, 811, 2402, 1129, 3720, 159, 2965, 1317, 4433, 652, 2156, 3491, 995, 4077, 1822, 2514, 522] as const;

const rows = [
  ["spacex", "SpaceX", "SPCXB", "Orbit", "ORBIT", "available"],
  ["sk-hynix", "SK Hynix", "SKHYB", "Byte", "BYTE", "available"],
  ["spy", "SPY", "SPYB", "Scout", "SCOUT", "available"],
  ["tether-gold", "Tether Gold", "XAUT", "Gild", "GILD", "available"],
  ["invesco-qqq", "Invesco QQQ Trust", "QQQB", "Quanta", "QUANTA", "available"],
  ["nvidia", "NVIDIA", "NVDAB", "Chip", "CHIP", "available"],
  ["apple", "Apple", "AAPLB", "Core", "CORE", "available"],
  ["tesla", "Tesla", "TSLAB", "Volt", "VOLT", "available"],
  ["microsoft", "Microsoft", "MSFTB", "Macro", "MACRO", "available"],
  ["alphabet", "Alphabet", "GOOGLB", "Letter", "LETTER", "available"],
  ["robinhood", "Robinhood", "HOODB", "Arrow", "ARROW", "available"],
  ["alibaba", "Alibaba", "BABAB", "Bazaar", "BAZR", "available"],
  ["gamestop", "GameStop", "GMEB", "Respawn", "RSPWN", "available"],
  ["netflix", "Netflix", "NFLXB", "Binge", "BINGE", "available"],
  ["strategy", "Strategy", "MSTRB", "Stack", "STACK", "available"],
  ["trump-media", "Trump Media & Technology Group", "DJTB", "Signal", "SIGNL", "available"],
  ["bitmine", "BitMine Immersion Technologies", "BMNRB", "Miner", "MINER", "upcoming"],
  ["super-micro", "Super Micro Computer", "SMCIB", "Rack", "RACK", "upcoming"],
  ["iren", "IREN", "IRENB", "Hydro", "HYDRO", "upcoming"],
  ["asml", "ASML", "ASMLB", "Etch", "ETCH", "upcoming"],
  ["ast-spacemobile", "AST SpaceMobile", "ASTSB", "Beacon", "BEACON", "upcoming"],
  ["coherent", "Coherent", "COHRB", "Photon", "PHOTON", "upcoming"],
  ["credo", "Credo Technology", "CRDOB", "Lane", "LANE", "upcoming"],
  ["usa-rare-earth", "USA Rare Earth", "USARB", "Ore", "ORE", "upcoming"],
  ["astera-labs", "Astera Labs", "ALABB", "Fabric", "FABRIC", "upcoming"],
  ["circle", "Circle", "CRCLB", "Halo", "HALO", "upcoming"],
  ["micron", "Micron", "MUB", "Bitty", "BITTY", "upcoming"],
  ["sandisk", "Sandisk", "SNDKB", "Flash", "FLASH", "upcoming"],
  ["amd", "Advanced Micro Devices", "AMDB", "Ember", "EMBER", "upcoming"],
  ["ishares-korea", "iShares MSCI South Korea ETF", "EWYB", "Seoul", "SEOUL", "upcoming"],
  ["intel", "Intel", "INTCB", "Logic", "LOGIC", "upcoming"],
  ["lumentum", "Lumentum", "LITEB", "Beam", "BEAM", "upcoming"],
  ["meta", "Meta", "METAB", "Realm", "REALM", "upcoming"],
  ["palantir", "Palantir", "PLTRB", "Seer", "SEER", "upcoming"],
  ["bloom-energy", "Bloom Energy", "BEB", "Spark", "SPARK", "upcoming"],
  ["amazon", "Amazon", "AMZNB", "Parcel", "PARCEL", "upcoming"],
  ["direxion-soxs", "Direxion Semiconductor Bear 3X ETF", "SOXSB", "Shorty", "SHORTY", "upcoming"],
  ["dell", "Dell", "DELLB", "Boxy", "BOXY", "upcoming"],
  ["fluence", "Fluence Energy", "FLNCB", "Grid", "GRID", "upcoming"],
  ["applied-materials", "Applied Materials", "AMATB", "Wafer", "WAFER", "upcoming"],
] as const;

const suppliedCharacterPaths: Record<string, string> = {
  orbit: "/stonklets/orbit.png",
  chip: "/stonklets/chip.png",
  core: "/stonklets/core.png",
  volt: "/stonklets/volt.png",
};

// These are real, third-party Flap launches used only as live product-demo
// proxies. They are deliberately kept separate from the official Stonklet CA,
// which remains null until a 10X contract is launched.
const demoTokens: Partial<Record<string, FlapDemoToken>> = {
  spacex: {
    name: "MarsCoin",
    symbol: "MarsCoin",
    contractAddress: "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777",
    expectedLifecycle: "migrated",
    poolAddress: "0x94F3ed36706c746ad59fAdCAF271b7431AB1D8F1",
    quoteSymbol: "SPCXB",
    chartTokenSide: "quote",
    flapUrl: "https://flap.sh/bnb/0xfe189e97832da1573e4e4ff034f4ffc3a15c7777?lang=en",
  },
  nvidia: {
    name: "RWA",
    symbol: "RWA",
    contractAddress: "0x5675bd4ac800068a147ebc9aeb464ff9fc167777",
    expectedLifecycle: "migrated",
    poolAddress: "0xA32a88D989f1Ffa67000fCBB7E2BD864F68FFc0a",
    quoteSymbol: "WBNB",
    chartTokenSide: "base",
    flapUrl: "https://flap.sh/bnb/0x5675bd4ac800068a147ebc9aeb464ff9fc167777?lang=en",
  },
  apple: {
    name: "Bear On Moon",
    symbol: "BOM",
    contractAddress: "0x8c7b8f21b0faf2879720a8951fdacc3c4b987777",
    expectedLifecycle: "bonding",
    poolAddress: null,
    quoteSymbol: "BNB",
    chartTokenSide: null,
    flapUrl: "https://flap.sh/bnb/0x8c7b8f21b0faf2879720a8951fdacc3c4b987777?lang=en",
  },
  tesla: {
    name: "FLAPGOTCHI",
    symbol: "FLAPGOTCHI",
    contractAddress: "0x10e4f3f1ea55c465f2bb7d36cdd7ea390c867777",
    expectedLifecycle: "bonding",
    poolAddress: null,
    quoteSymbol: "BNB",
    chartTokenSide: null,
    flapUrl: "https://flap.sh/bnb/0x10e4f3f1ea55c465f2bb7d36cdd7ea390c867777?lang=en",
  },
};

export const STONKLETS_CATALOG: readonly StonkletCatalogEntry[] = rows.map((row, index) => {
  const [id, stockName, stockSymbol, stonkletName, stonkletSymbol, pairingStatus] = row;
  const characterKey = stonkletName.toLowerCase();
  return {
    id,
    stock: {
      name: stockName,
      symbol: stockSymbol,
      contractAddress: null,
      logo: `/stonklets/stocks/${id}.png`,
    },
    pairingStatus,
    stonklet: {
      name: stonkletName,
      symbol: stonkletSymbol,
      contractAddress: null,
      image: suppliedCharacterPaths[characterKey] ?? `https://warplets.10x.meme/${imageIds[index]}.jpg`,
    },
    launchStatus: "prelaunch",
    flapUrl: "https://flap.sh/",
    launchedAt: null,
    demoToken: demoTokens[id] ?? null,
  };
});

export const STONKLETS_BY_ID = new Map(STONKLETS_CATALOG.map((entry) => [entry.id, entry]));

export function emptyMarketMetrics(): MarketMetrics {
  return {
    price: null, marketCap: null, volume24h: null, holders: null, liquidity: null,
    change5m: null, change1h: null, change4h: null, change24h: null,
    updatedAt: null, status: "unavailable",
  };
}
