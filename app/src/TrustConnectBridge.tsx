import { useEffect, useMemo, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createEIP155 } from "@trustwallet/connect-eip155-react";
import { TrustConnectProvider, useConnection, useTrustModal } from "@trustwallet/connect-react";
import { createWalletConnect } from "@trustwallet/connect-walletconnect";
import { base, baseSepolia } from "viem/chains";
import { activateTrustConnectWallet, restoreTrustConnectWallet, type WalletConnectorId } from "./walletController";
import type { EthereumProvider } from "./walletTrade";

const queryClient = new QueryClient();

function TrustConnectSession({ onConnected, onError, restoreOnly }: { onConnected: () => void; onError: (message: string) => void; restoreOnly: boolean }) {
  const { open } = useTrustModal();
  const connection = useConnection({ namespaceId: "eip155" });
  const activated = useRef("");

  useEffect(() => {
    if (!connection.isConnected || !connection.address || !connection.wallet) return;
    const wallet = connection.wallet;
    const address = connection.address;
    const chainReference = connection.chain?.reference ?? "8453";
    const key = `${wallet.id}:${address}:${chainReference}`;
    if (activated.current === key) return;
    activated.current = key;
    void wallet.getProvider().then((caipProvider) => {
      const rawInjectedProvider = (wallet as unknown as { eip1193Provider?: EthereumProvider }).eip1193Provider;
      const subscriptions = new Map<(...args: unknown[]) => void, () => void>();
      const provider: EthereumProvider & {
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
        removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
      } = rawInjectedProvider ? rawInjectedProvider : {
        request: ({ method, params }) => caipProvider.request({
          chainId: `eip155:${chainReference}`,
          request: { method, params } as never,
        } as never),
        on: (event, listener) => {
          if (event === "accountsChanged") {
            subscriptions.set(listener, wallet.__internal.handleOnAddress((nextAddress) => listener(nextAddress ? [nextAddress] : [])));
          } else if (event === "chainChanged") {
            subscriptions.set(listener, wallet.__internal.handleOnChain((nextChain) => listener(nextChain ? `0x${Number(nextChain.reference).toString(16)}` : null)));
          }
        },
        removeListener: (_event, listener) => {
          subscriptions.get(listener)?.();
          subscriptions.delete(listener);
        },
      };
      const walletLabel = `${wallet.id} ${wallet.name}`.toLowerCase();
      const walletType = (wallet as unknown as { type?: string }).type;
      const connectorId: Extract<WalletConnectorId, "trustconnect-injected" | "trustconnect-walletconnect"> =
        walletType === "caip" || walletLabel.includes("walletconnect") ? "trustconnect-walletconnect" : "trustconnect-injected";
      return restoreOnly
        ? restoreTrustConnectWallet(connectorId, provider, address)
        : activateTrustConnectWallet(connectorId, provider, address);
    }).then(onConnected).catch((error: unknown) => {
      activated.current = "";
      onError(error instanceof Error ? error.message : "TrustConnect could not connect this wallet");
    });
  }, [connection.address, connection.chain?.reference, connection.isConnected, connection.wallet, onConnected, onError, restoreOnly]);

  return (
    <button className="web-connect-choice" type="button" onClick={() => open({ type: "namespace", namespaceId: "eip155" })}>
      Choose an installed or mobile wallet
    </button>
  );
}

export default function TrustConnectBridge({ onConnected, onError, restoreOnly = false }: { onConnected: () => void; onError: (message: string) => void; restoreOnly?: boolean }) {
  const config = useMemo(() => {
    const chains = import.meta.env.DEV ? [base, baseSepolia] : [base];
    const namespaces = [createEIP155({ chains })];
    const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
    const services = projectId ? [createWalletConnect({
      projectId,
      metadata: {
        name: "10X Warplets",
        description: "Search, collect and trade 10X Warplets",
        url: window.location.origin,
        icons: [`${window.location.origin}/icons/search-1024.png`],
      },
    })] : [];
    return { namespaces, services };
  }, []);

  return (
    <TrustConnectProvider config={config} theme="dark">
      <QueryClientProvider client={queryClient}>
        <TrustConnectSession onConnected={onConnected} onError={onError} restoreOnly={restoreOnly} />
      </QueryClientProvider>
    </TrustConnectProvider>
  );
}
