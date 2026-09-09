import { allowStonkletAction } from "../../_lib/stonkletAbuse";
vi.mock("../../_lib/stonkletAbuse", () => ({ allowStonkletAction: vi.fn(async () => true), fetchRenderAvatar: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./share-image";
import { claimStonkletWork, releaseStonkletWork } from "../../_lib/stonkletWorkLease";
vi.mock("../../_lib/stonkletWorkLease", () => ({ claimStonkletWork: vi.fn(), releaseStonkletWork: vi.fn(async () => {}) }));
const image = () => ({ uploaded: new Date(), body: new Uint8Array([137,80,78,71]) });
function context(get: ReturnType<typeof vi.fn>) { return { request: new Request("https://stonklet-local.10x.meme/api/stonklets/share-image?id=robinhood&range=24h"), env: { STATS_SHARE_IMAGES: { get }, STATS_SHARE_BROWSER: {}, WARPLETS: {} } }; }
beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe("share render deduplication", () => {
 it("serves an expired OG card immediately while a refresh is already running", async () => {
  const get = vi.fn(async () => ({ ...image(), uploaded: new Date(Date.now() - 600_000) }));
  const pending: Promise<unknown>[] = [];
  vi.mocked(claimStonkletWork).mockResolvedValueOnce(null);
  const ctx = { ...context(get), request: new Request("https://stonklet-local.10x.meme/api/stonklets/share-image?id=robinhood&variant=og"), waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
  const response = await onRequestGet(ctx as never) as Response;
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(image().body);
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  expect(allowStonkletAction).not.toHaveBeenCalled();
 });
 it("keeps serving the OG card when the background refresh hits its quota", async () => {
  const get = vi.fn(async () => ({ ...image(), uploaded: new Date(Date.now() - 600_000) }));
  const pending: Promise<unknown>[] = [];
  vi.mocked(claimStonkletWork).mockResolvedValueOnce("owner");
  vi.mocked(allowStonkletAction).mockResolvedValueOnce(false);
  const ctx = { ...context(get), request: new Request("https://stonklet-local.10x.meme/api/stonklets/share-image?id=robinhood&variant=og"), waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
  const response = await onRequestGet(ctx as never) as Response;
  expect(response.status).toBe(200);
  await Promise.all(pending);
  expect(releaseStonkletWork).toHaveBeenCalled();
 });
 it("serves an existing OG card even if browser rendering is unavailable", async () => {
  const ctx = context(vi.fn(async () => ({ ...image(), uploaded: new Date(0) })));
  const response = await onRequestGet({ ...ctx, request: new Request("https://stonklet-local.10x.meme/api/stonklets/share-image?id=robinhood&variant=og"), env: { ...ctx.env, STATS_SHARE_BROWSER: undefined } } as never) as Response;
  expect(response.status).toBe(200);
  expect(claimStonkletWork).not.toHaveBeenCalled();
 });
 it("returns cached images without acquiring a render lease", async () => {
  const get = vi.fn(async () => image());
  const response = await onRequestGet(context(get) as never) as Response;
  expect(response.status).toBe(200); expect(claimStonkletWork).not.toHaveBeenCalled();
 });
 it("waits for the existing render without launching a second browser", async () => {
  vi.useFakeTimers(); vi.mocked(claimStonkletWork).mockResolvedValueOnce(null);
  const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(image());
  const pending = onRequestGet(context(get) as never);
  await vi.advanceTimersByTimeAsync(2_000);
  const response = await pending as Response;
  expect(response.status).toBe(200);
  expect(claimStonkletWork).toHaveBeenCalledWith(expect.anything(), "stonklet-shares/v10/stonklet-local.10x.meme/robinhood/24h",180);
  expect(releaseStonkletWork).not.toHaveBeenCalled();
  vi.useRealTimers();
 });
 it("rechecks the cache after claiming and releases its own lease", async () => {
  vi.mocked(claimStonkletWork).mockResolvedValueOnce("owner");
  const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(image());
  expect((await onRequestGet(context(get) as never) as Response).status).toBe(200);
  expect(releaseStonkletWork).toHaveBeenCalledWith(expect.anything(),expect.any(String),"owner");
 });
});

it("rejects an exhausted render quota and releases the lease before browser startup", async () => {
 vi.mocked(claimStonkletWork).mockResolvedValueOnce("limited-owner");
 vi.mocked(allowStonkletAction).mockResolvedValueOnce(false);
 const response = await onRequestGet(context(vi.fn(async () => null)) as never) as Response;
 expect(response.status).toBe(429);
 expect(response.headers.get("retry-after")).toBe("60");
 expect(releaseStonkletWork).toHaveBeenCalledWith(expect.anything(), expect.any(String), "limited-owner");
});
