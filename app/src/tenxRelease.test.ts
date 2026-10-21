import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([
  [false, undefined, false],
  [false, "false", false],
  [false, "true", true],
  [true, undefined, true],
  [true, "false", false],
] as const)("uses an explicit production opt-in and an overridable local default (%s / %s)", async (dev, flag, expected) => {
  vi.stubEnv("DEV", dev); vi.stubEnv("VITE_TENX_APP_ENABLED", flag);
  vi.resetModules();
  expect((await import("./tenxRelease")).TENX_APP_ENABLED).toBe(expected);
});
