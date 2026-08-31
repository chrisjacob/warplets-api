export const SEARCH_RESULT_LAYOUTS = ["hero", "grid", "compact", "card", "listing", "full", "slides"] as const;

export type SearchResultLayout = (typeof SEARCH_RESULT_LAYOUTS)[number];

export const SEARCH_RESULT_LAYOUT_STORAGE_KEY = "warplets-search-result-layout-v1";

export const SEARCH_RESULT_LAYOUT_LABELS: Record<SearchResultLayout, string> = {
  card: "Card",
  hero: "Hero",
  grid: "Grid",
  compact: "Compact",
  listing: "Listing",
  full: "Full",
  slides: "Slides",
};

export function isSearchResultLayout(value: unknown): value is SearchResultLayout {
  return typeof value === "string" && SEARCH_RESULT_LAYOUTS.includes(value as SearchResultLayout);
}

export function readSearchResultLayout(storage?: Pick<Storage, "getItem"> | null): SearchResultLayout {
  if (!storage) return "listing";
  try {
    const value = storage.getItem(SEARCH_RESULT_LAYOUT_STORAGE_KEY);
    return isSearchResultLayout(value) ? value : "listing";
  } catch {
    return "listing";
  }
}

export function writeSearchResultLayout(
  storage: Pick<Storage, "setItem"> | null | undefined,
  layout: SearchResultLayout,
): void {
  if (!storage) return;
  try {
    storage.setItem(SEARCH_RESULT_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // The layout still changes for this session when storage is unavailable.
  }
}

export function getNextSearchResultLayout(layout: SearchResultLayout): SearchResultLayout {
  const index = SEARCH_RESULT_LAYOUTS.indexOf(layout);
  return SEARCH_RESULT_LAYOUTS[(index + 1) % SEARCH_RESULT_LAYOUTS.length];
}
