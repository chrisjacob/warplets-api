import { describe, expect, it } from "vitest";
import {
  SEARCH_RESULT_RENDER_WINDOW_SIZE,
  alignSearchResultWindowStart,
  clampSearchResultWindowStart,
  getSearchResultLayoutColumnCount,
} from "./searchResultWindow";

describe("search result render window", () => {
  it("uses row-aligned column counts for every layout", () => {
    expect(getSearchResultLayoutColumnCount("grid")).toBe(4);
    expect(getSearchResultLayoutColumnCount("hero")).toBe(2);
    expect(getSearchResultLayoutColumnCount("card")).toBe(2);
    expect(getSearchResultLayoutColumnCount("compact")).toBe(1);
    expect(getSearchResultLayoutColumnCount("listing")).toBe(1);
    expect(getSearchResultLayoutColumnCount("full")).toBe(1);
    expect(getSearchResultLayoutColumnCount("slides")).toBe(1);
  });

  it("keeps lists of 200 or fewer results at the beginning", () => {
    expect(clampSearchResultWindowStart(100, SEARCH_RESULT_RENDER_WINDOW_SIZE, 1)).toBe(0);
    expect(clampSearchResultWindowStart(52, 120, 4)).toBe(0);
  });

  it("aligns grid windows to complete rows", () => {
    expect(alignSearchResultWindowStart(51, 4)).toBe(48);
    expect(alignSearchResultWindowStart(52, 4)).toBe(52);
    expect(clampSearchResultWindowStart(52, 700, 4)).toBe(52);
  });

  it("clamps the final window without exceeding the 200-result cap", () => {
    const start = clampSearchResultWindowStart(10_000, 701, 4);
    expect(start).toBe(504);
    expect(701 - start).toBeLessThanOrEqual(SEARCH_RESULT_RENDER_WINDOW_SIZE);
  });
});
