import { VERIFIED_STOCK_CONTRACTS } from "./stonkletsStockContracts";
import { STONKLET_TRADE_DESTINATIONS } from "./stonkletsTrading";

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

const rows = [
  ["spacex", "SpaceX", "SPCXB", "Orbit", "ORBIT", "available", "SpaceX-Orbit.webp"],
  ["sk-hynix", "SK Hynix", "SKHYB", "Byte", "BYTE", "available", "SK hynix-Byte.webp"],
  ["spy", "SPY", "SPYB", "Spider", "SPIDER", "available", "SPDR S&P 500 ETF-Spider.webp"],
  ["tether-gold", "Tether Gold", "XAUT", "Nugget", "NUGGET", "available", "Tether Gold-Nugget.webp"],
  ["invesco-qqq", "Invesco QQQ Trust", "QQQB", "Quanta", "QUANTA", "available", "Invesco QQQ Trust-Quanta.webp"],
  ["nvidia", "NVIDIA", "NVDAB", "Chip", "CHIP", "available", "NVIDIA-Chip.webp"],
  ["apple", "Apple", "AAPLB", "Core", "CORE", "available", "Apple-Core.webp"],
  ["tesla", "Tesla", "TSLAB", "Volt", "VOLT", "available", "Tesla-Volt.webp"],
  ["microsoft", "Microsoft", "MSFTB", "Cloud", "CLOUD", "available", "Microsoft-Cloud.webp"],
  ["alphabet", "Alphabet", "GOOGLB", "Scout", "SCOUT", "available", "AlphabetGoogle-Scout.webp"],
  ["robinhood", "Robinhood", "HOODB", "Arrow", "ARROW", "available", "Robinhood-Arrow.webp"],
  ["alibaba", "Alibaba", "BABAB", "Bazaar", "BAZAAR", "available", "Alibaba-Bazaar.webp"],
  ["gamestop", "GameStop", "GMEB", "Player", "PLAYER", "available", "GameStop-Player.webp"],
  ["netflix", "Netflix", "NFLXB", "Binge", "BINGE", "available", "Netflix-Binge.webp"],
  ["strategy", "Strategy", "MSTRB", "Stack", "STACK", "available", "Strategy-Stack.webp"],
  ["trump-media", "Trump Media & Technology Group", "DJTB", "YUGE", "YUGE", "available", "Trump Media Technology Group-Echo.webp"],
  ["bitmine", "BitMine Immersion Technologies", "BMNRB", "Vault", "VAULT", "upcoming", "BitMine Immersion Technologies-Vault.webp"],
  ["super-micro", "Super Micro Computer", "SMCIB", "Rack", "RACK", "upcoming", "Super Micro Computer-Rack.webp"],
  ["iren", "IREN", "IRENB", "Grid", "GRID", "upcoming", "IREN-Grid.webp"],
  ["asml", "ASML", "ASMLB", "Lens", "LENS", "upcoming", "ASML-Lens.webp"],
  ["ast-spacemobile", "AST SpaceMobile", "ASTSB", "Signal", "SIGNAL", "upcoming", "AST SpaceMobile-Signal.webp"],
  ["coherent", "Coherent", "COHRB", "Laser", "LASER", "upcoming", "Coherent-Laser.webp"],
  ["credo", "Credo Technology", "CRDOB", "Link", "LINK", "upcoming", "Credo Technology-Link.webp"],
  ["usa-rare-earth", "USA Rare Earth", "USARB", "Magnet", "MAGNET", "upcoming", "USA Rare Earth-Magnet.webp"],
  ["astera-labs", "Astera Labs", "ALABB", "Fabric", "FABRIC", "upcoming", "Astera Labs-Fabric.webp"],
  ["circle", "Circle", "CRCLB", "Mint", "MINT", "upcoming", "Circle Internet Group-Mint.webp"],
  ["micron", "Micron", "MUB", "Memory", "MEMORY", "upcoming", "Micron Technology-Memory.webp"],
  ["sandisk", "Sandisk", "SNDKB", "Flash", "FLASH", "upcoming", "Sandisk-Flash.webp"],
  ["amd", "Advanced Micro Devices", "AMDB", "Compute", "COMPUTE", "upcoming", "Advanced Micro Devices-Compute.webp"],
  ["ishares-korea", "iShares MSCI South Korea ETF", "EWYB", "Seoul", "SEOUL", "upcoming", "iShares MSCI South Korea ETF-Seoul.webp"],
  ["intel", "Intel", "INTCB", "Silicon", "SILICON", "upcoming", "Intel-Silicon.webp"],
  ["lumentum", "Lumentum", "LITEB", "Photon", "PHOTON", "upcoming", "Lumentum-Photon.webp"],
  ["meta", "Meta", "METAB", "Verse", "VERSE", "upcoming", "Meta Platforms-Verse.webp"],
  ["palantir", "Palantir", "PLTRB", "Oracle", "ORACLE", "upcoming", "Palantir Technologies-Oracle.webp"],
  ["bloom-energy", "Bloom Energy", "BEB", "Cell", "CELL", "upcoming", "Bloom Energy-Cell.webp"],
  ["amazon", "Amazon", "AMZNB", "Parcel", "PARCEL", "upcoming", "Amazon-Parcel.webp"],
  ["direxion-soxs", "Semis 3× Short", "SOXSB", "Bear", "BEAR", "available", "Direxion Daily Semiconductor Bear 3X ETF-Bear.webp"],
  ["dell", "Dell", "DELLB", "Rig", "RIG", "upcoming", "Dell Technologies-Rig.webp"],
  ["fluence", "Fluence Energy", "FLNCB", "Charge", "CHARGE", "available", "Fluence Energy-Charge.webp"],
  ["applied-materials", "Applied Materials", "AMATB", "Fab", "FAB", "upcoming", "Applied Materials-Fab.webp"],
  ["direxion-soxl", "Semis 3× Long", "SOXLB", "Bull", "BULL", "available", "Direxion Daily Semiconductor Bull 3X ETF-Bull.webp"],
  ["moderna", "Moderna", "MRNAB", "Dealer", "DEALER", "available", "Moderna-Dealer.webp"],
  ["paypal", "PayPal", "PYPLB", "Bro", "BRO", "upcoming", "PayPal Holdings-Bro.webp"],
  ["proshares-sqqq", "ProShares UltraPro Short QQQ", "SQQQB", "NASDAQ Bear", "NASDAQBEAR", "upcoming", "ProShares UltraPro Short QQQ-NASDAQ Bear.webp"],
] as const;

// These are real, third-party Flap launches used only as live product-demo
// proxies. They are deliberately kept separate from the official Stonklet CA,
// which remains null until a 10X contract is launched.
const demoTokens: Partial<Record<string, FlapDemoToken>> = {
  "direxion-soxl": {
    name: "MarsCoin", symbol: "MarsCoin", contractAddress: "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777",
    expectedLifecycle: "migrated", poolAddress: "0x94F3ed36706c746ad59fAdCAF271b7431AB1D8F1", quoteSymbol: "SPCXB", chartTokenSide: "quote",
    flapUrl: "https://flap.sh/bnb/0xfe189e97832da1573e4e4ff034f4ffc3a15c7777",
  },
  "direxion-soxs": {
    name: "Semicon Bull 3X", symbol: "犇", contractAddress: "0x90f62f81307ebf4ccd0a0510e3391c67b1d17777",
    expectedLifecycle: "migrated", poolAddress: "0xddcfe537686d0909070d6ed41fc9317eaa78bbb3", quoteSymbol: "SOXLB", chartTokenSide: "base",
    flapUrl: "https://flap.sh/bnb/0x90f62f81307ebf4ccd0a0510e3391c67b1d17777",
  },
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

export const STONKLETS_CATALOG: readonly StonkletCatalogEntry[] = rows.map((row) => {
  const [id, stockName, stockSymbol, stonkletName, stonkletSymbol, pairingStatus, imageFile] = row;
  return {
    id,
    stock: {
      name: stockName,
      symbol: stockSymbol,
      contractAddress: VERIFIED_STOCK_CONTRACTS[stockSymbol]?.address ?? null,
      logo: `/stonklets/stocks/${id}.${id === "proshares-sqqq" ? "svg" : "png"}`,
    },
    pairingStatus,
    stonklet: {
      name: stonkletName,
      symbol: stonkletSymbol,
      contractAddress: null,
      image: `/stonklets/stonklets/${encodeURI(imageFile)}`,
    },
    launchStatus: STONKLET_TRADE_DESTINATIONS[id] ? "launched" : "prelaunch",
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
