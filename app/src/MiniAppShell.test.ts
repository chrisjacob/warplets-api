import { describe, expect, it } from "vitest";
import { shouldSkipBackgroundVideo } from "./MiniAppShell";

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
