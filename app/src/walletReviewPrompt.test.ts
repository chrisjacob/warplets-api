import { describe, expect, it } from "vitest";
import type { EthereumProvider } from "./walletTrade";
import { getExternalWalletReviewName } from "./walletReviewPrompt";

const request = async () => null;

describe("getExternalWalletReviewName", () => {
  it("uses WalletConnect peer metadata", () => {
    const provider: EthereumProvider = {
      request,
      connectorId: "trustconnect-walletconnect",
      walletConnectPeer: { name: "Trust Wallet" },
    };
    expect(getExternalWalletReviewName(provider)).toBe("Trust Wallet");
  });

  it("identifies injected MetaMask", () => {
    const provider = { request, connectorId: "legacy-injected", isMetaMask: true };
    expect(getExternalWalletReviewName(provider)).toBe("MetaMask");
  });

  it("does not prompt for embedded wallets", () => {
    expect(getExternalWalletReviewName({ request, connectorId: "base-account" })).toBeNull();
    expect(getExternalWalletReviewName({ request, connectorId: "farcaster" })).toBeNull();
  });
});
