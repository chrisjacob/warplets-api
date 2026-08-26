import { describe, expect, it } from "vitest";
import { resolveOpenSeaLifetimeVolume } from "./stats";

describe("OpenSea lifetime volume corrections", () => {
  it("clamps the small production provider correction to the previous monotonic total", () => {
    expect(
      resolveOpenSeaLifetimeVolume(
        "0.02512116210127208",
        "0.025133787714249883",
      ),
    ).toEqual({
      kind: "bounded_correction",
      effectiveValue: "0.025133787714249883",
    });
  });

  it("accepts increases unchanged", () => {
    expect(resolveOpenSeaLifetimeVolume("1.01", "1")).toEqual({
      kind: "current",
      effectiveValue: "1.01",
    });
  });

  it("allows corrections at the 0.5 percent boundary", () => {
    expect(resolveOpenSeaLifetimeVolume("0.995", "1").kind).toBe("bounded_correction");
  });

  it("continues rejecting larger lifetime-volume regressions", () => {
    expect(resolveOpenSeaLifetimeVolume("0.99", "1")).toEqual({
      kind: "regression",
      effectiveValue: "0.99",
    });
  });
});
