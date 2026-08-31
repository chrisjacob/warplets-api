import { describe, expect, it } from "vitest";
import { resolveActiveFavouriteWallet } from "./favouriteWallet";

describe("resolveActiveFavouriteWallet", () => {
  it("uses the connected wallet while a local Farcaster primary wallet is unavailable", () => {
    expect(resolveActiveFavouriteWallet(null, "0xconnected")).toBe("0xconnected");
  });

  it("prefers the verified Farcaster primary wallet when it is available", () => {
    expect(resolveActiveFavouriteWallet("0xprimary", "0xconnected")).toBe("0xprimary");
  });

  it("returns null when no favourite-capable wallet is known", () => {
    expect(resolveActiveFavouriteWallet(null, null)).toBeNull();
  });
});
