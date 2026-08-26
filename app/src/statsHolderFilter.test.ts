import { describe, expect, it } from "vitest";
import { getStatsFriendFilterWallet } from "./statsHolderFilter";

describe("Stats holder friend-filter routes", () => {
  it("reads and normalizes a valid wallet filter", () => {
    expect(getStatsFriendFilterWallet("?wallet=0x1234567890ABCDEF1234567890ABCDEF12345678"))
      .toBe("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("ignores missing and invalid wallet filters", () => {
    expect(getStatsFriendFilterWallet("?range=30d")).toBeNull();
    expect(getStatsFriendFilterWallet("?wallet=10xchris.eth")).toBeNull();
  });
});
