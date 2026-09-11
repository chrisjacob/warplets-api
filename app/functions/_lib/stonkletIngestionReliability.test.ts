import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STONKLETS_CATALOG, emptyMarketMetrics } from "../../shared/stonkletsCatalog";
import { loadStockMetricsBatch } from "./stonkletMarket";
import { loadCmcMarket } from "./stonkletCmc";
import { claimStonkletWork, releaseStonkletWork } from "./stonkletWorkLease";
import { ingestStonkletMarketIfDue, loadStonkletDemoMarket, refreshStonkletDemoMarket, type StonkletDemoSnapshot } from "./stonkletIngestion";

vi.mock("./stonkletMarket", async importOriginal => ({ ...await importOriginal<typeof import("./stonkletMarket")>(), loadStockMetricsBatch: vi.fn() }));
vi.mock("./stonkletCmc", async importOriginal => ({ ...await importOriginal<typeof import("./stonkletCmc")>(), ingestCmcMarketIfDue: vi.fn(async () => ({ status: "disabled" })), loadCmcMarket: vi.fn(async () => new Map()) }));
vi.mock("./stonkletWorkLease", () => ({ claimStonkletWork: vi.fn(async () => "owner"), releaseStonkletWork: vi.fn(async () => {}) }));
const launched = STONKLETS_CATALOG.filter(entry => entry.demoToken);
const now = new Date().toISOString();
const stockMetrics = () => new Map(launched.map(entry => [entry.id, { ...emptyMarketMetrics(), price: 100, status: "live" as const, updatedAt: now }]));
function previous(entry = launched[0]!, updatedAt = new Date(Date.now() - 7_200_000).toISOString()): StonkletDemoSnapshot {
  return {
    pairId: entry.id, contractAddress: entry.demoToken!.contractAddress.toLowerCase(), chart: [],
    metrics: { ...emptyMarketMetrics(), price: 0.01, status: "live", updatedAt },
    state: { lifecycle: "bonding", progress: 0, poolAddress: null, quoteTokenAddress: entry.stock.contractAddress,
      provider: "flap-onchain", updatedAt, status: "live" },
  };
}
function fixture(snapshots: StonkletDemoSnapshot[] = [], migratedId?: string) {
  const statement = { bind: vi.fn().mockReturnThis(), run: vi.fn(async () => ({})), all: vi.fn(async () => ({ results: [] })) };
  const env = {
    WARPLETS: { prepare: vi.fn(() => statement), batch: vi.fn(async () => []) },
    WARPLETS_KV: { get: vi.fn(async () => ({ storedAt: Date.now(), snapshots })), put: vi.fn(async () => {}) },
    STONKLETS_MARKET_INGEST_ENABLED: "true",
  };
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response("rate limited", { status: 429 });
    const calls = JSON.parse(init.body as string) as { id: number; params: { data: string }[] }[];
    return Response.json(calls.map(call => {
      const entry = launched.find(item => call.params[0]!.data.endsWith(item.demoToken!.contractAddress.slice(2).toLowerCase()))!;
      const words = Array<string>(18).fill("0".repeat(64));
      words[0] = (entry.id === migratedId ? "4" : "1").padStart(64, "0");
      words[1] = (10n ** 18n).toString(16).padStart(64, "0");
      words[3] = (10n ** 12n).toString(16).padStart(64, "0");
      words[9] = entry.stock.contractAddress!.slice(2).padStart(64, "0");
      return { id: call.id, result: `0x${words.join("")}` };
    }));
  });
  vi.stubGlobal("fetch", fetcher);
  return { env, fetcher };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadStockMetricsBatch).mockResolvedValue(stockMetrics());
  vi.mocked(loadCmcMarket).mockResolvedValue(new Map());
  vi.mocked(claimStonkletWork).mockResolvedValue("owner");
});
afterEach(() => vi.unstubAllGlobals());

describe("market refresh resilience", () => {
  it("prices bonding tokens with fresh CMC quotes when Binance is unavailable", async () => {
    vi.mocked(loadStockMetricsBatch).mockResolvedValue(new Map());
    vi.mocked(loadCmcMarket).mockResolvedValue(new Map([...stockMetrics()].map(([id, metrics]) => [`${id}:stock`, {metrics} as never])));
    const {env, fetcher} = fixture();
    const snapshots = await refreshStonkletDemoMarket(env as never);
    expect(snapshots).toHaveLength(20);
    expect(snapshots.every(snapshot => snapshot.metrics.status === "live")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("prices all bonding tokens from the stock batch without separate DexPaprika requests", async () => {
    const { env, fetcher } = fixture();
    const snapshots = await refreshStonkletDemoMarket(env as never);
    expect(snapshots).toHaveLength(20);
    expect(snapshots.every(item => item.metrics.status === "live")).toBe(true);
    expect(snapshots[0]!.metrics.price).toBeCloseTo(0.0001);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps only the failed token stale when its quote fallback is rate limited", async () => {
    const prior = previous();
    const metrics = stockMetrics(); metrics.delete(prior.pairId);
    vi.mocked(loadStockMetricsBatch).mockResolvedValue(metrics);
    const { env } = fixture();
    const snapshots = await refreshStonkletDemoMarket(env as never, [prior]);
    expect(snapshots.filter(item => item.metrics.status === "live")).toHaveLength(19);
    expect(snapshots.find(item => item.pairId === prior.pairId)?.metrics).toEqual({ ...prior.metrics, status: "stale" });
  });

  it("retains a failed migrated token without blocking bonding tokens", async () => {
    const prior = previous();
    const { env } = fixture([], prior.pairId);
    const snapshots = await refreshStonkletDemoMarket(env as never, [prior]);
    expect(snapshots.filter(item => item.metrics.status === "live")).toHaveLength(19);
    expect(snapshots.find(item => item.pairId === prior.pairId)?.metrics.status).toBe("stale");
  });

  it("does not relabel stale quote prices as live", async () => {
    const metrics = stockMetrics();
    vi.mocked(loadStockMetricsBatch).mockResolvedValue(new Map([...metrics].map(([id, metric]) => [id, { ...metric, status: "stale" }])));
    const { env } = fixture();
    const snapshots = await refreshStonkletDemoMarket(env as never);
    expect(snapshots.every(item => item.metrics.status === "stale")).toBe(true);
  });

  it("does not start a second ingestion while a worker holds the refresh lease", async () => {
    const prior = previous();
    const { env, fetcher } = fixture([prior]);
    vi.mocked(claimStonkletWork).mockResolvedValue(null);
    const result = await loadStonkletDemoMarket(env as never);
    expect(result[0]!.metrics.status).toBe("stale");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks even hour-old snapshots stale when every RPC fails and releases its lease", async () => {
    const prior = previous();
    const { env, fetcher } = fixture([prior]);
    fetcher.mockRejectedValue(new Error("offline"));
    const result = await loadStonkletDemoMarket(env as never);
    expect(result[0]!.metrics).toEqual({ ...prior.metrics, status: "stale" });
    expect(releaseStonkletWork).toHaveBeenCalled();
  });

  it("recognizes all 20 fresh snapshots in scheduled ingestion instead of expecting four", async () => {
    const { env, fetcher } = fixture(launched.map(entry => previous(entry, now)));
    expect(await ingestStonkletMarketIfDue(env as never)).toMatchObject({ status: "fresh" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
