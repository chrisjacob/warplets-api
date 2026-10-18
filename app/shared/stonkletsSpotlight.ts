import { STONKLETS_CATALOG, type MarketMetrics } from "./stonkletsCatalog";

export interface SpotlightCandidate {
  pairId: string; returns: { "1h": number; "4h": number; "24h": number };
  quoteAt: string; score: number;
}
export interface ThesisSource {
  excerpt?: string;
  id: string; title: string; url: string; publishedAt: string; fetchedAt: string;
  publisher: string; eventAt?: string;
}
export interface SpotlightThesis {
  strategy?: "daily-catalyst-v2" | "trending-news-v3";
  headline?: string;
  catalystType?: "upcoming" | "news";
  catalystAt?: string;
  leadSourceId?: string;
  dayNumber?: number;
  followUp?: "new-evidence" | "continuing";
  researchCoverage?: number;
  preview?: boolean;
  id: string; pairId: string; selectedAt: string; quoteAt: string;
  kind: "bullish" | "relative-strength"; eligibleCount: number; totalCount: number;
  returns: SpotlightCandidate["returns"]; score: number; explanation: string;
  sources: ThesisSource[]; supporting: string[]; uncertainty: string;
  exposure: string | null; researchStatus: "sources" | "no-catalyst" | "unavailable";
  withdrawnAt?: string | null; withdrawalReason?: string | null;
}
export interface SpotlightResponse {
  entries?: SpotlightThesis[];
  thesis: SpotlightThesis | null; lastEvaluatedAt: string | null;
  status: "current" | "retained" | "archived" | "withdrawn" | "unavailable";
}
export const validNewsId = (id: string) => /^(?:\d{10}-[a-z0-9-]{1,60}|news-[a-f0-9]{24})$/.test(id);
export const thesisTitle = (thesis: Pick<SpotlightThesis, "kind" | "strategy">) => thesis.strategy === "daily-catalyst-v2" ? "The Thesis" : thesis.kind === "bullish" ? "Bullish Thesis" : "Relative Strength Thesis";
export const signedReturn = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

/** Derive every window from the same bStock quote history; never blend return providers. */
export function spotlightHistoryMetrics(quote: MarketMetrics, points: readonly { time: number; price: number }[]): MarketMetrics | null {
  const end = Date.parse(quote.updatedAt ?? "") / 1000;
  if (!Number.isFinite(end) || quote.status !== "live" || !Number.isFinite(quote.price) || quote.price! <= 0) return null;
  const valid = points.filter(point => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0 && point.time <= end);
  const changes = [3600, 14400, 86400].map(seconds => {
    const target = end - seconds;
    const nearest = valid.reduce<{ time: number; price: number } | null>((best, point) => !best || Math.abs(point.time - target) < Math.abs(best.time - target) ? point : best, null);
    // CMC quotes are sampled every ten minutes. Reject missing baselines rather than shortening windows.
    if (nearest && Math.abs(nearest.time - target) <= 5 * 60) return (quote.price! / nearest.price - 1) * 100;
    // The 24h chart can trim its oldest sample against wall time while the quote
    // is several minutes old. Use that same CMC quote's reported 24h window;
    // never substitute another provider or approximate a missing 4h baseline.
    return seconds === 86400 && quote.change24h != null && Number.isFinite(quote.change24h) ? quote.change24h : null;
  });
  if (changes.some(change => change == null || !Number.isFinite(change))) return null;
  return { ...quote, change1h: changes[0]!, change4h: changes[1]!, change24h: changes[2]! };
}

export function rankSpotlight(metrics: ReadonlyMap<string, MarketMetrics>, now = Date.now()): SpotlightCandidate[] {
  const candidates: SpotlightCandidate[] = [];
  for (const entry of STONKLETS_CATALOG.filter(entry => entry.launchStatus === "launched")) {
    const metric = metrics.get(entry.id);
    const age = now - Date.parse(metric?.updatedAt ?? "");
    if (!metric || metric.status !== "live" || !Number.isFinite(metric.price) || metric.price! <= 0 || !Number.isFinite(age) || age < -60_000 || age > 30 * 60_000) continue;
    const values = [metric.change1h, metric.change4h, metric.change24h];
    if (values.some(value => value == null || !Number.isFinite(value) || value < -100)) continue;
    candidates.push({ pairId: entry.id, returns: { "1h": metric.change1h!, "4h": metric.change4h!, "24h": metric.change24h! }, quoteAt: metric.updatedAt!, score: 0 });
  }
  // Midrank percentiles give equal returns equal weight, independent of catalog order.
  for (const candidate of candidates) {
    for (const [range, weight] of [["1h", 0.6], ["4h", 0.3], ["24h", 0.1]] as const) {
      const below = candidates.filter(other => other.returns[range] < candidate.returns[range]).length;
      const equal = candidates.filter(other => other.returns[range] === candidate.returns[range]).length;
      candidate.score += weight * (below + (equal - 1) / 2) / Math.max(1, candidates.length - 1);
    }
    candidate.score = Math.round(candidate.score * 1e12) / 1e12;
  }
  const allNegative = candidates.length > 0 && candidates.every(candidate => candidate.returns["1h"] < 0);
  return candidates.sort((a, b) => (allNegative ? b.returns["1h"] - a.returns["1h"] : 0)
    || b.score - a.score || b.returns["1h"] - a.returns["1h"] || a.pairId.localeCompare(b.pairId));
}

export function spotlightExposure(pairId: string): string | null {
  if (pairId === "direxion-soxs") return "Inverse / 3× daily leveraged exposure. Positive token momentum does not mean semiconductor stocks are rising.";
  if (pairId === "direxion-soxl") return "3× daily leveraged exposure. Leverage can amplify short-term moves and affects this ranking.";
  if (pairId === "tether-gold") return "Gold-linked token exposure, not company stock.";
  if (["spy", "invesco-qqq"].includes(pairId)) return "ETF-linked exposure, not an individual company stock.";
  return null;
}

export function createSpotlight(ranked: SpotlightCandidate[], selectedAt: string): SpotlightThesis | null {
  if (ranked.length < 12) return null;
  const winner = ranked[0]!;
  const allNegative = ranked.every(candidate => candidate.returns["1h"] < 0);
  const kind = winner.returns["1h"] > 0 ? "bullish" : "relative-strength";
  return {
    id: `${selectedAt.slice(0, 13).replace(/[-T:]/g, "")}-${winner.pairId}`,
    pairId: winner.pairId, selectedAt, quoteAt: winner.quoteAt, kind,
    eligibleCount: ranked.length, totalCount: STONKLETS_CATALOG.filter(entry => entry.launchStatus === "launched").length,
    returns: winner.returns, score: winner.score,
    explanation: allNegative ? `Smallest 1h loss among ${ranked.length} evaluated bStocks: ${signedReturn(winner.returns["1h"])}.`
      : `Highest weighted momentum score among ${ranked.length} evaluated bStocks; ${signedReturn(winner.returns["1h"])} over 1h.`,
    sources: [], supporting: [], researchStatus: "no-catalyst",
    uncertainty: "Momentum can reverse quickly. News context does not establish what caused a price move.",
    exposure: spotlightExposure(winner.pairId),
  };
}

export function spotlightStatus(thesis: SpotlightThesis | null, archived = false, now = Date.now()): SpotlightResponse["status"] {
  if (!thesis) return "unavailable";
  if (thesis.withdrawnAt) return "withdrawn";
  if (archived) return "archived";
  return now - Date.parse(thesis.selectedAt) >= (thesis.strategy === "daily-catalyst-v2" ? 24 : 2) * 3600_000 ? "retained" : "current";
}
