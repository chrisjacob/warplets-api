import { describe, expect, it, vi } from "vitest";
import { detectMiniAppContext } from "./miniAppContext";

describe("detectMiniAppContext", () => {
  it("returns the SDK result when it resolves", async () => {
    await expect(detectMiniAppContext(async () => true, 50)).resolves.toBe(true);
  });

  it("retries when an iframe host attaches after the first context probe", async () => {
    vi.useFakeTimers();
    const detector = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = detectMiniAppContext(detector, 2_000, 150);
    await vi.advanceTimersByTimeAsync(150);

    await expect(result).resolves.toBe(true);
    expect(detector).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("falls back to web mode when the SDK remains pending", async () => {
    vi.useFakeTimers();
    const result = detectMiniAppContext(() => new Promise<boolean>(() => undefined), 2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("falls back to web mode when no detector is available", async () => {
    await expect(detectMiniAppContext(undefined)).resolves.toBe(false);
  });
});
