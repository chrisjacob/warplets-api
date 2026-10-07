import { describe, expect, it } from "vitest";
import { STONKLETS_CATALOG, emptyMarketMetrics } from "./stonkletsCatalog";
import { createSpotlight, rankSpotlight, spotlightExposure, spotlightStatus, spotlightHistoryMetrics } from "./stonkletsSpotlight";
import { stonkletThesisShare, thesisPostLength } from "./stonkletsThesisShare";
import { stonkletShare } from "./stonkletsShare";
const now = "2026-10-06T12:05:00.000Z";
const launched = STONKLETS_CATALOG.filter(entry => entry.launchStatus === "launched");
const metrics = () => new Map(launched.map((entry, index) => [entry.id, {
  ...emptyMarketMetrics(), price: 100, change1h: index, change4h: index, change24h: index,
  updatedAt: now, status: "live" as const,
}]));

describe("momentum selection", () => {
  it("uses same-provider history for missing 4h returns and rejects missing baselines", () => {
    const quote = { ...emptyMarketMetrics(), price: 110, status: "live" as const, updatedAt: now, change24h: 12 };
    const end = Date.parse(now) / 1000;
    const points = [{ time: end - 3600, price: 100 }, { time: end - 14400, price: 90 }];
    const derived = spotlightHistoryMetrics(quote, points)!;
    expect(derived.change1h).toBeCloseTo(10);
    expect(derived.change4h).toBeCloseTo(22.222222);
    expect(derived.change24h).toBe(12);
    expect(spotlightHistoryMetrics(quote, points.slice(0, 1))).toBeNull();
    expect(spotlightHistoryMetrics({ ...quote, status: "stale" }, points)).toBeNull();
  });
  it("calculates 60/30/10 midrank percentiles and resolves ties by ID", () => {
    const data = metrics();
    for (const metric of data.values()) Object.assign(metric, { change1h: 0, change4h: 0, change24h: 0 });
    const ranked = rankSpotlight(data, Date.parse(now));
    expect(ranked.every(candidate => candidate.score === 0.5)).toBe(true);
    expect(ranked[0]!.pairId).toBe([...data.keys()].sort()[0]);
    data.get(launched[0]!.id)!.change1h = 1;
    const winner = rankSpotlight(data, Date.parse(now))[0]!;
    expect(winner.pairId).toBe(launched[0]!.id);
    expect(winner.score).toBeCloseTo(0.8);
  });
  it("chooses the smallest hourly loss even when longer windows favour another token", () => {
    const data = metrics();
    for (const [index, metric] of [...data.values()].entries()) metric.change1h = -20 + index;
    data.get(launched[0]!.id)!.change1h = -0.1;
    const ranked = rankSpotlight(data, Date.parse(now));
    const thesis = createSpotlight(ranked, now)!;
    expect(thesis.pairId).toBe(launched[0]!.id);
    expect(thesis.kind).toBe("relative-strength");
    expect(thesis.explanation).toContain("Smallest 1h loss");
    expect(thesis.explanation).toContain("-0.10%");
  });
  it("excludes stale, missing, future and invalid observations and requires 12 candidates", () => {
    const data = metrics();
    for (const entry of launched.slice(0, 9)) data.delete(entry.id);
    expect(createSpotlight(rankSpotlight(data, Date.parse(now)), now)).toBeNull();
    const bad = metrics();
    Object.assign(bad.get(launched[0]!.id)!, { status: "stale" });
    Object.assign(bad.get(launched[1]!.id)!, { change4h: null });
    Object.assign(bad.get(launched[2]!.id)!, { change1h: NaN });
    Object.assign(bad.get(launched[3]!.id)!, { updatedAt: "2020-01-01" });
    Object.assign(bad.get(launched[4]!.id)!, { updatedAt: "2030-01-01" });
    Object.assign(bad.get(launched[5]!.id)!, { price: 0 });
    Object.assign(bad.get(launched[6]!.id)!, { change24h: -101 });
    expect(rankSpotlight(bad, Date.parse(now))).toHaveLength(13);
  });
  it("retains timestamps, separates archives and withdrawals, and labels special exposures", () => {
    const thesis = createSpotlight(rankSpotlight(metrics(), Date.parse(now)), now)!;
    expect(spotlightStatus(thesis, false, Date.parse(now))).toBe("current");
    expect(spotlightStatus(thesis, false, Date.parse(now) + 7200_000)).toBe("retained");
    expect(spotlightStatus(thesis, true, Date.parse(now))).toBe("archived");
    expect(spotlightStatus({ ...thesis, withdrawnAt: now })).toBe("withdrawn");
    expect(spotlightExposure("direxion-soxs")).toContain("Inverse");
    expect(spotlightExposure("tether-gold")).toContain("Gold");
  });
});

describe("news sharing", () => {
  it.each(launched.map(entry => [entry.id, entry] as const))("keeps both links within platform budgets for %s", (_id, entry) => {
    const thesis = { ...createSpotlight(rankSpotlight(metrics(), Date.parse(now)), now)!, pairId: entry.id,
      headline: "New product launch ".repeat(100), leadSourceId: "source", sources: [{ id: "source", url: "https://issuer.example/launch", title: "Launch", publisher: "Issuer", publishedAt: now, fetchedAt: now }] };
    const post = stonkletThesisShare(entry, "stonklet.10x.meme", thesis);
    expect(thesisPostLength(post.twitterText, "twitter")).toBeLessThanOrEqual(280);
    expect(thesisPostLength(post.farcasterText, "farcaster")).toBeLessThanOrEqual(1024);
    expect(post.twitterText).toBe(post.farcasterText);
    expect(post.text).toContain("https://issuer.example/launch");
    expect(post.text).toContain(`news=${thesis.id}`);
    expect(post.text).not.toContain("flap.sh");
    expect(post.text).not.toContain("bStock");
    expect(post.image).toContain("range=1h");
    const normal = stonkletShare(entry, "stonklet.10x.meme", "7d");
    expect(normal.url).not.toContain("news=");
    expect(normal.image).toContain("range=7d");
    expect(stonkletShare(entry, "stonklet.10x.meme", "1h", thesis.id).url).toContain(`news=${thesis.id}`);
    expect(stonkletShare(entry, "stonklet.10x.meme", "1h", "invalid").url).not.toContain("news=");
  });
});
