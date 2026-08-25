import { describe, expect, it, vi } from "vitest";
import { clearLocalCacheIfRequested } from "./localCacheReset";

describe("local cache reset", () => {
  it("clears origin storage once and preserves the remaining URL", () => {
    const localClear = vi.fn();
    const sessionClear = vi.fn();
    const sessionSetItem = vi.fn();
    const replaceState = vi.fn();

    expect(clearLocalCacheIfRequested({
      location: { href: "https://warplet.10x.meme/?clearcache=1&warplet=8535#details" },
      history: { state: { test: true }, replaceState },
      localStorage: { clear: localClear, setItem: vi.fn() },
      sessionStorage: { clear: sessionClear, setItem: sessionSetItem },
    })).toBe(true);

    expect(localClear).toHaveBeenCalledOnce();
    expect(sessionClear).toHaveBeenCalledOnce();
    expect(sessionSetItem).toHaveBeenCalledWith("warplets:server-cache-reset-pending", "1");
    expect(replaceState).toHaveBeenCalledWith(
      { test: true },
      "",
      "/?warplet=8535#details",
    );
  });

  it("does nothing unless clearcache is exactly 1", () => {
    const clear = vi.fn();
    const replaceState = vi.fn();

    expect(clearLocalCacheIfRequested({
      location: { href: "https://warplet.10x.meme/?clearcache=true" },
      history: { state: null, replaceState },
      localStorage: { clear, setItem: vi.fn() },
      sessionStorage: { clear, setItem: vi.fn() },
    })).toBe(false);

    expect(clear).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
