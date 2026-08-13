import { describe, expect, it } from "vitest";
import { isLikelyTrustWalletBrowser, resolveFarcasterMobileHandoffUrl } from "./farcasterHandoff";

const relayUrl = "https://farcaster.xyz/~/siwf/?channelToken=test-channel";

describe("Farcaster mobile handoff", () => {
  it("keeps an HTTPS SIWF link inside the Trust Wallet dapp browser", () => {
    expect(resolveFarcasterMobileHandoffUrl(relayUrl, {
      userAgent: "TrustWallet/11.20 iPhone",
    })).toBe(relayUrl);
  });

  it("detects Trust Wallet from its injected provider when its user agent is generic", () => {
    expect(isLikelyTrustWalletBrowser({
      userAgent: "Mozilla/5.0 (iPhone)",
      hasTrustWalletEthereum: true,
    })).toBe(true);
    expect(resolveFarcasterMobileHandoffUrl(relayUrl, {
      userAgent: "Mozilla/5.0 (iPhone)",
      providerIsTrust: true,
    })).toBe(relayUrl);
  });

  it("preserves the working direct Farcaster handoff for Base App", () => {
    expect(resolveFarcasterMobileHandoffUrl(relayUrl, {
      userAgent: "BaseApp/1.0 iPhone CoinbaseWallet",
    })).toBe("farcaster://~/siwf/?channelToken=test-channel");
  });
});
