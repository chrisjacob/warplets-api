import { afterEach, describe, expect, it, vi } from "vitest";
import { STONKLETS_CATALOG } from "../../shared/stonkletsCatalog";
import { STONKLET_TRADE_DESTINATIONS } from "../../shared/stonkletsTrading";
import { applyFlapPreview, loadFlapPreviewBoard, loadFlapPreviewChart } from "./stonkletFlapPreview";

afterEach(() => vi.unstubAllGlobals());
const address = `0x${"1".repeat(40)}`;
const item = { coin: { address, name: "Source", symbol: "SRC" }, listed: true, price: "0.1", marketCap: "100", volume24h: "50", holders: "10", liquidity: "20", change5m: "1", change1h: "2", change4h: "3", change24h: "4" };
const items = STONKLETS_CATALOG.map((_, index) => ({ ...item, coin: { ...item.coin, address: `0x${(index + 1).toString(16).padStart(40, "0")}` }, price: String(index + 1), volume24h: String((index + 1) * 50) }));

describe("Flap preview data", () => {
  it("maps every Stonklet without changing its identity or the official catalog", () => {
    const original = JSON.stringify(STONKLETS_CATALOG);
    const entries = applyFlapPreview(STONKLETS_CATALOG, { at: Date.now(), value: items, stale: false }, "24h");
    expect(entries).toHaveLength(STONKLETS_CATALOG.length);
    expect(new Set(entries.map(entry => entry.demoToken.contractAddress)).size).toBe(entries.length);
    let sourceIndex = 0;
    entries.forEach((entry, index) => {
      expect(entry.stonklet).toEqual(STONKLETS_CATALOG[index]!.stonklet);
      expect(entry.stock).toEqual(STONKLETS_CATALOG[index]!.stock);
      if (STONKLET_TRADE_DESTINATIONS[entry.id]) {
        expect(entry).toMatchObject({ launchStatus: "launched", flapPreview: false, demoToken: { contractAddress: STONKLET_TRADE_DESTINATIONS[entry.id] } });
      } else {
        expect(entry).toMatchObject({ launchStatus: "launched", pairingStatus: "available", flapPreview: true, demoToken: { contractAddress: items[sourceIndex]!.coin.address }, stonkletMetrics: { volume24h: (sourceIndex + 1) * 50, price: sourceIndex + 1 } });
        sourceIndex++;
      }
    });
    expect(JSON.stringify(STONKLETS_CATALOG)).toBe(original);
  });
  it("selects a traded source and excludes unlisted and zero-volume tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [{ ...item, listed: false }, { ...item, volume24h: "0" }, ...items] })));
    expect((await loadFlapPreviewBoard()).value).toEqual(items);
  });
  it("falls back to recent cached market data when the source is unavailable", async () => {
    const cached = { at: Date.now() - 120000, value: items };
    const kv = { get: vi.fn().mockResolvedValue(cached) } as unknown as KVNamespace;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadFlapPreviewBoard(kv)).toMatchObject({ ...cached, stale: true });
  });
  it("rejects invalid chart sources without fetching", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await loadFlapPreviewChart(undefined, "https://example.com", "24h")).toMatchObject({ status: "unavailable", points: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses to reuse a source when too few unique launches are available", () => {
    expect(() => applyFlapPreview(STONKLETS_CATALOG, { at: Date.now(), value: [item], stale: false }, "24h")).toThrow("unique preview source");
  });
  it("returns unavailable charts on provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadFlapPreviewChart(undefined, address, "24h")).toMatchObject({ status: "unavailable", points: [] });
  });
  it("uses the same source token's alternate USD history when GeckoTerminal rate limits", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ pools: [{ id: "pool", chain: "bsc", volume_usd: 10, tokens: [{ id: "quote" }, { id: address }] }] }))
      .mockResolvedValueOnce(Response.json([{ time_open: "2026-09-05T00:00:00Z", close: 2 }, { time_open: "2026-09-05T00:05:00Z", close: 3 }]));
    vi.stubGlobal("fetch", fetcher);
    expect(await loadFlapPreviewChart(undefined, address, "24h")).toMatchObject({ provider: "dexpaprika+local", status: "live", periodChange: 50 });
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(`query=${address}`);
    expect(String(fetcher.mock.calls[2]?.[0])).toContain("inversed=true");
  });
});
