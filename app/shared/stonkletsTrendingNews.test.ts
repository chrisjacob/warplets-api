import saved from "./stonkletsNewsPreview.json";
import { describe, expect, it } from "vitest";
import { createTrendingNewsEntry, latestNewsPerStock, positiveNews, trendingNewsEntries } from "./stonkletsTrendingNews";
import { STONKLETS_CATALOG } from "./stonkletsCatalog";
import type { ThesisSource } from "./stonkletsSpotlight";
import backfill from "./stonkletsNewsBackfill.json";
const now = "2026-10-06T12:05:00Z";
const source: ThesisSource = { id: "a", url: "https://issuer.example/a", title: "Final Cut Camera now supports variable aperture", publisher: "Apple", publishedAt: "2026-10-06T10:00:00Z", fetchedAt: now };
describe("positive news discovery", () => {
  it("requires supported positive developments, excluding neutral or adverse stories", () => {
    expect(positiveNews(source, Date.parse(now))).toBe(true);
    for (const title of ["Earnings results", "Company to announce record earnings next week", "Record losses reported", "Company launches product amid recall", "Company raises guidance but warns of losses"]) expect(positiveNews({ ...source, title }, Date.parse(now))).toBe(false);
    expect(positiveNews({ ...source, publishedAt: "2026-10-07" }, Date.parse(now))).toBe(false);
    expect(positiveNews({ ...source, publishedAt: "2026-09-01" }, Date.parse(now))).toBe(false);
  });
  it("gives stories stable IDs across hourly polls and deduplicates syndicated headlines", async () => {
    const ranked = STONKLETS_CATALOG.filter(e => e.launchStatus === "launched").map(e => ({ pairId: e.id, returns: { "1h": 0, "4h": 0, "24h": 0 }, quoteAt: now, score: 0 }));
    const research = new Map(ranked.map(item => [item.pairId, { sources: item.pairId === "apple" ? [source, { ...source, id: "b", url: "https://issuer.example/b" }] : [], selected: [], status: "sources" }]));
    const first = await trendingNewsEntries(ranked, research, now);
    expect(first).toHaveLength(1);
    expect(first[0]!.id).toMatch(/^news-[a-f0-9]{24}$/);
    expect((await trendingNewsEntries(ranked, research, "2026-10-06T13:05:00Z"))[0]!.id).toBe(first[0]!.id);
    expect(await trendingNewsEntries(ranked.slice(0, 11), research, now)).toEqual([]);
  });
});

it("keeps reviewed backfill identities stable without changing the live freshness filter", async () => {
  const ranked = STONKLETS_CATALOG.filter(e => e.launchStatus === "launched").map(e => ({ pairId: e.id, returns: { "1h": 1, "4h": 2, "24h": 3 }, quoteAt: now, score: 0 }));
  expect(backfill.entries).toHaveLength(10);
  expect(new Set(backfill.entries.map(item => item.pairId)).size).toBe(7);
  const ids = new Set<string>();
  for (const item of backfill.entries) {
    const candidate = ranked.find(candidate => candidate.pairId === item.pairId)!;
    expect(candidate).toBeDefined();
    expect(Date.parse(item.source.publishedAt)).toBeLessThanOrEqual(Date.parse(backfill.reviewedAt));
    const entry = await createTrendingNewsEntry(candidate, ranked, item.source, now);
    ids.add(entry.id);
    expect(entry.sources[0]).toEqual(item.source);
    expect(entry.quoteAt).toBe(now);
    expect((await createTrendingNewsEntry(candidate, ranked, item.source, "2026-10-07T12:05:00Z")).id).toBe(entry.id);
    if (Date.parse(now) - Date.parse(item.source.publishedAt) > 7 * 86400_000) expect(positiveNews(item.source, Date.parse(now))).toBe(false);
  }
  expect(ids.size).toBe(10);
});

it("keeps the newest story per stock, ordered by source date, without changing archived input", () => {
  const entries = saved as import("./stonkletsSpotlight").SpotlightThesis[];
  const selected = latestNewsPerStock(entries);
  expect(selected).toHaveLength(7);
  expect(new Set(selected.map(item => item.pairId)).size).toBe(7);
  const dates = selected.map(item => item.sources[0]!.publishedAt);
  expect(dates).toEqual([...dates].sort().reverse());
  const apple = selected.find(item => item.pairId === "apple")!;
  expect(apple.headline).toContain("Final Cut Camera");
  expect(latestNewsPerStock(entries.map(item => item.id === apple.id ? { ...item, withdrawnAt: now } : item)).find(item => item.pairId === "apple")!.id).not.toBe(apple.id);
  expect(entries).toHaveLength(10);
});
it("selects only the newest qualifying catalyst for each stock", async () => {
  const ranked = STONKLETS_CATALOG.filter(e => e.launchStatus === "launched").map(e => ({ pairId: e.id, returns: { "1h": 0, "4h": 0, "24h": 0 }, quoteAt: now, score: 0 }));
  const research = new Map(ranked.map(item => [item.pairId, { sources: item.pairId === "apple" ? [source, { ...source, title: "Apple launches another product", publishedAt: "2026-10-06T11:00:00Z" }, { ...source, title: "Apple leadership update", publishedAt: "2026-10-06T12:00:00Z" }] : [], selected: [], status: "sources" }]));
  const entries = await trendingNewsEntries(ranked, research, now);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.headline).toBe("Apple launches another product");
  for (const title of ["Company secures multiyear supply agreement", "Company announces share repurchase authorization increase"]) expect(positiveNews({ ...source, title }, Date.parse(now))).toBe(true);
  for (const title of ["New guide to business growth", "Company launches teacher fellowship", "How to launch a startup"]) expect(positiveNews({ ...source, title }, Date.parse(now))).toBe(false);
});
