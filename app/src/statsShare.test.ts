import { describe, expect, it } from "vitest";
import {
  buildStatsLeaderboardText,
  formatStatsShareIdentity,
  getStatsShareActivityApiPath,
  getStatsShareActivityLabel,
  getStatsShareContentHash,
  getStatsShareRangeLabel,
  parseStatsShareRequest,
  stableStatsShareJson,
  type StatsShareHolder,
} from "./statsShare";

const holder = (overrides: Partial<StatsShareHolder> = {}): StatsShareHolder => ({
  rank: 1,
  wallet: "0x1234567890abcdef1234567890abcdef12345678",
  fid: 123,
  username: "warplet",
  xUsername: "warplet_x",
  displayName: "Warplet Friend",
  pfpUrl: null,
  ownedCount: 10,
  ownedPct: 0.1,
  bestRarityRank: 5,
  previewTokenIds: [1],
  remainingCount: 9,
  floorValueEth: 1,
  ...overrides,
});

describe("Stats share request validation", () => {
  it("accepts every supported family and rejects invalid ranges", () => {
    expect(parseStatsShareRequest({ kind: "overview" })).toEqual({ kind: "overview" });
    expect(parseStatsShareRequest({ kind: "market", metric: "floor", range: "7d" })).toEqual({ kind: "market", metric: "floor", range: "7d" });
    expect(parseStatsShareRequest({ kind: "activity", event: "sale", range: "all" })).toEqual({ kind: "activity", event: "sale", range: "all" });
    expect(parseStatsShareRequest({ kind: "holder-rank", fid: 123 })).toEqual({ kind: "holder-rank", fid: 123 });
    expect(parseStatsShareRequest({ kind: "holders-top10" })).toEqual({ kind: "holders-top10" });
    expect(parseStatsShareRequest({ kind: "holders-top10-friends", viewerFid: 123 })).toEqual({ kind: "holders-top10-friends", viewerFid: 123 });
    expect(parseStatsShareRequest({ kind: "market", metric: "floor", range: "yesterday" })).toBeNull();
  });

  it("accepts friend snapshots without an authentication value", () => {
    expect(parseStatsShareRequest({ kind: "holders-top10-friends", viewerFid: 9152 })).toEqual({ kind: "holders-top10-friends", viewerFid: 9152 });
  });
});

describe("Stats share copy", () => {
  it("formats ranges and activity plurals", () => {
    expect(getStatsShareRangeLabel("7d")).toBe("7 Days");
    expect(getStatsShareRangeLabel("all")).toBe("All Time");
    expect(getStatsShareActivityLabel("sale", 1)).toBe("Sale");
    expect(getStatsShareActivityLabel("sale", 0)).toBe("Sales");
    expect(getStatsShareActivityLabel("listing", 12)).toBe("Listings");
  });

  it("uses channel-specific identities and fallbacks", () => {
    expect(formatStatsShareIdentity(holder(), "farcaster")).toBe("@warplet");
    expect(formatStatsShareIdentity(holder(), "twitter")).toBe("@warplet_x");
    expect(formatStatsShareIdentity(holder({ username: null, xUsername: null }), "twitter")).toBe("Warplet Friend");
    expect(formatStatsShareIdentity(holder({ username: null, xUsername: null, displayName: null }), "twitter")).toBe("0x1234…5678");
    expect(buildStatsLeaderboardText("Top 10", [holder()], "twitter")).toContain("🥇 @warplet_x");
  });
});

describe("Stats share canonical snapshots", () => {
  it("serializes object keys stably and hashes deterministically", async () => {
    expect(stableStatsShareJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    const request = { kind: "market", metric: "price", range: "30d" } as const;
    expect(await getStatsShareContentHash(request, "2026-08-04T00:00:00Z", { points: [1, 2] })).toBe(await getStatsShareContentHash(request, "2026-08-04T00:00:00Z", { points: [1, 2] }));
    expect(await getStatsShareContentHash(request, "2026-08-04T00:00:00Z", { points: [1, 2] })).toMatch(/^[a-f0-9]{32}$/);
    expect(await getStatsShareContentHash(request, "2026-08-04T00:00:00Z", { points: [1, 2] })).not.toBe(await getStatsShareContentHash(request, "2026-08-04T00:00:00Z", { points: [2, 1] }));
  });

  it("builds an unfiltered Activity data path", () => {
    const path = getStatsShareActivityApiPath({ kind: "activity", event: "offer", range: "30d" });
    expect(path).toContain("events=offer");
    expect(path).not.toContain("friends");
    expect(path).not.toContain("favourites");
    expect(path).not.toContain("wallet");
  });
});
