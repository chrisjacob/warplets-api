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
  expect(claimStonkletWork).toHaveBeenCalledWith(expect.anything(), "stonklet-shares/v7/stonklet-local.10x.meme/robinhood/24h",180);
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
