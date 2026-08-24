import { describe, expect, it } from "vitest";
import {
  buildStatsHolderRankText,
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
    expect(parseStatsShareRequest({ kind: "overview", panel: "collection" })).toEqual({ kind: "overview", panel: "collection" });
    expect(parseStatsShareRequest({ kind: "overview", panel: "fair-launch", wallet: "0x1234567890abcdef1234567890abcdef12345678", fid: 9152 })).toEqual({
      kind: "overview",
      panel: "fair-launch",
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      fid: 9152,
    });
    expect(parseStatsShareRequest({ kind: "overview" })).toBeNull();
    expect(parseStatsShareRequest({ kind: "market", metric: "floor", range: "7d" })).toEqual({ kind: "market", metric: "floor", range: "7d" });
    expect(parseStatsShareRequest({ kind: "market", metric: "listings", range: "30d" })).toEqual({ kind: "market", metric: "listings", range: "30d" });
    expect(parseStatsShareRequest({ kind: "market", metric: "offers", range: "all" })).toEqual({ kind: "market", metric: "offers", range: "all" });
    expect(parseStatsShareRequest({ kind: "market-all", range: "30d" })).toEqual({ kind: "market-all", range: "30d" });
    expect(parseStatsShareRequest({ kind: "activity", event: "sale", range: "all" })).toEqual({ kind: "activity", event: "sale", range: "all" });
    expect(parseStatsShareRequest({ kind: "activity", event: "offer", range: "30d", tokenId: 4512 })).toEqual({ kind: "activity", event: "offer", range: "30d", tokenId: 4512 });
    expect(parseStatsShareRequest({ kind: "activity", event: "offer", range: "30d", tokenId: 10_001 })).toBeNull();
    expect(parseStatsShareRequest({ kind: "holder-rank", fid: 123 })).toEqual({ kind: "holder-rank", fid: 123 });
    expect(parseStatsShareRequest({ kind: "holders-top10" })).toEqual({ kind: "holders-top10" });
    expect(parseStatsShareRequest({ kind: "holders-top10", wallet: holder().wallet, fid: 123 })).toEqual({ kind: "holders-top10", wallet: holder().wallet, fid: 123 });
    expect(parseStatsShareRequest({ kind: "holders-top10-friends", viewerFid: 123 })).toEqual({ kind: "holders-top10-friends", viewerFid: 123 });
    expect(parseStatsShareRequest({ kind: "market", metric: "floor", range: "yesterday" })).toBeNull();
  });

  it("accepts friend snapshots without an authentication value", () => {
    expect(parseStatsShareRequest({ kind: "holders-top10-friends", viewerFid: 9152 })).toEqual({ kind: "holders-top10-friends", viewerFid: 9152 });
  });

  it("mentions the two neighbouring rank cards with channel-specific identities", () => {
    const viewer = holder({ wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", rank: 2 });
    const first = holder({ wallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", username: "fc-one", xUsername: "x-one" });
    const third = holder({ wallet: "0xcccccccccccccccccccccccccccccccccccccccc", username: "fc-two", xUsername: null, displayName: "Holder Two" });
    expect(buildStatsHolderRankText("My rank", viewer, [first, viewer, third], "farcaster"))
      .toBe("My rank\n\n👀 @fc-one @fc-two");
    expect(buildStatsHolderRankText("My rank", viewer, [first, viewer, third], "twitter"))
      .toBe("My rank\n\n👀 @x-one Holder Two");
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
    expect(getStatsShareActivityApiPath({ kind: "activity", event: "sale", range: "all", tokenId: 4512 })).toContain("tokenId=4512");
  });
});
