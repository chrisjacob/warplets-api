import { createSpotlight, type SpotlightCandidate, type SpotlightThesis, type ThesisSource } from "./stonkletsSpotlight";

export interface CatalystResearch { sources: ThesisSource[]; selected: string[]; status: string }
const DAY = 86_400_000;

/** Editorial relevance, not a measured social-trending score or a price forecast. */
export function catalystScore(source: ThesisSource, now: number): number {
  const published = Date.parse(source.publishedAt), event = Date.parse(source.eventAt ?? "");
  if (!Number.isFinite(published) || published > now) return 0;
  if (/\b(cancelled|canceled|postponed)\b/i.test(source.title)) return 0;
  const age = (now - published) / DAY;
  if (Number.isFinite(event) && event >= Math.floor(now / DAY) * DAY && event - now <= 7 * DAY && age <= 90) {
    return 80 + 12 * (1 - (event - now) / (7 * DAY)) + (age <= 1 ? 6 : 0);
  }
  // Filing metadata alone does not explain a catalyst. Do not dress it up as news.
  if (age > 7 || source.publisher === "SEC EDGAR") return 0;
  if (!/earnings|results|revenue|launch|introduc|unveil|approv|partnership|agreement|acqui|merger|deliver|production|deploy|investment|contract|monetary|interest rate|FOMC|policy statement|now supports|new updates/i.test(source.title)) return 0;
  // Expired forward-looking announcements cannot become fresh catalysts.
  if (/\b(?:to announce|to report|will report|will announce|to host|will host)\b/i.test(source.title)) return 0;
  return (source.publisher === "Federal Reserve" ? 48 : 65) + 20 * Math.max(0, 1 - age / 7);
}

export function selectDailySpotlight(ranked: SpotlightCandidate[], research: ReadonlyMap<string, CatalystResearch>, now: string, previous?: SpotlightThesis | null): SpotlightThesis | null {
  if (ranked.length < 12) return null;
  const coverage = ranked.filter(candidate => research.get(candidate.pairId)?.status !== "unavailable" && research.has(candidate.pairId)).length;
  if (coverage < 12) return null;
  const options = ranked.flatMap(candidate => {
    const sources = research.get(candidate.pairId)?.sources ?? [];
    const changedSchedule = sources.some(source => /\b(cancelled|canceled|postponed)\b/i.test(source.title));
    return sources.map(source => ({ candidate, source, relevance: changedSchedule && source.eventAt ? 0 : catalystScore(source, Date.parse(now)) }));
  })
    .filter(option => option.relevance > 0)
    .sort((a, b) => (b.relevance + b.candidate.score * 5) - (a.relevance + a.candidate.score * 5)
      || b.source.publishedAt.localeCompare(a.source.publishedAt) || a.candidate.pairId.localeCompare(b.candidate.pairId) || a.source.id.localeCompare(b.source.id));
  const best = options[0];
  if (!best) return null;
  const thesis = createSpotlight([best.candidate, ...ranked.filter(item => item !== best.candidate)], now)!;
  const evidence = research.get(best.candidate.pairId)!;
  const upcoming = Boolean(best.source.eventAt && best.source.eventAt.slice(0, 10) >= now.slice(0, 10));
  const samePair = previous?.strategy === "daily-catalyst-v2" && previous.pairId === thesis.pairId && Date.parse(now) - Date.parse(previous.selectedAt) <= 27 * 3600_000;
  const sourceChanged = samePair && !previous.sources.some(source => source.id === best.source.id && source.title === best.source.title && source.publishedAt === best.source.publishedAt && source.eventAt === best.source.eventAt && source.excerpt === best.source.excerpt);
  return { ...thesis, strategy: "daily-catalyst-v2", headline: best.source.title,
    catalystType: upcoming ? "upcoming" : "news", catalystAt: best.source.eventAt, leadSourceId: best.source.id,
    explanation: upcoming
      ? `Scheduled for ${best.source.eventAt}. A date to watch as expectations build; the outcome and price reaction remain unknown.`
      : `${Date.parse(now) - Date.parse(best.source.publishedAt) <= DAY ? "A new development" : "An ongoing story from " + best.source.publishedAt.slice(0, 10)} to watch today. The story may attract attention to the paired Stonklet; its market decides the response.`,
    uncertainty: upcoming ? "The schedule can change. Expectations are speculative; this does not establish trader positioning or predict the result." : "Coverage does not establish social popularity, buying pressure, or what caused a price move.",
    sources: [best.source, ...evidence.sources.filter(source => source.id !== best.source.id)],
    supporting: [...evidence.sources].filter(source => source.id !== best.source.id)
      .sort((a, b) => Number(evidence.selected.includes(b.id)) - Number(evidence.selected.includes(a.id))).slice(0, 2).map(source => source.title),
    researchStatus: "sources", researchCoverage: coverage,
    dayNumber: samePair ? (previous.dayNumber ?? 1) + 1 : 1,
    ...(samePair ? { followUp: sourceChanged ? "new-evidence" as const : "continuing" as const } : {}),
  };
}
