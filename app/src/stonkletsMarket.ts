import type { MarketMetrics, StonkletCatalogEntry, StonkletDemoMarketState } from "../shared/stonkletsCatalog";

export type StonkletsMarketSide = "stock" | "stonklet";
export type StonkletsOrderKey = "trending" | "marketCap" | "volume24h" | "holders" | "liquidity" | "change" | "favourites" | "az";
export type StonkletsDirection = "asc" | "desc";
export function visibleStonkletsFavourites(stock: Set<string>, stonklet: Set<string>, market: StonkletsMarketSide, single: boolean): Set<string> {
  return single ? market === "stock" ? stock : stonklet : new Set([...stock, ...stonklet]);
}
export interface StonkletsMarketEntry extends StonkletCatalogEntry {
  flapPreview?: boolean;
  stockMetrics: MarketMetrics;
  stonkletMetrics: MarketMetrics;
  stockPeriodChange: number | null;
  stonkletPeriodChange: number | null;
  demoMarket?: StonkletDemoMarketState | null;
  favourites: number;
  momentum7d: number;
  stockFavourites: number;
  stockMomentum7d: number;
}

export function stonkletMetric(entry: StonkletsMarketEntry, market: StonkletsMarketSide, order: StonkletsOrderKey): number | null {
  if (order === "trending") return market === "stock" ? entry.stockMomentum7d : entry.momentum7d;
  if (order === "favourites") return market === "stock" ? entry.stockFavourites : entry.favourites;
  if (order === "az") return null;
  if (order === "change") return market === "stock" ? entry.stockPeriodChange : entry.stonkletPeriodChange;
  return (market === "stock" ? entry.stockMetrics : entry.stonkletMetrics)[order];
}

export function entryMatchesQuery(entry: StonkletsMarketEntry, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return [entry.stock.name, entry.stock.symbol, entry.stock.contractAddress, entry.stonklet.name, entry.stonklet.symbol, entry.stonklet.contractAddress, entry.demoToken?.name, entry.demoToken?.symbol, entry.demoToken?.contractAddress]
    .some((value) => value?.toLowerCase().includes(query));
}

export function filterAndSortStonklets(options: {
  entries: StonkletsMarketEntry[];
  query: string;
  favourites: Set<string>;
  favouritesOnly: boolean;
  market: StonkletsMarketSide;
  order: StonkletsOrderKey;
  direction: StonkletsDirection;
}): StonkletsMarketEntry[] {
  const { entries, query, favourites, favouritesOnly, market, order, direction } = options;
  const queryHasAnyMatch = entries.some((entry) => entryMatchesQuery(entry, query));
  const filtered = entries.filter((entry) => {
    if (favouritesOnly && !favourites.has(entry.id)) return false;
    if (favouritesOnly && !queryHasAnyMatch) return true;
    return entryMatchesQuery(entry, query);
  });
  return [...filtered].sort((a, b) => {
    if (order === "az") {
      const compared = (market === "stock" ? a.stock.name : a.stonklet.name).localeCompare(market === "stock" ? b.stock.name : b.stonklet.name);
      return compared * (direction === "asc" ? 1 : -1);
    }
    const av = stonkletMetric(a, market, order), bv = stonkletMetric(b, market, order);
    if (av == null && bv != null) return 1;
    if (av != null && bv == null) return -1;
    const delta = (av ?? 0) - (bv ?? 0);
    if (delta) return delta * (direction === "asc" ? 1 : -1);
    const aFavourites = market === "stock" ? a.stockFavourites : a.favourites;
    const bFavourites = market === "stock" ? b.stockFavourites : b.favourites;
    if (aFavourites !== bFavourites) return bFavourites - aFavourites;
    return a.stonklet.name.localeCompare(b.stonklet.name);
  });
}
