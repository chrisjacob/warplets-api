import { describe, expect, it } from "vitest";
import { resolveAppCapabilities, resolveAppSurface } from "./appRuntime";

describe("application runtime", () => {
  it("uses only Farcaster Mini App and web surfaces", () => {
    expect(resolveAppSurface(true)).toBe("farcaster-miniapp");
    expect(resolveAppSurface(false)).toBe("web");
  });

  it("uses capability detection for web fallbacks", () => {
    expect(resolveAppCapabilities("farcaster-miniapp")).toMatchObject({ embeddedWallet: true, haptics: true, webShare: false });
    expect(resolveAppCapabilities("web", { share: async () => undefined })).toMatchObject({ embeddedWallet: false, haptics: false, webShare: true });
  });
});
