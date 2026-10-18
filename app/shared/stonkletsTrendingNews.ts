import { createSpotlight, type SpotlightCandidate, type SpotlightThesis, type ThesisSource } from "./stonkletsSpotlight";
import type { CatalystResearch } from "./stonkletsCatalyst";

/** Official positive developments; this is not a claim of measured social popularity. */
export function positiveNews(source: ThesisSource, now: number): boolean {
  const age = now - Date.parse(source.publishedAt);
  if (!Number.isFinite(age) || age < 0 || age > 7 * 86400_000 || source.publisher === "SEC EDGAR" || source.publisher === "Federal Reserve") return false;
  const text = `${source.title} ${source.excerpt ?? ""}`;
  if (/\b(loss(?:es)?|declin\w*|falls?|fell|layoffs?|miss(?:es|ed)?|lawsuit|investigation|recall|delay\w*|cancel\w*|postpon\w*|warn\w*|risk\w*|not|fails?|failed)\b|\bcuts? (?:jobs|guidance|forecast|outlook)\b/i.test(text)) return false;
  // Scheduled earnings alone say nothing about the eventual outcome.
  if (/\b(?:to announce|to report|will report|will announce|to host|will host)\b/i.test(source.title)) return false;
  // General advice, executive updates and educational profiles are not trading catalysts.
  if (/\b(?:tips|how to|guide to|leadership update|teacher|classroom|fellowships?)\b/i.test(source.title)) return false;
  if (/\b(?:share repurchase|buyback)\b.*\b(?:increase|expan|authoriz)/i.test(source.title)
    || /\bsecures?\b.*\b(?:agreement|contract|supply|approval)\b/i.test(source.title)) return true;
  return /\b(launch(?:es|ed)?|introduc(?:es|ed|ing)|unveil(?:s|ed)?|approv(?:al|ed|es)|partnership|wins?|won|record|growth|grows?|expands?|expansion|surpass(?:es|ed)?|beats?|raises?|raised|now supports|new updates)\b/i.test(source.title);
}

export async function trendingNewsEntries(ranked: SpotlightCandidate[], research: ReadonlyMap<string, CatalystResearch>, now: string): Promise<SpotlightThesis[]> {
  if (ranked.length < 12 || ranked.filter(item => research.has(item.pairId) && research.get(item.pairId)?.status !== "unavailable").length < 12) return [];
  const seen = new Set<string>();
  const options = ranked.flatMap(candidate => (research.get(candidate.pairId)?.sources ?? [])
    .filter(source => positiveNews(source, Date.parse(now)))
    .map(source => ({ candidate, source })))
    // Newest first; momentum is only a tie-breaker, never the story.
    .sort((a, b) => b.source.publishedAt.localeCompare(a.source.publishedAt) || b.candidate.score - a.candidate.score || a.candidate.pairId.localeCompare(b.candidate.pairId));
  const entries: SpotlightThesis[] = [];
  for (const { candidate, source } of options) {
    // The newest qualifying catalyst is the only candidate for this stock.
    if (seen.has(candidate.pairId)) continue;
    seen.add(candidate.pairId);
    entries.push(await createTrendingNewsEntry(candidate, ranked, source, now));
  }
  return entries;
}

/** Shared immutable identity for hourly discovery and explicitly reviewed backfills. */
export async function createTrendingNewsEntry(candidate: SpotlightCandidate, ranked: SpotlightCandidate[], source: ThesisSource, now: string): Promise<SpotlightThesis> {
  const key = `${candidate.pairId}:${source.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const id = `news-${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 24)}`;
  const base = createSpotlight([candidate, ...ranked.filter(item => item.pairId !== candidate.pairId)], now);
  if (!base) throw new Error("Insufficient backfill quote coverage");
  return { ...base, id, strategy: "trending-news-v3", headline: source.title, leadSourceId: source.id,
    sources: [source], supporting: [], explanation: "", researchStatus: "sources", catalystType: "news" };
}

/** Apply the same stock diversity and recency rule to local archives and the UI. */
export function latestNewsPerStock(entries: readonly SpotlightThesis[], limit = 10): SpotlightThesis[] {
  const seen = new Set<string>();
  return entries.filter(item => !item.withdrawnAt).slice().sort((a, b) =>
    (b.sources.find(source => source.id === b.leadSourceId) ?? b.sources[0])!.publishedAt.localeCompare(
      (a.sources.find(source => source.id === a.leadSourceId) ?? a.sources[0])!.publishedAt)
    || b.selectedAt.localeCompare(a.selectedAt) || a.id.localeCompare(b.id)
  ).filter(item => { if (seen.has(item.pairId)) return false; seen.add(item.pairId); return true; }).slice(0, limit);
}
