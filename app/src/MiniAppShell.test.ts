import { describe, expect, it } from "vitest";
import { getVisualViewportMetrics, shouldSkipBackgroundVideo } from "./MiniAppShell";

describe("shouldSkipBackgroundVideo", () => {
  it("allows decorative video with default motion and data preferences", () => {
    expect(shouldSkipBackgroundVideo(false, false)).toBe(false);
  });

  it("skips decorative video when reduced motion is preferred", () => {
    expect(shouldSkipBackgroundVideo(true, false)).toBe(true);
  });

  it("skips decorative video when data saver is enabled", () => {
    expect(shouldSkipBackgroundVideo(false, true)).toBe(true);
  });

  it("skips decorative video when reduced data is preferred", () => {
    expect(shouldSkipBackgroundVideo(false, false, true)).toBe(true);
  });
});

describe("getVisualViewportMetrics", () => {
  it("uses the live visual viewport and rounds fractional browser measurements", () => {
    expect(getVisualViewportMetrics(611.6, 24.4, 800)).toEqual({
      height: "612px",
      offsetTop: "24px",
    });
  });

  it("falls back to the window height and clamps an invalid offset", () => {
    expect(getVisualViewportMetrics(undefined, -10, 720)).toEqual({
      height: "720px",
      offsetTop: "0px",
    });
  });
});
