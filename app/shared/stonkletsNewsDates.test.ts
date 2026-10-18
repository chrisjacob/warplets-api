import { describe, expect, it } from "vitest";
import { newsHistoryCutoff, newsPublicationLabel } from "./stonkletsNewsDates";
describe("narrative publication dates", () => {
  it("uses eleven calendar months including month-end clamping", () => {
    expect(new Date(newsHistoryCutoff(Date.parse("2026-10-07T17:12:00Z"))).toISOString()).toBe("2025-11-07T00:00:00.000Z");
    expect(new Date(newsHistoryCutoff(Date.parse("2026-01-31T17:12:00Z"))).toISOString()).toBe("2025-02-28T00:00:00.000Z");
  });
  it("preserves ordinal suffixes for every day of the month", () => {
    const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th", "13th", "14th", "15th", "16th", "17th", "18th", "19th", "20th", "21st", "22nd", "23rd", "24th", "25th", "26th", "27th", "28th", "29th", "30th", "31st"];
    ordinals.forEach((ordinal, index) => {
      expect(newsPublicationLabel(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`)).toBe(`${ordinal} JUL`);
    });
  });
  it("uses exactly three uppercase letters for every month and omits the year", () => {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    months.forEach((month, index) => {
      expect(newsPublicationLabel(`2026-${String(index + 1).padStart(2, "0")}-01T00:00:00Z`)).toBe(`1st ${month}`);
    });
    expect(newsPublicationLabel("2026-10-07T00:00:00Z")).toBe("7th OCT");
  });
  it("uses the UTC date across timezone boundaries and handles invalid dates", () => {
    expect(newsPublicationLabel("2026-10-01T00:30:00+10:00")).toBe("30th SEP");
    expect(newsPublicationLabel("2026-09-30T23:30:00-02:00")).toBe("1st OCT");
    expect(newsPublicationLabel("invalid")).toBe("");
  });
});
