import { describe, expect, it } from "vitest";
import { buildWalletConnectRequestLink, getMobileWalletHandoff } from "./mobileWalletHandoff";
import type { EthereumProvider } from "./walletTrade";

const iosSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1";

describe("mobile wallet handoff", () => {
  it("builds the incomplete WalletConnect request URI expected by iOS wallets", () => {
    expect(buildWalletConnectRequestLink("metamask://", "abc123")).toBe("metamask://wc?uri=wc%3Aabc123%402");
    expect(buildWalletConnectRequestLink("https://example.wallet/wc", "abc123")).toBe("https://example.wallet/wc?uri=wc%3Aabc123%402");
  });

  it("targets iOS Safari WalletConnect sessions that advertise a wallet redirect", () => {
    const provider = {
      request: async () => null,
      connectorId: "trustconnect-walletconnect",
      walletConnectPeer: {
        name: "MetaMask",
        sessionTopic: "abc123",
        nativeRedirect: "metamask://",
      },
    } as EthereumProvider;
    expect(getMobileWalletHandoff(provider, iosSafari)).toEqual({
      walletName: "MetaMask",
      url: "metamask://wc?uri=wc%3Aabc123%402",
    });
    expect(getMobileWalletHandoff({
      ...provider,
      walletConnectPeer: {
        ...provider.walletConnectPeer,
        name: "Trust Wallet",
        nativeRedirect: "trust://",
      },
    }, iosSafari)).toEqual({
      walletName: "Trust Wallet",
      url: "trust://wc?uri=wc%3Aabc123%402",
    });
    expect(getMobileWalletHandoff({
      ...provider,
      walletConnectPeer: {
        ...provider.walletConnectPeer,
        name: "Another Wallet",
        nativeRedirect: undefined,
        universalRedirect: "https://wallet.example/connect",
      },
    }, iosSafari)).toEqual({
      walletName: "Another Wallet",
      url: "https://wallet.example/connect/wc?uri=wc%3Aabc123%402",
    });
    expect(getMobileWalletHandoff(provider, "Mozilla/5.0 Chrome/140 Safari/537.36")).toBeNull();
    expect(getMobileWalletHandoff({
      ...provider,
      walletConnectPeer: {
        ...provider.walletConnectPeer,
        nativeRedirect: undefined,
        universalRedirect: undefined,
      },
    }, iosSafari)).toBeNull();
    expect(getMobileWalletHandoff({
      ...provider,
      walletConnectPeer: { ...provider.walletConnectPeer, sessionTopic: undefined },
    }, iosSafari)).toBeNull();
    expect(getMobileWalletHandoff({ ...provider, connectorId: "legacy-injected" }, iosSafari)).toBeNull();
  });
});
