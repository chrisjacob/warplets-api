import type { SearchResultLayout } from "./searchResultLayout";

export const SEARCH_RESULT_RENDER_WINDOW_SIZE = 200;
export const SEARCH_RESULT_RENDER_WINDOW_SHIFT = 50;

export function getSearchResultLayoutColumnCount(layout: SearchResultLayout): number {
  if (layout === "grid") return 4;
  if (layout === "card" || layout === "hero") return 2;
  return 1;
}

export function alignSearchResultWindowStart(index: number, columnCount: number): number {
  return Math.floor(Math.max(0, index) / columnCount) * columnCount;
}

export function clampSearchResultWindowStart(index: number, resultCount: number, columnCount: number): number {
  if (resultCount <= SEARCH_RESULT_RENDER_WINDOW_SIZE) return 0;
  const maximumStart = Math.ceil((resultCount - SEARCH_RESULT_RENDER_WINDOW_SIZE) / columnCount) * columnCount;
  return Math.min(alignSearchResultWindowStart(index, columnCount), maximumStart);
}

export type SearchResultLayoutCorners = {
  topLeft: boolean;
  topRight: boolean;
  bottomLeft: boolean;
  bottomRight: boolean;
};

export function getSearchResultLayoutCorners(
  index: number,
  resultCount: number,
  columnCount: number,
): SearchResultLayoutCorners {
  const lastIndex = resultCount - 1;
  const lastRowStart = Math.floor(Math.max(0, lastIndex) / columnCount) * columnCount;
  return {
    topLeft: resultCount > 0 && index === 0,
    topRight: resultCount > 0 && index === Math.min(columnCount, resultCount) - 1,
    bottomLeft: resultCount > 0 && index === lastRowStart,
    bottomRight: resultCount > 0 && index === lastIndex,
  };
}
