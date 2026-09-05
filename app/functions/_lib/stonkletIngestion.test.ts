import { describe, expect, it, vi } from "vitest";
import { STONKLETS_BY_ID } from "../../shared/stonkletsCatalog";
import { decodeFlapTokenState, fetchFlapStates, geckoRangeConfig, normalizeDexPaprikaToken, normalizeGeckoTerminalChart } from "./stonkletIngestion";

function word(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

describe("Stonklets live demo ingestion", () => {
  it("accepts one RPC result when two Stonklets temporarily use the same source token", async () => {
    const token = STONKLETS_BY_ID.get("direxion-soxl")!.demoToken!;
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: 1, result: `0x${Array.from({ length: 18 }, () => word(0)).join("")}` }]));
    vi.stubGlobal("fetch", fetcher);
    try {
      const result = await fetchFlapStates([token, { ...token }], {} as never);
      expect(result.size).toBe(1);
      expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it("decodes Flap V8Safe state and migration progress", () => {
    const words = Array.from({ length: 18 }, () => word(0));
    words[0] = word(4);
    words[1] = word(12_000_000_000_000_000n);
    words[2] = word(1_000_000_000_000_000_000n);
    words[3] = word(42_000_000_000n);
    words[9] = addressWord("0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1");
    words[14] = addressWord("0x94f3ed36706c746ad59fadcaf271b7431ab1d8f1");
    words[15] = word(1_000_000_000_000_000_000n);
    const result = decodeFlapTokenState(`0x${words.join("")}`);
    expect(result?.status).toBe(4);
    expect(result?.progress).toBe(100);
    expect(result?.quoteTokenAddress).toBe("0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1");
    expect(result?.poolAddress).toBe("0x94f3ed36706c746ad59fadcaf271b7431ab1d8f1");
  });

  it("normalizes DexPaprika summaries without inventing unsupported fields", () => {
    const metrics = normalizeDexPaprikaToken({
      summary: {
        price_usd: 0.075,
        fdv: 75_000_000,
        liquidity_usd: 900_000,
        "24h": { volume_usd: 2_500_000, last_price_usd_change: 12.345 },
        "1h": { last_price_usd_change: 2.5 },
        "5m": { last_price_usd_change: -0.25 },
      },
      last_updated: "2026-09-02T00:00:00Z",
    }, "2026-09-02T00:01:00Z");
    expect(metrics.price).toBe(0.075);
    expect(metrics.marketCap).toBe(75_000_000);
    expect(metrics.volume24h).toBe(2_500_000);
    expect(metrics.change24h).toBe(12.345);
    expect(metrics.holders).toBeNull();
    expect(metrics.change4h).toBeNull();
  });

  it("sorts GeckoTerminal candles and normalizes them from a common baseline", () => {
    const points = normalizeGeckoTerminalChart({ data: { attributes: { ohlcv_list: [
      [300, 0, 0, 0, 12, 0],
      [100, 0, 0, 0, 10, 0],
      [200, 0, 0, 0, 11, 0],
    ] } } });
    expect(points.map((point) => point.time)).toEqual([100, 200, 300]);
    expect(points[0]?.value).toBe(0);
    expect(points[2]?.value).toBeCloseTo(20);
    expect(points[2]?.price).toBe(12);
  });

  it("uses interval-appropriate GeckoTerminal OHLCV requests", () => {
    expect(geckoRangeConfig("1h")).toEqual({ timeframe: "minute", aggregate: 1, limit: 61 });
    expect(geckoRangeConfig("24h")).toEqual({ timeframe: "minute", aggregate: 5, limit: 289 });
    expect(geckoRangeConfig("7d")).toEqual({ timeframe: "hour", aggregate: 1, limit: 169 });
    expect(geckoRangeConfig("30d")).toEqual({ timeframe: "hour", aggregate: 4, limit: 181 });
    expect(geckoRangeConfig("60d")).toEqual({ timeframe: "hour", aggregate: 4, limit: 361 });
    expect(geckoRangeConfig("90d")).toEqual({ timeframe: "hour", aggregate: 12, limit: 181 });
    expect(geckoRangeConfig("all")).toEqual({ timeframe: "day", aggregate: 1, limit: 1000 });
  });
});
