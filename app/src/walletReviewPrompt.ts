import type { EthereumProvider } from "./walletTrade";

type NamedInjectedProvider = EthereumProvider & {
  isMetaMask?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
};

export function getExternalWalletReviewName(provider: EthereumProvider): string | null {
  if (provider.connectorId === "trustconnect-walletconnect") {
    return provider.walletConnectPeer?.name?.trim() || "your connected wallet";
  }
  if (provider.connectorId === "trustconnect-injected") return "Trust Wallet";
  if (provider.connectorId !== "legacy-injected") return null;

  const injected = provider as NamedInjectedProvider;
  if (injected.isMetaMask) return "MetaMask";
  if (injected.isTrust || injected.isTrustWallet) return "Trust Wallet";
  return "your browser wallet";
}
