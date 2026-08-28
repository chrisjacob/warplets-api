import { describe, expect, it } from "vitest";
import {
  formatStatsFriendFilterLabel,
  getStatsFriendFilterFid,
  getStatsFriendFilterWallet,
} from "./statsHolderFilter";

describe("Stats holder friend-filter routes", () => {
  it("reads and normalizes a valid wallet filter", () => {
    expect(getStatsFriendFilterWallet("?wallet=0x1234567890ABCDEF1234567890ABCDEF12345678"))
      .toBe("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("ignores missing and invalid wallet filters", () => {
    expect(getStatsFriendFilterWallet("?range=30d")).toBeNull();
    expect(getStatsFriendFilterWallet("?wallet=10xchris.eth")).toBeNull();
  });

  it("reads a valid FID filter and rejects invalid values", () => {
    expect(getStatsFriendFilterFid("?fid=1129138")).toBe(1_129_138);
    expect(getStatsFriendFilterFid("?fid=0")).toBeNull();
    expect(getStatsFriendFilterFid("?fid=not-a-fid")).toBeNull();
  });

  it("builds a visible identity label for wallet and FID-scoped shares", () => {
    expect(formatStatsFriendFilterLabel(null, 1_129_138))
      .toBe("Viewing Top 10 Friends for Farcaster FID #1,129,138");
    expect(formatStatsFriendFilterLabel("0x1234", null))
      .toBe("Viewing Top 10 Friends for 0x1234");
  });
});
