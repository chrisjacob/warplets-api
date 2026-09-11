import { describe, expect, it } from "vitest";
import { emptyMarketMetrics } from "../../shared/stonkletsCatalog";
import {
  estimateCmcMonthlyCredits,
  mergeCmcMetrics,
  normalizeCmcHolderCount,
  normalizeCmcMap,
  normalizeCmcQuotes,
  type CmcAssetSnapshot,
} from "./stonkletCmc";

describe("CoinMarketCap Stonklets enrichment", () => {
  it("does not mark an old primary price live using another source's timestamp", () => {
    const old = { ...emptyMarketMetrics(), price: 201, change24h: 306, updatedAt: "2026-09-08T00:00:00Z", status: "stale" as const };
    const current = { ...emptyMarketMetrics(), price: 52.73, change24h: -0.86, updatedAt: new Date().toISOString(), status: "live" as const };
    const result = mergeCmcMetrics(old, { metrics: current } as CmcAssetSnapshot);
    expect(result).toMatchObject({ price: 52.73, change24h: -0.86, updatedAt: current.updatedAt, status: "live" });
    const holdersOnly = mergeCmcMetrics(old, { metrics: { ...current, price: null, holders: 84 } } as CmcAssetSnapshot);
    expect(holdersOnly).toMatchObject({price: 201, updatedAt: old.updatedAt, status: "stale", holders: 84});
  });
  it("normalizes BNB asset IDs and contract addresses from the ID map", () => {
    const mapped = normalizeCmcMap({ data: [{
      id: 40850,
      symbol: "HOODB",
      platform: { slug: "bnb", token_address: "0xA394DCEA3fD3847fD793AFbFD163e2E3858b7c65" },
    }, { id: "bad", symbol: "NOPE" }] });
    expect(mapped).toEqual([{
      id: 40850,
      symbol: "HOODB",
      platform: { slug: "bnb", token_address: "0xa394dcea3fd3847fd793afbfd163e2e3858b7c65" },
    }]);
  });

  it("normalizes quote fundamentals without inventing unsupported fast windows", () => {
    const quotes = normalizeCmcQuotes({ data: [{
      id: 40850,
      symbol: "HOODB",
      last_updated: "2026-09-02T08:00:00.000Z",
      quote: [{
        symbol: "USD",
        price: 103.86,
        volume_24h: 6_006_537.8,
        percent_change_1h: -0.09,
        percent_change_24h: -4.68,
        market_cap: 3_426_100.92,
        last_updated: "2026-09-02T08:01:05.000Z",
      }],
    }] }, "2026-09-02T08:02:00.000Z");
    const result = quotes.get(40850)!;
    expect(result.marketCap).toBe(3_426_100.92);
    expect(result.volume24h).toBe(6_006_537.8);
    expect(result.change1h).toBe(-0.09);
    expect(result.change24h).toBe(-4.68);
    expect(result.change5m).toBeNull();
    expect(result.change4h).toBeNull();
    expect(result.status).toBe("live");
  });

  it("accepts zero holders and rejects malformed counts", () => {
    expect(normalizeCmcHolderCount({ data: { count: "4464" }, status: { credit_count: 1 } })).toBe(4464);
    expect(normalizeCmcHolderCount({ count: 0 })).toBe(0);
    expect(normalizeCmcHolderCount({ count: "not-a-number" })).toBeNull();
  });

  it("uses Binance fast metrics while filling market cap and holders from CMC", () => {
    const primary = {
      ...emptyMarketMetrics(),
      price: 104.18,
      volume24h: 1_620_000,
      change5m: -0.5,
      change1h: -1.2,
      change4h: -2.3,
      change24h: -4.85,
      updatedAt: "2026-09-02T08:02:00.000Z",
      status: "live" as const,
    };
    const supplemental: CmcAssetSnapshot = {
      assetKey: "robinhood:stock",
      pairId: "robinhood",
      asset: "stock",
      symbol: "HOODB",
      cmcId: 40850,
      contractAddress: "0xa394dcea3fd3847fd793afbfd163e2e3858b7c65",
      metrics: {
        ...emptyMarketMetrics(),
        price: 103.86,
        marketCap: 3_426_100.92,
        volume24h: 6_006_537.8,
        holders: 4464,
        change1h: -0.09,
        change24h: -4.68,
        updatedAt: "2026-09-02T08:01:05.000Z",
        status: "live",
      },
      quoteUpdatedAt: "2026-09-02T08:02:00.000Z",
      holdersUpdatedAt: "2026-09-02T08:02:00.000Z",
      mappingUpdatedAt: "2026-09-02T08:02:00.000Z",
    };
    const result = mergeCmcMetrics(primary, supplemental);
    expect(result.price).toBe(104.18);
    expect(result.volume24h).toBe(1_620_000);
    expect(result.change5m).toBe(-0.5);
    expect(result.marketCap).toBe(3_426_100.92);
    expect(result.holders).toBe(4464);
  });

  it("keeps both 40-asset and 80-asset plans below the 14,000-credit guard", () => {
    expect(estimateCmcMonthlyCredits(40)).toEqual({ quotes: 8928, holders: 4960, mappings: 31, total: 13_919 });
    expect(estimateCmcMonthlyCredits(80)).toEqual({ quotes: 8928, holders: 4960, mappings: 31, total: 13_919 });
  });
});

it("rejects cached metrics and holders from a replaced token contract", async () => {
  const { loadCmcMarket } = await import("./stonkletCmc");
  const old = { assetKey: "direxion-soxl:stonklet", contractAddress: "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777", metrics: emptyMarketMetrics() };
  const current = { ...old, contractAddress: "0x21d68a77b309a0835a2ee52378d2fd2e12e97777" };
  const makeEnv = (assets: unknown[]) => ({ WARPLETS_KV: { get: async () => ({ storedAt: Date.now(), assets }) } }) as never;
  expect((await loadCmcMarket(makeEnv([old]))).size).toBe(0);
  expect((await loadCmcMarket(makeEnv([current]))).get(old.assetKey)?.contractAddress).toBe(current.contractAddress);
});

it("reads current database quotes instead of a day-old KV snapshot", async () => {
  const { loadCmcMarket } = await import("./stonkletCmc");
  const { STONKLETS_BY_ID } = await import("../../shared/stonkletsCatalog");
  const contract = STONKLETS_BY_ID.get("paypal")!.stock.contractAddress;
  const current = { ...emptyMarketMetrics(), price: 52, change24h: -1, status: "live", updatedAt: new Date().toISOString() };
  const env = {
    WARPLETS_KV: { get: async () => ({storedAt: Date.now() - 86400000, assets: [{assetKey: "paypal:stock", metrics: {...current, price: 201}}]}) },
    WARPLETS: {prepare: () => ({all: async () => ({results: [{asset_key: "paypal:stock", pair_id: "paypal", asset: "stock", symbol: "PYPLB", contract_address: contract, quote_json: JSON.stringify(current), quote_updated_at: current.updatedAt}]})})},
  };
  expect((await loadCmcMarket(env as never)).get("paypal:stock")?.metrics).toMatchObject({price: 52, change24h: -1, status: "live"});
});

it("keeps valid mappings when new symbols are unlisted", async () => {
  const { loadCmcMappings } = await import("./stonkletCmc");
  const calls: string[][] = [];
  const data = { data: [{ symbol: "SOXLB" }] };
  const result = await loadCmcMappings(["SOXLB", "BULL10X", "BEAR10X"], async symbols => {
    calls.push(symbols);
    if (calls.length === 1) throw new Error('CMC returned 400: Invalid values for "symbol": "BEAR10X,BULL10X"');
    return data;
  });
  expect(calls).toEqual([["SOXLB", "BULL10X", "BEAR10X"], ["SOXLB"]]);
  expect(result).toBe(data);
});
it("does not retry unrelated provider errors", async () => {
  const { loadCmcMappings } = await import("./stonkletCmc");
  let calls = 0;
  await expect(loadCmcMappings(["SOXLB"], async () => { calls++; throw new Error("CMC returned 429: rate limited"); })).rejects.toThrow("429");
  expect(calls).toBe(1);
});
