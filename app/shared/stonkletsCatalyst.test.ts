import { describe, expect, it } from "vitest";
import { STONKLETS_CATALOG } from "./stonkletsCatalog";
import { catalystScore, selectDailySpotlight, type CatalystResearch } from "./stonkletsCatalyst";
import { spotlightStatus, type SpotlightCandidate, type ThesisSource } from "./stonkletsSpotlight";
import { stonkletThesisShare, thesisPostLength } from "./stonkletsThesisShare";
const now = "2026-10-06T00:05:00Z";
const entries = STONKLETS_CATALOG.filter(entry => entry.launchStatus === "launched");
const ranked: SpotlightCandidate[] = entries.map((entry, i) => ({ pairId: entry.id, returns: { "1h": -0.37, "4h": 1, "24h": 2 }, score: i / 20, quoteAt: now }));
const source: ThesisSource = { id: "https://issuer.example/earnings", url: "https://issuer.example/earnings", title: "Earnings call on October 12, 2026", publisher: "Issuer", publishedAt: "2026-09-10T00:00:00Z", fetchedAt: now, eventAt: "2026-10-12" };
const research = () => new Map(entries.map(entry => [entry.id, { sources: [], selected: [], status: "no-catalyst" } as CatalystResearch]));
describe("daily catalyst selection", () => {
  it("selects an upcoming event announced weeks ago ahead of the momentum leader", () => {
    const evidence = research(); evidence.get(entries[0]!.id)!.sources = [source];
    const thesis = selectDailySpotlight(ranked, evidence, now)!;
    expect(thesis.pairId).toBe(entries[0]!.id);
    expect(thesis.catalystType).toBe("upcoming");
    expect(thesis.headline).toBe(source.title);
    expect(thesis.explanation).not.toContain("weighted");
    expect(spotlightStatus(thesis, false, Date.parse(now) + 23 * 3600_000)).toBe("current");
    expect(spotlightStatus(thesis, false, Date.parse(now) + 24 * 3600_000)).toBe("retained");
  });
  it("does not manufacture news from filings, stale stories, or future publications", () => {
    expect(catalystScore({ ...source, eventAt: undefined, publisher: "SEC EDGAR", publishedAt: now }, Date.parse(now))).toBe(0);
    expect(catalystScore({ ...source, eventAt: undefined }, Date.parse(now))).toBe(0);
    expect(catalystScore({ ...source, publishedAt: "2026-10-07" }, Date.parse(now))).toBe(0);
    expect(catalystScore({ ...source, eventAt: "2026-11-01" }, Date.parse(now))).toBe(0);
    expect(selectDailySpotlight(ranked, research(), now)).toBeNull();
  });
  it("distinguishes repeat coverage from new evidence and stops streaks after gaps", () => {
    const evidence = research(); evidence.get(entries[0]!.id)!.sources = [source];
    const first = selectDailySpotlight(ranked, evidence, now)!;
    const second = selectDailySpotlight(ranked, evidence, "2026-10-07T00:05:00Z", first)!;
    expect(second.dayNumber).toBe(2); expect(second.followUp).toBe("continuing");
    evidence.get(entries[0]!.id)!.sources = [{ ...source, id: "https://issuer.example/update", publishedAt: "2026-10-07T00:00:00Z" }];
    expect(selectDailySpotlight(ranked, evidence, "2026-10-07T00:05:00Z", first)?.followUp).toBe("new-evidence");
    expect(selectDailySpotlight(ranked, evidence, "2026-10-09T00:05:00Z", first)?.dayNumber).toBe(1);
  });
  it("requires comparable market and research coverage", () => {
    const evidence = research(); evidence.get(entries[0]!.id)!.sources = [source];
    expect(selectDailySpotlight(ranked.slice(0, 11), evidence, now)).toBeNull();
    for (const entry of entries.slice(0, 9)) evidence.get(entry.id)!.status = "unavailable";
    expect(selectDailySpotlight(ranked, evidence, now)).toBeNull();
  });
  it("does not promote a scheduled event after cancellation coverage", () => {
    const evidence = research(); evidence.get(entries[0]!.id)!.sources = [source, { ...source, id: "cancel", title: "Earnings event postponed", eventAt: undefined, publishedAt: now }];
    expect(selectDailySpotlight(ranked, evidence, now)).toBeNull();
  });
  it.each(entries)("shares catalyst-first bounded posts for $id, keeping signs and links", entry => {
    const evidence = research(); evidence.get(entry.id)!.sources = [source];
    const thesis = { ...selectDailySpotlight(ranked, evidence, now)!, preview: true };
    const post = stonkletThesisShare(entry, "stonklet.10x.meme", thesis);
    for (const [platform, text, limit] of [["twitter", post.twitterText, 280], ["farcaster", post.farcasterText, 1024]] as const) {
      expect(thesisPostLength(text, platform)).toBeLessThanOrEqual(limit);
      expect(text).toContain(source.title);
      expect(text).not.toContain("-0.37%"); expect(text).toContain("news="); expect(text).toContain(source.url);
      expect(text).not.toContain("No confirmed news");
    }
  });
});
