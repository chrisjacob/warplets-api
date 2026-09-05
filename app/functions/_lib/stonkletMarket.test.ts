import { afterEach, describe, expect, it, vi } from "vitest";
import { binanceRangeConfig, loadChart, loadStockMetricsBatch, normalizeBinanceTicker, normalizePriceSeries, periodChangeFromChart } from "./stonkletMarket";
import { STONKLETS_BY_ID } from "../../shared/stonkletsCatalog";

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
  it("loads real stock metrics for an upcoming Stonklet pairing", async () => {
    const entry = STONKLETS_BY_ID.get("bitmine")!;
    expect(entry.pairingStatus).toBe("upcoming");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ symbol: "BMNRBUSDT", lastPrice: "25", quoteVolume: "1234", priceChangePercent: "3" }])));
    const result = await loadStockMetricsBatch([entry]);
    expect(result.get(entry.id)).toMatchObject({ price: 25, volume24h: 1234, change24h: 3, status: "live" });
  });
  it("keeps supported bStocks visible if another symbol is unavailable", async () => {
    const entry = STONKLETS_BY_ID.get("bitmine")!;
    const missing = { ...entry, id: "missing", stock: { ...entry.stock, symbol: "MISSING" } };
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get("symbols")?.includes("MISSING")) return Response.json({ code: -1121 }, { status: 400 });
      return Response.json([{ symbol: "BMNRBUSDT", lastPrice: "25", quoteVolume: "1234", priceChangePercent: "3" }]);
    }));
    const result = await loadStockMetricsBatch([entry, missing]);
    expect(result.get(entry.id)?.price).toBe(25);
    expect(result.get(missing.id)?.status).toBe("unavailable");
  });
  it("loads the bStock chart before its Stonklet has launched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([[1000000, "10", "10", "10", "10"], [1060000, "12", "12", "12", "12"]])));
    const result = await loadChart("bitmine", "stock", undefined, "24h");
    expect(result).toMatchObject({ status: "live", provider: "binance" });
    expect(result.periodChange).toBeCloseTo(20);
    expect(result.points).toHaveLength(2);
  });
});

it("falls back to candles for the verified bStock contract when Binance rejects production", async () => {
  const contract = STONKLETS_BY_ID.get("robinhood")!.stock.contractAddress!;
  const pool = "0x1111111111111111111111111111111111111111";
  const fetcher = vi.fn(async (input: string) => {
    if (input.includes("binance")) return Response.json({}, { status: 403 });
    if (input.includes(`/tokens/${contract}/pools`)) return Response.json({ data: [{ attributes: { address: pool }, relationships: { base_token: { data: { id: `bsc_${contract}` } }, quote_token: { data: { id: "bsc_other" } } } }] });
    if (input.includes(`/pools/${pool}/ohlcv/`)) return Response.json({ data: { attributes: { ohlcv_list: [[1060,12,12,12,12,1],[1000,10,10,10,10,1]] } } });
    throw new Error(`Unexpected provider URL: ${input}`);
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const chart = await loadChart("robinhood", "stock", undefined, "24h");
    expect(chart.provider).toBe("geckoterminal+local");
    expect(chart.points).toHaveLength(2);
    expect(chart.periodChange).toBeCloseTo(20);
    expect(fetcher.mock.calls.some(([url]) => url.includes(`/tokens/${contract}/pools`))).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
