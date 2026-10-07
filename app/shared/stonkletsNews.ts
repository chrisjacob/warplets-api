import { newsHistoryCutoff } from "./stonkletsNewsDates";
import reviewedFingerprints from "./stonkletsNarrativeReviews.json";
import { sha256, stringToHex } from "viem";
import { qualifyingNarrative } from "./stonkletsNewsEligibility";
import { getDomain } from "tldts";
import { STONKLETS_BY_ID } from "./stonkletsCatalog";
import type { SpotlightThesis, ThesisSource } from "./stonkletsSpotlight";
export interface NewsItem {
  id: string; articleId: string; narrativeKey: string; pairId: string;
  strategy: "narrative-news-v4"; headline: string; selectedAt: string;
  sourceDomain: string; relation: "direct" | "sector"; evidence: string;
  sources: ThesisSource[]; leadSourceId: string; sourcePriority: number;
  published?: boolean; withdrawnAt?: string | null; withdrawalReason?: string | null;
}
export type ShareNews = SpotlightThesis | NewsItem;
export interface NewsResponse { entries: NewsItem[]; byPair?: Record<string, NewsItem[]>; news?: NewsItem | null; lastEvaluatedAt: string | null; status: "current" | "retained" | "unavailable" | "archived" | "withdrawn" }
export function sourceDomain(url: string): string {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? getDomain(parsed.hostname) ?? parsed.hostname : ""; } catch { return ""; }
}
export const newsSource = (item: ShareNews) => item.sources.find(source => source.id === item.leadSourceId) ?? item.sources[0];
export function legacyNews(item: ShareNews): NewsItem {
  if (item.strategy === "narrative-news-v4") return { ...item, sourceDomain: sourceDomain(newsSource(item)?.url ?? "") };
  const source = newsSource(item)!;
  return { id: item.id, articleId: source.url, narrativeKey: normalizedHeadline(item.headline ?? source.title), pairId: item.pairId,
    strategy: "narrative-news-v4", headline: item.headline ?? source.title, selectedAt: item.selectedAt, sourceDomain: sourceDomain(source.url),
    relation: "direct", evidence: "Reviewed company announcement", sources: item.sources, leadSourceId: source.id, sourcePriority: 0,
    withdrawnAt: item.withdrawnAt, withdrawalReason: item.withdrawalReason };
}
export function normalizedHeadline(title: string): string { return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
/** Conservative syndication check: preserve materially changed numerical claims. */
export function sameNarrative(a: string, b: string): boolean {
  if (JSON.stringify(a.match(/\d+(?:\.\d+)?/g) ?? []) !== JSON.stringify(b.match(/\d+(?:\.\d+)?/g) ?? [])) return false;
  const words = (text: string) => new Set(normalizedHeadline(text).split(" ").filter(word => word.length > 2));
  const left = words(a), right = words(b);
  return [...left].filter(word => right.has(word)).length / Math.max(1, new Set([...left, ...right]).size) >= .82;
}
export function reconcileNarrative(item: NewsItem, prior: Iterable<NewsItem>): NewsItem {
  const time = Date.parse(newsSource(item)!.publishedAt);
  for (const old of prior) if (old.pairId === item.pairId && Math.abs(time - Date.parse(newsSource(old)!.publishedAt)) <= 3 * 86400_000 && sameNarrative(item.headline, old.headline))
    return { ...item, narrativeKey: old.narrativeKey };
  return item;
}
export async function newsHash(value: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2,"0")).join("").slice(0,24); }
export function canonicalNewsUrl(value: string): string {
  const url = new URL(value); if (!sourceDomain(value)) throw new Error("Unsafe source URL");
  url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
/** Only exact checked-in editorial reviews can bypass keyword heuristics. */
export function narrativeReviewFingerprint(item: NewsItem): string {
  const source = newsSource(item);
  return sha256(stringToHex(JSON.stringify([item.id, item.pairId, item.headline, item.relation, item.evidence,
    source?.url, source?.publishedAt, source?.title, source?.excerpt])));
}
const reviewed = new Set<string>(reviewedFingerprints);
export function reviewedNarrative(item: NewsItem): boolean {
  return reviewed.has(narrativeReviewFingerprint(item));
}
export function selectNews(items: readonly NewsItem[], pairId?: string, now = Date.now()): NewsItem[] {
  const cutoff = newsHistoryCutoff(now);
  const eligible = items.filter(item => { const date = Date.parse(newsSource(item)?.publishedAt ?? ""); return !item.withdrawnAt && (qualifyingNarrative(newsSource(item)!, now) || reviewedNarrative(item)) && date >= cutoff && date <= now && (pairId ? item.pairId === pairId : STONKLETS_BY_ID.get(item.pairId)?.launchStatus === "launched"); });
  // Select the best original source for each repeated narrative before sorting the feed.
  const distinct = new Map<string, NewsItem>();
  for (const item of eligible) { const key = `${item.pairId}:${item.narrativeKey}`; const old = distinct.get(key); if (!old || item.sourcePriority < old.sourcePriority || (item.sourcePriority === old.sourcePriority && newsSource(item)!.publishedAt > newsSource(old)!.publishedAt)) distinct.set(key,item); }
  const ordered = [...distinct.values()].sort((a,b) => newsSource(b)!.publishedAt.localeCompare(newsSource(a)!.publishedAt) || a.id.localeCompare(b.id));
  const stocks = new Set<string>();
  return ordered.filter(item => { if (pairId) return true; if (stocks.has(item.pairId)) return false; stocks.add(item.pairId); return true; }).slice(0,10);
}
export function validNewsItem(value: unknown): value is NewsItem {
  const item = value as NewsItem;
  return Boolean(item && item.strategy === "narrative-news-v4" && /^news-[a-f0-9]{24}$/.test(item.id) && STONKLETS_BY_ID.has(item.pairId)
    && typeof item.headline === "string" && item.headline.length <= 500 && Array.isArray(item.sources) && item.sources.length && sourceDomain(newsSource(item)?.url ?? "") && Number.isFinite(Date.parse(newsSource(item)?.publishedAt ?? "")));
}
