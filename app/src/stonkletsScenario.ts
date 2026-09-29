import { STONKLETS_CATALOG, type StonkletCatalogEntry } from "../shared/stonkletsCatalog";

const PAIR_IDS = ["apple", "tesla", "microsoft", "alphabet", "netflix", "nvidia", "spacex", "alibaba", "gamestop", "robinhood"];
export function scenarioPairings(catalog: readonly StonkletCatalogEntry[]) {
  return PAIR_IDS.flatMap((id) => {
    const entry = catalog.find((candidate) => candidate.id === id);
    return entry ? [entry] : [];
  });
}
export const SCENARIO_PAIRS = scenarioPairings(STONKLETS_CATALOG);
export const SCENARIO_DURATION_MS = Math.max(1, SCENARIO_PAIRS.length) * 1500;
export function scenarioProgress(elapsed: number, duration: number): number {
  return Number.isFinite(elapsed) && duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;
}
export function scenarioPairAt(pairs: readonly StonkletCatalogEntry[], progress: number) {
  return pairs[Math.min(pairs.length - 1, Math.floor(scenarioProgress(progress, 1) * pairs.length))];
}

const preloads = new Map<string, Promise<void>>();
export function preloadScenarioImages(): Promise<void[]> {
  const sources = new Set(SCENARIO_PAIRS.flatMap((entry) => [entry.stock.logo, entry.stonklet.image]));
  sources.add("/stonklets/Street_Fighter_VS_logo.png");
  return Promise.all([...sources].map((src) => {
    const existing = preloads.get(src);
    if (existing) return existing;
    const pending = new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.onload = () => { image.onload = image.onerror = null; resolve(); };
      image.onerror = () => { image.onload = image.onerror = null; preloads.delete(src); resolve(); };
      image.src = src;
    });
    preloads.set(src, pending);
    return pending;
  }));
}
