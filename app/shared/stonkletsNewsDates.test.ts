import { describe, expect, it } from "vitest";
import { newsHistoryCutoff, newsPublicationLabel } from "./stonkletsNewsDates";
describe("narrative publication dates", () => {
  it("uses eleven calendar months including month-end clamping", () => {
    expect(new Date(newsHistoryCutoff(Date.parse("2026-10-07T17:12:00Z"))).toISOString()).toBe("2025-11-07T00:00:00.000Z");
    expect(new Date(newsHistoryCutoff(Date.parse("2026-01-31T17:12:00Z"))).toISOString()).toBe("2025-02-28T00:00:00.000Z");
  });
  it("shows ordinal day and full month without shifting day-precision UTC dates", () => {
    for (const [day, ordinal] of [[1,"1st"],[2,"2nd"],[3,"3rd"],[11,"11th"],[12,"12th"],[13,"13th"],[21,"21st"],[28,"28th"]] as const)
      expect(newsPublicationLabel(`2026-06-${String(day).padStart(2,"0")}T00:00:00Z`)).toBe(`${ordinal} June`);
    expect(newsPublicationLabel("invalid")).toBe("");
  });
});
