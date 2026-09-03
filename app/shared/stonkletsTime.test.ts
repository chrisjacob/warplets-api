import { describe, expect, it } from "vitest";
import {
  DEFAULT_STONKLET_CHANGE_RANGE,
  STONKLET_CHANGE_RANGES,
  parseStonkletChangeRange,
  stonkletChangeRangeSeconds,
  stonkletRangeCacheSeconds,
} from "./stonkletsTime";

describe("Stonklets change ranges", () => {
  it("accepts every supported URL value and rejects unknown values", () => {
    for (const range of STONKLET_CHANGE_RANGES) expect(parseStonkletChangeRange(range)).toBe(range);
    expect(parseStonkletChangeRange("5m")).toBeNull();
    expect(parseStonkletChangeRange("ALL")).toBeNull();
    expect(parseStonkletChangeRange(null)).toBeNull();
    expect(DEFAULT_STONKLET_CHANGE_RANGE).toBe("24h");
  });

  it("maps ranges to retention windows and response cache durations", () => {
    expect(stonkletChangeRangeSeconds("1h")).toBe(3_600);
    expect(stonkletChangeRangeSeconds("90d")).toBe(90 * 24 * 3_600);
    expect(stonkletChangeRangeSeconds("all")).toBeNull();
    expect(STONKLET_CHANGE_RANGES.map(stonkletRangeCacheSeconds)).toEqual([60, 300, 300, 900, 900, 900, 21_600]);
  });
});
