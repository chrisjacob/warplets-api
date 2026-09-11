import { afterEach, expect, it, vi } from "vitest";
import { emptyMarketMetrics } from "../../shared/stonkletsCatalog";
import { loadDailyTop } from "./stonkletsDailyNotifications";
import { loadCmcMarket } from "./stonkletCmc";
vi.mock("./stonkletMarket", () => ({loadStockMetricsBatch: async () => new Map()}));
vi.mock("./stonkletCmc", async importOriginal => ({...await importOriginal<typeof import("./stonkletCmc")>(), loadCmcMarket: vi.fn(async () => new Map())}));
vi.mock("./stonkletIngestion", () => ({loadStonkletDemoMarket: async () => [], loadStonkletPeriodChanges: async () => new Map(), marketSnapshotsByPair: () => new Map()}));
afterEach(() => vi.clearAllMocks());
it("builds daily stock rankings from fresh quotes, excluding stale and uncorroborated spikes", async () => {
  const values = [
    ["paypal", "PYPLB", 52.73, -0.86, 0],
    ["usa-rare-earth", "USARB", 201, 285.34, 0],
    ["iren", "IRENB", 45, 56.66, 86400000],
  ] as const;
  vi.mocked(loadCmcMarket).mockResolvedValue(new Map(values.map(([id, symbol, price, change24h, age]) => [`${id}:stock`, {
    assetKey: `${id}:stock`, pairId: id, asset: "stock", symbol, cmcId: null, contractAddress: null,
    quoteUpdatedAt: null, holdersUpdatedAt: null, mappingUpdatedAt: null,
    metrics: {...emptyMarketMetrics(), price, change24h, status: "live", updatedAt: new Date(Date.now() - age).toISOString()},
  }])));
  const top = await loadDailyTop({} as never);
  expect(top).toHaveLength(1);
  expect(top[0]).toMatchObject({symbol: "PYPLB", change: -0.86});
});
