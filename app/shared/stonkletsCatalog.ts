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
  ["spacex", "SpaceX", "SPCXB", "ORBIT 轨道 10X.MEME", "ORBIT10X", "available", "SpaceX-Orbit.webp"],
  ["sk-hynix", "SK Hynix", "SKHYB", "BYTE 字节 10X.MEME", "BYTE10X", "available", "SK hynix-Byte.webp"],
  ["spy", "SPY", "SPYB", "SPIDER 蜘蛛 10X.MEME", "SPIDER10X", "available", "SPDR S&P 500 ETF-Spider.webp"],
  ["tether-gold", "Tether Gold", "XAUT", "NUGGET 金块 10X.MEME", "NUGGET10X", "available", "Tether Gold-Nugget.webp"],
  ["invesco-qqq", "Invesco QQQ Trust", "QQQB", "QUANTA 量子 10X.MEME", "QUANTA10X", "available", "Invesco QQQ Trust-Quanta.webp"],
  ["nvidia", "NVIDIA", "NVDAB", "CHIP 芯片 10X.MEME", "CHIP10X", "available", "NVIDIA-Chip.webp"],
  ["apple", "Apple", "AAPLB", "CORE 核心 10X.MEME", "CORE10X", "available", "Apple-Core.webp"],
  ["tesla", "Tesla", "TSLAB", "VOLT 伏特 10X.MEME", "VOLT10X", "available", "Tesla-Volt.webp"],
  ["microsoft", "Microsoft", "MSFTB", "CLOUD 云 10X.MEME", "CLOUD10X", "available", "Microsoft-Cloud.webp"],
  ["alphabet", "Alphabet", "GOOGLB", "SCOUT 搜索 10X.MEME", "SCOUT10X", "available", "AlphabetGoogle-Scout.webp"],
  ["robinhood", "Robinhood", "HOODB", "ARROW 箭 10X.MEME", "ARROW10X", "available", "Robinhood-Arrow.webp"],
  ["alibaba", "Alibaba", "BABAB", "BAZAAR 集市 10X.MEME", "BAZAAR10X", "available", "Alibaba-Bazaar.webp"],
  ["gamestop", "GameStop", "GMEB", "PLAYER 玩家 10X.MEME", "PLAYER10X", "available", "GameStop-Player.webp"],
  ["netflix", "Netflix", "NFLXB", "BINGE 刷剧 10X.MEME", "BINGE10X", "available", "Netflix-Binge.webp"],
  ["strategy", "Strategy", "MSTRB", "STACK 堆叠 10X.MEME", "STACK10X", "available", "Strategy-Stack.webp"],
  ["trump-media", "Trump Media & Technology Group", "DJTB", "YUGE 巨 10X.MEME", "YUGE10X", "available", "Trump Media Technology Group-Echo.webp"],
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
  ["direxion-soxs", "Semis 3× Short", "SOXSB", "BEAR 熊 10X.MEME", "BEAR10X", "available", "Direxion Daily Semiconductor Bear 3X ETF-Bear.webp"],
  ["dell", "Dell", "DELLB", "Rig", "RIG", "upcoming", "Dell Technologies-Rig.webp"],
  ["fluence", "Fluence Energy", "FLNCB", "CHARGE 充电 10X.MEME", "CHARGE10X", "available", "Fluence Energy-Charge.webp"],
  ["applied-materials", "Applied Materials", "AMATB", "Fab", "FAB", "upcoming", "Applied Materials-Fab.webp"],
  ["direxion-soxl", "Semis 3× Long", "SOXLB", "BULL 牛 10X.MEME", "BULL10X", "available", "Direxion Daily Semiconductor Bull 3X ETF-Bull.webp"],
  ["moderna", "Moderna", "MRNAB", "DEALER 药商 10X.MEME", "DEALER10X", "available", "Moderna-Dealer.webp"],
  ["paypal", "PayPal", "PYPLB", "Bro", "BRO", "upcoming", "PayPal Holdings-Bro.webp"],
  ["proshares-sqqq", "ProShares UltraPro Short QQQ", "SQQQB", "NASBEAR", "NASBEAR", "upcoming", "ProShares UltraPro Short QQQ-NASDAQ Bear.webp"],
] as const;

export const STONKLETS_CATALOG: readonly StonkletCatalogEntry[] = rows.map((row) => {
  const [id, stockName, stockSymbol, stonkletName, stonkletSymbol, pairingStatus, imageFile] = row;
  const address = STONKLET_TRADE_DESTINATIONS[id];
  const marketToken: FlapDemoToken | null = address ? {
    name: stonkletName, symbol: stonkletSymbol, contractAddress: address as `0x${string}`,
    expectedLifecycle: "bonding", poolAddress: null, quoteSymbol: stockSymbol, chartTokenSide: null,
    flapUrl: `https://flap.sh/bnb/${address}?lang=en`,
  } : null;
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
      contractAddress: STONKLET_TRADE_DESTINATIONS[id] ?? null,
      image: `/stonklets/stonklets/${encodeURI(imageFile)}`,
    },
    launchStatus: STONKLET_TRADE_DESTINATIONS[id] ? "launched" : "prelaunch",
    flapUrl: marketToken?.flapUrl ?? "https://flap.sh/",
    launchedAt: null,
    demoToken: marketToken,
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
