import { describe, expect, it, vi } from "vitest";
import { handleStatsShareImageGet, handleStatsShareImageHead } from "./statsShares";

const SHARE_ID = "a".repeat(32);
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71]);

function createContext(method: "GET" | "HEAD") {
  const row = {
    id: SHARE_ID,
    kind: "market",
    request_json: JSON.stringify({ kind: "market", metric: "volume", range: "30d" }),
    snapshot_json: JSON.stringify({}),
    title: "Share Volume",
    farcaster_text: "10X Warplets - Volume",
    twitter_text: "10X Warplets - Volume",
    launch_path: "/stats/market/30d/volume",
    image_key: `stats-share-v48/${SHARE_ID}.png`,
    image_status: "ready",
    renderer_version: "stats-share-v48",
    data_as_of: "2026-08-26T00:00:00.000Z",
    created_at: "2026-08-26T00:00:00.000Z",
  };
  const first = vi.fn(async () => row);
  const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first })) }));
  const writeHttpMetadata = (headers: Headers) => {
    headers.set("content-type", "application/octet-stream");
    headers.set("cache-control", "private");
  };
  const object = {
    size: IMAGE_BYTES.byteLength,
    httpEtag: '"stats-etag"',
    writeHttpMetadata,
    body: new Response(IMAGE_BYTES).body,
  };
  const get = vi.fn(async () => object);
  const head = vi.fn(async () => object);
  return {
    context: {
      request: new Request(`https://warplet.10x.meme/api/stats/share-images/${SHARE_ID}`, { method }),
      params: { shareId: SHARE_ID },
      env: {
        WARPLETS: { prepare },
        STATS_SHARE_IMAGES: { get, head },
      },
    } as never,
    get,
    head,
  };
}

function expectImageHeaders(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-length")).toBe(String(IMAGE_BYTES.byteLength));
  expect(response.headers.get("etag")).toBe('"stats-etag"');
  expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable, no-transform");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("Stats share image HTTP methods", () => {
  it("returns the PNG body and image headers for GET", async () => {
    const { context, get, head } = createContext("GET");
    const response = await handleStatsShareImageGet(context);

    expectImageHeaders(response);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(IMAGE_BYTES);
    expect(get).toHaveBeenCalledOnce();
    expect(head).not.toHaveBeenCalled();
  });

  it("uses R2 HEAD and returns identical image headers without a body", async () => {
    const { context, get, head } = createContext("HEAD");
    const response = await handleStatsShareImageHead(context);

    expectImageHeaders(response);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(head).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });
});
