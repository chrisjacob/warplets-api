import { afterEach, describe, expect, it, vi } from "vitest";
import { binanceRangeConfig, loadChart, normalizeBinanceTicker, normalizePriceSeries, periodChangeFromChart } from "./stonkletMarket";

function candle(close: number): unknown[] { return [0, String(close), String(close), String(close), String(close)]; }

describe("Binance Stonklets normalization", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("normalizes quote volume, price, rolling changes, and freshness", () => {
    const rows = Array.from({ length: 49 }, (_, index) => candle(100 + index));
    const result = normalizeBinanceTicker({ ticker: { lastPrice: "148", quoteVolume: "12345.67", priceChangePercent: "7.125" }, shortKlines: rows }, "2026-09-02T00:00:00.000Z", "live");
    expect(result.price).toBe(148);
    expect(result.volume24h).toBe(12345.67);
    expect(result.change5m).toBeCloseTo((148 / 147 - 1) * 100);
    expect(result.change1h).toBeCloseTo((148 / 136 - 1) * 100);
    expect(result.change4h).toBeCloseTo(48);
    expect(result.change24h).toBe(7.125);
    expect(result.status).toBe("live");
  });

  it("returns safe nullable fields for malformed upstream values", () => {
    const result = normalizeBinanceTicker({ ticker: { lastPrice: "oops", quoteVolume: null } }, "2026-09-02T00:00:00.000Z", "stale");
    expect(result.price).toBeNull();
    expect(result.volume24h).toBeNull();
    expect(result.change5m).toBeNull();
    expect(result.status).toBe("stale");
  });

  it("uses interval-appropriate Binance candles for every range", () => {
    expect(binanceRangeConfig("1h")).toEqual({ interval: "1m", limit: 61 });
    expect(binanceRangeConfig("24h")).toEqual({ interval: "5m", limit: 289 });
    expect(binanceRangeConfig("7d")).toEqual({ interval: "30m", limit: 337 });
    expect(binanceRangeConfig("30d")).toEqual({ interval: "2h", limit: 361 });
    expect(binanceRangeConfig("60d")).toEqual({ interval: "4h", limit: 361 });
    expect(binanceRangeConfig("90d")).toEqual({ interval: "4h", limit: 541 });
    expect(binanceRangeConfig("all")).toEqual({ interval: "1d", limit: 1000 });
  });

  it("deduplicates, downsamples, and normalizes price history from zero", () => {
    const points = normalizePriceSeries(Array.from({ length: 1_003 }, (_, index) => ({ time: index, price: 100 + index })), 300);
    expect(points).toHaveLength(300);
    expect(points[0]).toEqual({ time: 0, price: 100, value: 0 });
    expect(points.at(-1)?.time).toBe(1_002);
    expect(periodChangeFromChart(points)).toBeCloseTo(1_002);
  });

  it("returns an unavailable chart for unknown pairs and malformed candles", async () => {
    expect((await loadChart("unknown", "stock", undefined, "24h")).status).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: -1121 }), { status: 200 })));
    const malformed = await loadChart("robinhood", "stock", undefined, "24h");
    expect(malformed).toMatchObject({ range: "24h", basis: "price", provider: null, status: "unavailable", points: [] });
  });

  it("serves valid cached candles as stale during a provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const kv = {
      get: vi.fn(async () => ({
        storedAt: Date.now() - 120_000,
        value: [
          [1_000_000, "10", "10", "10", "10"],
          [1_060_000, "12", "12", "12", "12"],
        ],
      })),
      put: vi.fn(async () => undefined),
    } as unknown as KVNamespace;
    const result = await loadChart("robinhood", "stock", kv, "1h");
    expect(result.status).toBe("stale");
    expect(result.provider).toBe("binance");
    expect(result.periodChange).toBeCloseTo(20);
  });
});
