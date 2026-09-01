import { describe, expect, it } from "vitest";
import { orderSearchCandidates } from "./searchResultOrder";

describe("search result ordering", () => {
  it("orders the complete candidate set before the first page is selected", () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => ({
      id: index + 1,
      value: index + 1,
      fallbackIndex: index,
    }));

    const firstPage = orderSearchCandidates(candidates, "desc").slice(0, 100);

    expect(firstPage[0]?.id).toBe(10_000);
    expect(firstPage.at(-1)?.id).toBe(9_901);
  });

  it("removes candidates without the selected market value before pagination", () => {
    const candidates = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      value: index === 93 ? 1 : null,
      fallbackIndex: index,
    }));
    candidates.push(
      { id: 450, value: 3, fallbackIndex: 449 },
      { id: 875, value: 2, fallbackIndex: 874 },
    );

    expect(orderSearchCandidates(candidates, "desc", true).map(({ id }) => id)).toEqual([450, 875, 94]);
  });

  it("uses the newest market event as the tie breaker for equal amounts", () => {
    const candidates = [
      { id: 1, value: 2, tieBreakTimestamp: 100, fallbackIndex: 0 },
      { id: 2, value: 2, tieBreakTimestamp: 200, fallbackIndex: 1 },
    ];

    expect(orderSearchCandidates(candidates, "asc").map(({ id }) => id)).toEqual([2, 1]);
  });

  it("reverses the stable fallback when equal offers share the same timestamp", () => {
    const candidates = [
      { id: 1, value: 0.0002, tieBreakTimestamp: 100, fallbackIndex: 0 },
      { id: 2, value: 0.0002, tieBreakTimestamp: 100, fallbackIndex: 1 },
      { id: 3, value: 0.0002, tieBreakTimestamp: 100, fallbackIndex: 2 },
    ];

    expect(orderSearchCandidates(candidates, "asc").map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(orderSearchCandidates(candidates, "desc").map(({ id }) => id)).toEqual([3, 2, 1]);
  });
});
