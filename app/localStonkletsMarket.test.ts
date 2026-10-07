import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalMarketMirror, productionMarketQuery } from "./localStonkletsMarket";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const query = (path = "/api/stonklets/market?range=24h") => productionMarketQuery(new URL(path, "https://local.example"))!;
const board = { updatedAt: "2026-10-07T00:00:00Z", entries: [{ id: "apple", stockMetrics: { status: "live", price: 100 }, stonkletMetrics: { status: "live", price: 1 } }] };
async function cacheDir() { const path = await mkdtemp(join(tmpdir(), "stonklet-mirror-")); dirs.push(path); return path; }
describe("local production market mirror", () => {
  it("shares board requests, strips arbitrary parameters and never forwards credentials", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(board));
    const read = createLocalMarketMirror({ cacheDir: await cacheDir(), fetcher });
    const values = await Promise.all(Array.from({ length: 8 }, () => read(query("/api/stonklets/market?range=24h&id=apple&refresh=1&token=secret"))));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe("https://stonklet.10x.meme/api/stonklets/market?range=24h");
    expect(fetcher.mock.calls[0]![1].headers).toEqual({ accept: "application/json" });
    expect(values[0]!.entries).toEqual(board.entries);
    await read(query()); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("restores disk snapshots, retains provider timestamps and backs off during outages", async () => {
    let now = Date.parse("2026-10-07T00:01:00Z");
    const directory = await cacheDir();
    await createLocalMarketMirror({ cacheDir: directory, now: () => now, fetcher: vi.fn(async () => Response.json(board)) })(query());
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const read = createLocalMarketMirror({ cacheDir: directory, now: () => now, fetcher });
    expect((await read(query())).localMirror.stale).toBe(false); expect(fetcher).not.toHaveBeenCalled();
    now += 5 * 60_000;
    const retained = await read(query());
    expect(retained.updatedAt).toBe(board.updatedAt);
    expect(retained.entries[0].stockMetrics.status).toBe("stale");
    expect(retained.localMirror.stale).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await read(query()); expect(fetcher).toHaveBeenCalledTimes(1);
    now += 25 * 3600_000;
    await expect(read(query())).rejects.toThrow("offline");
  });
  it("does not cache failed or malformed upstream responses", async () => {
    let now = 100;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "down" }, { status: 503 })).mockResolvedValueOnce(Response.json({ entries: [] })).mockImplementation(async () => Response.json(board));
    const read = createLocalMarketMirror({ cacheDir: await cacheDir(), now: () => now, fetcher });
    await expect(read(query())).rejects.toThrow("HTTP 503"); now += 60_001;
    await expect(read(query())).rejects.toThrow("Invalid production"); now += 60_001;
    expect((await read(query())).entries).toEqual(board.entries);
  });
  it("normalizes chart keys and rejects preview/provider parameters and invalid identities", () => {
    expect(query("/api/stonklets/chart?asset=stock&pair=apple&range=1h&v=99").key).toBe("/api/stonklets/chart?v=2&pair=apple&asset=stock&range=1h");
    for (const path of ["/api/stonklets/market?range=bad", "/api/stonklets/market?id=unknown", "/api/stonklets/market?flap=1", "/api/stonklets/chart?pair=apple&asset=bad", "/api/stonklets/chart?pair=apple&asset=stock&source=anything"]) expect(() => query(path)).toThrow();
    expect(productionMarketQuery(new URL("https://local.example/api/stonklet-favourites"))).toBeNull();
  });
});
