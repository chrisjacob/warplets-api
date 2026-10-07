import { describe, it, expect } from "vitest";
import backfill from "./stonkletsNarrativeBackfill.json";
import { legacyNews, reviewedNarrative, selectNews, sourceDomain, validNewsItem, type NewsItem } from "./stonkletsNews";
import saved from "./stonkletsNewsPreview.json";
const entries = backfill.entries as NewsItem[];
const now = Date.parse("2026-10-07T02:00:00Z");
describe("reviewed historical narratives", () => {
  it("keeps shared article content consistent across stock associations", () => {
    const articles = new Map<string, unknown>();
    for (const item of entries) {
      const source = item.sources[0]!;
      const content = [item.headline, item.narrativeKey, source.title, source.publishedAt, source.excerpt];
      if (articles.has(source.url)) expect(content, source.url).toEqual(articles.get(source.url));
      articles.set(source.url, content);
    }
  });
  it("preserves catalog identities, original dates and authoritative source domains", () => {
    for (const item of entries) {
      expect(validNewsItem(item), item.headline).toBe(true);
      expect(item.sourceDomain).toBe(sourceDomain(item.sources[0]!.url));
      expect(reviewedNarrative(item)).toBe(true);
      expect(selectNews([item], item.pairId, now)).toHaveLength(1);
      expect("returns" in item).toBe(false);
    }
    expect(new Set(entries.map(item => item.id)).size).toBe(entries.length);
  });
  it("never trusts altered dates, mappings, claims or source URLs as editorial reviews", () => {
    const item = entries[0]!;
    for (const changed of [
      { ...item, pairId: "direxion-soxs" }, { ...item, headline: "Invented claim" },
      { ...item, relation: "sector" as const }, { ...item, evidence: "Invented evidence" },
      ...["url", "title", "publishedAt", "excerpt"].map(key => ({ ...item, sources: [{ ...item.sources[0]!, [key]: "altered" }] })),
    ]) expect(reviewedNarrative(changed)).toBe(false);
  });
  it("still expires or withdraws approved stories and limits the hero to distinct launched stocks", () => {
    for (const item of entries) {
      expect(selectNews([{ ...item, withdrawnAt: "2026-10-07" }], item.pairId, now)).toEqual([]);
      expect(selectNews([item], item.pairId, now + 366 * 86400000)).toEqual([]);
    }
    const hero = selectNews([...entries, ...saved.map(item => legacyNews(item as never))], undefined, now);
    expect(hero).toHaveLength(10);
    expect(new Set(hero.map(item => item.pairId)).size).toBe(10);
  });
});
