import { describe, expect, it, vi } from "vitest";
import {
  SEARCH_RESULT_LAYOUT_STORAGE_KEY,
  getNextSearchResultLayout,
  readSearchResultLayout,
  writeSearchResultLayout,
} from "./searchResultLayout";

describe("search result layouts", () => {
  it("cycles through every layout in display order", () => {
    expect(getNextSearchResultLayout("hero")).toBe("grid");
    expect(getNextSearchResultLayout("grid")).toBe("compact");
    expect(getNextSearchResultLayout("compact")).toBe("card");
    expect(getNextSearchResultLayout("card")).toBe("listing");
    expect(getNextSearchResultLayout("listing")).toBe("full");
    expect(getNextSearchResultLayout("full")).toBe("slides");
    expect(getNextSearchResultLayout("slides")).toBe("hero");
  });

  it("uses listing for missing or invalid stored values", () => {
    expect(readSearchResultLayout(null)).toBe("listing");
    expect(readSearchResultLayout({ getItem: () => "unknown" })).toBe("listing");
    expect(readSearchResultLayout({ getItem: () => "compact" })).toBe("compact");
  });

  it("persists a valid selection", () => {
    const setItem = vi.fn();
    writeSearchResultLayout({ setItem }, "full");
    expect(setItem).toHaveBeenCalledWith(SEARCH_RESULT_LAYOUT_STORAGE_KEY, "full");
  });
});
