import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./market";
import { loadStockPeriodChanges } from "../../_lib/stonkletMarket";
import { loadStonkletPeriodChanges } from "../../_lib/stonkletIngestion";
vi.mock("../../_lib/stonkletMarket", () => ({ loadStockMetricsBatch: vi.fn(async () => new Map()), loadStockPeriodChanges: vi.fn(async () => new Map()) }));
vi.mock("../../_lib/stonkletIngestion", () => ({ loadStonkletDemoMarket: vi.fn(async () => []), loadStonkletPeriodChanges: vi.fn(async () => new Map()), marketSnapshotsByPair: () => new Map(), marketStatusForSnapshots: () => "unavailable" }));
vi.mock("../../_lib/stonkletCmc", () => ({ ingestCmcMarketIfDue: vi.fn(async () => ({})), loadCmcMarket: vi.fn(async () => new Map()), mergeCmcMetrics: (metrics: unknown) => metrics }));
vi.mock("../../_lib/stonkletWorkLease", () => ({ claimStonkletWork: vi.fn(async () => "owner"), releaseStonkletWork: vi.fn(async () => {}) }));
function fixture(path = "") {
 const store = new Map<string,string>(); const pending: Promise<unknown>[] = [];
 const context = { request: new Request(`https://stonklet.10x.meme/api/stonklets/market${path}`), waitUntil: (p: Promise<unknown>) => pending.push(p), env: {
  WARPLETS_KV: { get: async (key: string) => store.has(key) ? JSON.parse(store.get(key)!) : null, put: async (key: string, value: string) => { store.set(key,value); } },
  WARPLETS: { prepare: () => ({ all: async () => ({ results: [] }) }) },
 }};
 return { context, store, pending };
}
beforeEach(() => vi.clearAllMocks());
describe("market snapshots", () => {
 it("loads only the selected pair for a share image", async () => {
  const {context} = fixture("?id=robinhood&change=24h");
  const response = await onRequestGet(context as never) as Response;
  expect(response.status).toBe(200);
  expect((await response.json() as {entries: unknown[]}).entries).toHaveLength(1);
  expect(vi.mocked(loadStockPeriodChanges).mock.calls[0]![0]).toHaveLength(1);
  expect(vi.mocked(loadStonkletPeriodChanges).mock.calls[0]![3]).toEqual(["robinhood"]);
 });
 it("serves the full board from cache without repeating provider work", async () => {
  const {context} = fixture();
  await onRequestGet(context as never);
  const response = await onRequestGet(context as never) as Response;
  expect(response.headers.get("x-stonklets-cache")).toBe("hit");
  expect((await response.json() as {entries: unknown[]}).entries).toHaveLength(44);
  expect(loadStockPeriodChanges).toHaveBeenCalledTimes(1);
 });
 it("refreshes the board cache without claiming healthy quotes are delayed", async () => {
  const {context,store,pending} = fixture();
  store.set("stonklets:board:v2:stonklet.10x.meme:24h:all", JSON.stringify({storedAt:Date.now()-60_000,payload:{entries:[],stale:false}}));
  const response = await onRequestGet(context as never) as Response;
  expect(response.headers.get("x-stonklets-cache")).toBe("stale");
  expect(await response.json()).toMatchObject({ stale: false, refreshing: true });
  await Promise.all(pending);
  expect(loadStockPeriodChanges).toHaveBeenCalledTimes(1);
 });
 it("rejects an unknown pair before provider work", async () => {
  const {context} = fixture("?id=wrong");
  expect((await onRequestGet(context as never) as Response).status).toBe(404);
  expect(loadStockPeriodChanges).not.toHaveBeenCalled();
 });
});

it("preserves genuine provider delays while refreshing the board", async () => {
 const {context,store,pending} = fixture();
 store.set("stonklets:board:v2:stonklet.10x.meme:24h:all", JSON.stringify({storedAt:Date.now()-60_000,payload:{entries:[],stale:true}}));
 const response = await onRequestGet(context as never) as Response;
 expect(await response.json()).toMatchObject({stale:true,refreshing:true});
 await Promise.all(pending);
});
