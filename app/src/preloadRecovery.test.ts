import { describe, expect, it } from "vitest";
import { claimPreloadRecovery, shouldReloadForPreloadError } from "./preloadRecovery";

describe("shouldReloadForPreloadError", () => {
  it("keeps the retry guard across another failed page boot", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const context = { appMounted: false, embedded: false };
    expect(claimPreloadRecovery(storage, "recovery", context)).toBe(true);
    expect(claimPreloadRecovery(storage, "recovery", context)).toBe(false);
  });
  it("does not auto-reload when the retry guard cannot be persisted", () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("Storage blocked"); } };
    expect(claimPreloadRecovery(storage, "recovery", { appMounted: false, embedded: false })).toBe(false);
  });
  it("allows one recovery reload when the initial app chunk cannot boot", () => {
    expect(shouldReloadForPreloadError({
      appMounted: false,
      embedded: false,
      recoveryAttempted: false,
    })).toBe(true);
  });

  it("preserves a mounted app before the window load event has fired", () => {
    expect(shouldReloadForPreloadError({
      appMounted: true,
      embedded: false,
      recoveryAttempted: false,
    })).toBe(false);
  });

  it("never reloads an embedded app or repeats recovery", () => {
    expect(shouldReloadForPreloadError({
      appMounted: false,
      embedded: true,
      recoveryAttempted: false,
    })).toBe(false);
    expect(shouldReloadForPreloadError({
      appMounted: false,
      embedded: false,
      recoveryAttempted: true,
    })).toBe(false);
  });
});
