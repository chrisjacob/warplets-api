import { beforeEach, describe, expect, it, vi } from "vitest";

const statsMocks = vi.hoisted(() => ({
  ensureStatsShareSnapshot: vi.fn(),
  loadLatestStatsShareSnapshotByLaunchPath: vi.fn(),
  loadStatsShareSnapshot: vi.fn(),
  renderStatsShareOgImage: vi.fn(),
  resolveStatsFriendFilterFid: vi.fn(),
}));

vi.mock("./_lib/statsShares.js", () => ({
  ensureStatsShareSnapshot: statsMocks.ensureStatsShareSnapshot,
  loadLatestStatsShareSnapshotByLaunchPath: statsMocks.loadLatestStatsShareSnapshotByLaunchPath,
  loadStatsShareSnapshot: statsMocks.loadStatsShareSnapshot,
  renderStatsShareOgImage: statsMocks.renderStatsShareOgImage,
}));

vi.mock("./_lib/stats.js", () => ({
  resolveStatsFriendFilterFid: statsMocks.resolveStatsFriendFilterFid,
}));

import { onRequestGet } from "./index";

describe("on-demand Stats Open Graph generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statsMocks.renderStatsShareOgImage.mockResolvedValue(null);
  });

  it("renders a missing snapshot before returning the same deep-link HTML response", async () => {
    const snapshot = {
      id: "a".repeat(32),
      kind: "market" as const,
      request: { kind: "market" as const, metric: "sales" as const, range: "30d" as const },
      title: "Share Sales",
      farcasterText: "10X Warplets - Sales (30 Days)",
      twitterText: "10X Warplets - Sales (30 Days)",
      launchPath: "/stats/market/30d/sales",
      imageKey: `stats-share-v48/${"a".repeat(32)}.png`,
      imageReady: true,
      rendererVersion: "stats-share-v48",
      dataAsOf: "2026-08-26T00:00:00.000Z",
      createdAt: "2026-08-26T00:00:00.000Z",
      data: {},
    };
    statsMocks.loadLatestStatsShareSnapshotByLaunchPath.mockResolvedValueOnce(null);
    statsMocks.ensureStatsShareSnapshot.mockResolvedValueOnce({ snapshot, renderError: null });

    const response = await onRequestGet({
      request: new Request("https://warplet.10x.meme/stats/market/30d/sales"),
      env: {
        ASSETS: { fetch: vi.fn() },
        WARPLETS: {},
        STATS_SHARE_BROWSER: {},
        STATS_SHARE_IMAGES: {},
      },
      next: vi.fn(async () => new Response("<!doctype html><html><head><title>10X Warplets</title></head><body></body></html>", {
        headers: { "content-type": "text/html" },
      })),
    } as never);

    expect(statsMocks.ensureStatsShareSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "market", metric: "sales", range: "30d" },
    );
    const html = await response.text();
    expect(html).toContain(`/api/stats/share-images/${snapshot.id}/og`);
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain("10X Warplets - Sales (30 Days)");
  });

  it("does not invent route metadata when generation infrastructure is unavailable", async () => {
    statsMocks.loadLatestStatsShareSnapshotByLaunchPath.mockResolvedValueOnce(null);
    const response = await onRequestGet({
      request: new Request("https://warplet.10x.meme/stats/overview/launch"),
      env: { ASSETS: { fetch: vi.fn() }, WARPLETS: {} },
      next: vi.fn(async () => new Response("<!doctype html><html><head><title>10X Warplets</title></head><body></body></html>", {
        headers: { "content-type": "text/html" },
      })),
    } as never);

    expect(statsMocks.ensureStatsShareSnapshot).not.toHaveBeenCalled();
    const html = await response.text();
    expect(html).not.toContain("<meta property=\"og:title\"");
    expect(html).not.toContain("<meta property=\"og:description\"");
  });
});
