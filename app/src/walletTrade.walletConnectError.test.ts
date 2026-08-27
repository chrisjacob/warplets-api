import { describe, expect, it } from "vitest";
import { isOpaqueWalletConnectNullError } from "./walletTrade";

describe("isOpaqueWalletConnectNullError", () => {
  it("recognizes the Safari WalletConnect null-result crash", () => {
    expect(isOpaqueWalletConnectNullError(
      new TypeError("null is not an object (evaluating 's.message')"),
    )).toBe(true);
  });

  it("does not absorb normal wallet failures", () => {
    expect(isOpaqueWalletConnectNullError(new Error("User rejected the request"))).toBe(false);
    expect(isOpaqueWalletConnectNullError(null)).toBe(false);
  });
});
