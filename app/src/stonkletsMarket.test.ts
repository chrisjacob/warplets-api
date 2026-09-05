import { describe, expect, it } from "vitest";
import { STONKLETS_CATALOG, emptyMarketMetrics } from "../shared/stonkletsCatalog";
import { entryMatchesQuery, filterAndSortStonklets, visibleStonkletsFavourites, type StonkletsMarketEntry } from "./stonkletsMarket";

function entry(index: number, overrides: Partial<StonkletsMarketEntry> = {}): StonkletsMarketEntry {
  return { ...STONKLETS_CATALOG[index]!, stockMetrics: emptyMarketMetrics(), stonkletMetrics: emptyMarketMetrics(), stockPeriodChange: null, stonkletPeriodChange: null, favourites: 0, momentum7d: 0, stockFavourites: 0, stockMomentum7d: 0, ...overrides };
}

describe("Stonklets market filtering and ordering", () => {
  it("ranks stocks and launched Stonklets by the selected period's change rather than votes", () => {
    for (const market of ["stock", "stonklet"] as const) {
      const a = entry(0, { launchStatus: "launched", stockPeriodChange: -5, stonkletPeriodChange: -5, stockMomentum7d: 100, momentum7d: 100 });
      const b = entry(1, { launchStatus: "launched", stockPeriodChange: 12, stonkletPeriodChange: 12 });
      const missing = entry(2, { launchStatus: "launched", stockMomentum7d: 999, momentum7d: 999 });
      const options = { entries: [a, b, missing], query: "", favourites: new Set<string>(), favouritesOnly: false, market, order: "trending" as const };
      expect(filterAndSortStonklets({ ...options, direction: "desc" }).map((row) => row.id)).toEqual([b.id, a.id, missing.id]);
      expect(filterAndSortStonklets({ ...options, direction: "asc" }).map((row) => row.id)).toEqual([a.id, b.id, missing.id]);
      // Changing the selected timeframe supplies new period changes.
      a.stockPeriodChange = a.stonkletPeriodChange = 20;
      expect(filterAndSortStonklets({ ...options, direction: "desc" })[0]?.id).toBe(a.id);
    }
  });

  it("keeps prelaunch Stonklets ranked by votes even when preview prices are available", () => {
    const a = entry(0, { launchStatus: "prelaunch", momentum7d: 10, stonkletPeriodChange: -5 });
    const b = entry(1, { launchStatus: "prelaunch", momentum7d: 2, stonkletPeriodChange: 100 });
    expect(filterAndSortStonklets({ entries: [b, a], query: "", favourites: new Set(), favouritesOnly: false, market: "stonklet", order: "trending", direction: "desc" })[0]?.id).toBe(a.id);
  });
  it("includes votes and stock favourites in paired results regardless of the ordering side", () => {
    const entries = [entry(0), entry(1), entry(2)];
    const stock = new Set([entries[0]!.id]);
    const stonklet = new Set([entries[1]!.id]);
    for (const market of ["stock", "stonklet"] as const) {
      const result = filterAndSortStonklets({ entries, query: "", favourites: visibleStonkletsFavourites(stock, stonklet, market, false), favouritesOnly: true, market, order: "az", direction: "asc" });
      expect(new Set(result.map((item) => item.id))).toEqual(new Set([entries[0]!.id, entries[1]!.id]));
      const single = filterAndSortStonklets({ entries, query: "", favourites: visibleStonkletsFavourites(stock, stonklet, market, true), favouritesOnly: true, market, order: "az", direction: "asc" });
      expect(single.map((item) => item.id)).toEqual([market === "stock" ? entries[0]!.id : entries[1]!.id]);
    }
  });
  it("searches both names, symbols, and configured addresses", () => {
    const orbit = entry(0, { stock: { ...STONKLETS_CATALOG[0]!.stock, contractAddress: "0xstock" }, stonklet: { ...STONKLETS_CATALOG[0]!.stonklet, contractAddress: "0xstonklet" } });
    expect(entryMatchesQuery(orbit, "SpaceX")).toBe(true);
    expect(entryMatchesQuery(orbit, "ORBIT")).toBe(true);
    expect(entryMatchesQuery(orbit, "0xstock")).toBe(true);
    expect(entryMatchesQuery(orbit, "0xstonklet")).toBe(true);
    expect(entryMatchesQuery(orbit, "MarsCoin")).toBe(true);
    expect(entryMatchesQuery(orbit, "0xfe189e97832d")).toBe(true);
  });

  it("shows all personal favourites when a text query has no results", () => {
    const entries = [entry(0), entry(1), entry(2)];
    const result = filterAndSortStonklets({ entries, query: "no-such-token", favourites: new Set([entries[1]!.id]), favouritesOnly: true, market: "stock", order: "az", direction: "asc" });
    expect(result.map((item) => item.id)).toEqual([entries[1]!.id]);
  });

  it("keeps unavailable values last in either direction", () => {
    const unavailable = entry(0);
    const live = entry(1, { stockMetrics: { ...emptyMarketMetrics(), volume24h: 100 } });
    for (const direction of ["asc", "desc"] as const) {
      const result = filterAndSortStonklets({ entries: [unavailable, live], query: "", favourites: new Set(), favouritesOnly: false, market: "stock", order: "volume24h", direction });
      expect(result.at(-1)?.id).toBe(unavailable.id);
    }
  });

  it("uses totals and name as deterministic trending tie-breakers", () => {
    const a = entry(0, { momentum7d: 2, favourites: 3 });
    const b = entry(1, { momentum7d: 2, favourites: 8 });
    const result = filterAndSortStonklets({ entries: [a, b], query: "", favourites: new Set(), favouritesOnly: false, market: "stonklet", order: "trending", direction: "desc" });
    expect(result[0]?.id).toBe(b.id);
  });

  it("sorts favourite totals independently for stocks and Stonklets", () => {
    const a = entry(0, { favourites: 8, stockFavourites: 1 });
    const b = entry(1, { favourites: 2, stockFavourites: 7 });
    const shared = { entries: [a, b], query: "", favourites: new Set<string>(), favouritesOnly: false, order: "favourites" as const, direction: "desc" as const };
    expect(filterAndSortStonklets({ ...shared, market: "stonklet" })[0]?.id).toBe(a.id);
    expect(filterAndSortStonklets({ ...shared, market: "stock" })[0]?.id).toBe(b.id);
  });

  it("sorts the selected period change independently for both market sides", () => {
    const a = entry(0, { stockPeriodChange: -2, stonkletPeriodChange: 18 });
    const b = entry(1, { stockPeriodChange: 4, stonkletPeriodChange: null });
    const shared = { entries: [a, b], query: "", favourites: new Set<string>(), favouritesOnly: false, order: "change" as const, direction: "desc" as const };
    expect(filterAndSortStonklets({ ...shared, market: "stock" })[0]?.id).toBe(b.id);
    expect(filterAndSortStonklets({ ...shared, market: "stonklet" }).map((row) => row.id)).toEqual([a.id, b.id]);
  });
});
