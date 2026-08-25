import { describe, expect, it } from "vitest";
import { shouldReloadForPreloadError } from "./preloadRecovery";

describe("shouldReloadForPreloadError", () => {
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
