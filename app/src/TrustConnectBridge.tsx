import { useEffect, useMemo, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createEIP155 } from "@trustwallet/connect-eip155-react";
import { TrustConnectProvider, useConnect, useConnection, useTrustModal } from "@trustwallet/connect-react";
import { createWalletConnect } from "@trustwallet/connect-walletconnect";
import { base, baseSepolia } from "viem/chains";
import { activateTrustConnectWallet, restoreTrustConnectWallet, type WalletConnectorId } from "./walletController";
import type { EthereumProvider } from "./walletTrade";
import { appendWalletConnectDiagnostic, TRUSTCONNECT_DISCONNECT_COMPLETE_EVENT, TRUSTCONNECT_DISCONNECT_REQUEST_EVENT } from "./walletConnectDiagnostics";
import { getRuntimeAppIconPath } from "./brandAssets";
import {
  isWalletConnectWallet,
  normalizeTrustConnectAccounts,
  normalizeTrustConnectChainReference,
  toEip1193ChainId,
} from "./trustConnectCompatibility";

const queryClient = new QueryClient();

function TrustConnectSession({ onConnected, onDismiss, onError, openRequested, restoreOnly }: { onConnected: () => void; onDismiss: () => void; onError: (message: string) => void; openRequested: boolean; restoreOnly: boolean }) {
  const { close, isOpen, open } = useTrustModal();
  const { disconnect } = useConnect();
  const connection = useConnection({ namespaceId: "eip155" });
  const activated = useRef("");
  const modalOpened = useRef(false);
  const modalWasOpen = useRef(false);
  const disconnectRequested = useRef(false);

  useEffect(() => {
    const handleDisconnectRequest = () => {
      disconnectRequested.current = true;
      appendWalletConnectDiagnostic("trustconnect.disconnect_requested", { isConnected: connection.isConnected });
      if (!connection.isConnected) {
        disconnectRequested.current = false;
        window.dispatchEvent(new CustomEvent(TRUSTCONNECT_DISCONNECT_COMPLETE_EVENT));
        return;
      }
      disconnect({ namespaceId: "eip155" });
    };
    window.addEventListener(TRUSTCONNECT_DISCONNECT_REQUEST_EVENT, handleDisconnectRequest);
    return () => window.removeEventListener(TRUSTCONNECT_DISCONNECT_REQUEST_EVENT, handleDisconnectRequest);
  }, [connection.isConnected, disconnect]);

  useEffect(() => {
    if (!disconnectRequested.current || connection.isConnected) return;
    disconnectRequested.current = false;
    activated.current = "";
    appendWalletConnectDiagnostic("trustconnect.disconnect_complete");
    window.dispatchEvent(new CustomEvent(TRUSTCONNECT_DISCONNECT_COMPLETE_EVENT));
  }, [connection.isConnected]);

  useEffect(() => {
    if (restoreOnly || !openRequested || modalOpened.current) return;
    modalOpened.current = true;
    appendWalletConnectDiagnostic("trustconnect.modal_open_requested");
    open({ type: "namespace", namespaceId: "eip155" });
  }, [open, openRequested, restoreOnly]);

  useEffect(() => {
    appendWalletConnectDiagnostic("trustconnect.bridge_mounted");
    return () => appendWalletConnectDiagnostic("trustconnect.bridge_unmounted");
  }, []);

  useEffect(() => {
    appendWalletConnectDiagnostic("trustconnect.bridge_mode", { openRequested, restoreOnly });
  }, [openRequested, restoreOnly]);

  useEffect(() => {
    if (openRequested) return;
    modalOpened.current = false;
    modalWasOpen.current = false;
    if (isOpen) close();
  }, [close, isOpen, openRequested]);

  useEffect(() => {
    appendWalletConnectDiagnostic("trustconnect.connection_state", {
      isConnected: connection.isConnected,
      address: connection.address ?? null,
      chain: connection.chain?.reference ?? null,
      walletId: connection.wallet?.id ?? null,
      walletName: connection.wallet?.name ?? null,
      walletType: (connection.wallet as unknown as { type?: string } | undefined)?.type ?? null,
      modalOpen: isOpen,
      restoreOnly,
    });
  }, [connection.address, connection.chain?.reference, connection.isConnected, connection.wallet, isOpen, restoreOnly]);

  useEffect(() => {
    if (isOpen) {
      modalWasOpen.current = true;
      return;
    }
    if (restoreOnly || !modalWasOpen.current || connection.isConnected) return;
    modalWasOpen.current = false;
    appendWalletConnectDiagnostic("trustconnect.modal_dismissed");
    onDismiss();
  }, [connection.isConnected, isOpen, onDismiss, restoreOnly]);

  useEffect(() => {
    if (!restoreOnly && !openRequested) return;
    if (!connection.isConnected || !connection.address || !connection.wallet) return;
    const wallet = connection.wallet;
    const address = connection.address;
    const chainReference = normalizeTrustConnectChainReference(connection.chain);
    const key = `${wallet.id}:${address}:${chainReference}`;
    if (activated.current === key) return;
    activated.current = key;
    appendWalletConnectDiagnostic("trustconnect.provider_requested", { address, chain: chainReference, walletId: wallet.id });
    void wallet.getProvider().then((caipProvider) => {
      appendWalletConnectDiagnostic("trustconnect.provider_ready", { address, chain: chainReference, walletId: wallet.id });
      const rawInjectedProvider = (wallet as unknown as { eip1193Provider?: EthereumProvider }).eip1193Provider;
      const subscriptions = new Map<(...args: unknown[]) => void, () => void>();
      let activeChainReference = chainReference;
      const provider: EthereumProvider & {
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
        removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
      } = rawInjectedProvider ? rawInjectedProvider : {
        request: async ({ method, params }) => {
          appendWalletConnectDiagnostic("provider.request_started", { method, chain: chainReference });
          try {
            const result = await caipProvider.request({
              chainId: `eip155:${activeChainReference}`,
              request: { method, params } as never,
            } as never);
            appendWalletConnectDiagnostic("provider.request_complete", { method, chain: chainReference });
            return result;
          } catch (error) {
            appendWalletConnectDiagnostic("provider.request_failed", {
              method,
              chain: chainReference,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        on: (event, listener) => {
          if (event === "accountsChanged") {
            subscriptions.set(listener, wallet.__internal.handleOnAddress((nextAddress) => listener(normalizeTrustConnectAccounts(nextAddress))));
          } else if (event === "chainChanged") {
            subscriptions.set(listener, wallet.__internal.handleOnChain((nextChain) => {
              activeChainReference = normalizeTrustConnectChainReference(nextChain, activeChainReference);
              listener(toEip1193ChainId(activeChainReference));
            }));
          }
        },
        removeListener: (_event, listener) => {
          subscriptions.get(listener)?.();
          subscriptions.delete(listener);
        },
      };
      const walletConnectSession = (wallet as unknown as {
        currentSession?: {
          topic?: string;
          peer?: {
            metadata?: {
              name?: string;
              redirect?: { native?: string; universal?: string };
            };
          };
        };
      }).currentSession;
      const peerMetadata = walletConnectSession?.peer?.metadata;
      if (walletConnectSession) {
        provider.walletConnectPeer = {
          name: peerMetadata?.name,
          sessionTopic: walletConnectSession.topic,
          nativeRedirect: peerMetadata?.redirect?.native,
          universalRedirect: peerMetadata?.redirect?.universal,
        };
        appendWalletConnectDiagnostic("trustconnect.peer_metadata", {
          name: peerMetadata?.name ?? null,
          hasSessionTopic: Boolean(walletConnectSession.topic),
          hasNativeRedirect: Boolean(peerMetadata?.redirect?.native),
          hasUniversalRedirect: Boolean(peerMetadata?.redirect?.universal),
        });
      }
      const connectorId: Extract<WalletConnectorId, "trustconnect-injected" | "trustconnect-walletconnect"> =
        isWalletConnectWallet(wallet as unknown as Parameters<typeof isWalletConnectWallet>[0]) ? "trustconnect-walletconnect" : "trustconnect-injected";
      return restoreOnly
        ? restoreTrustConnectWallet(connectorId, provider, address)
        : activateTrustConnectWallet(connectorId, provider, address);
    }).then((session) => {
      if (!session) {
        activated.current = "";
        appendWalletConnectDiagnostic("trustconnect.activation_skipped", { address, chain: chainReference, restoreOnly });
        return;
      }
      appendWalletConnectDiagnostic("trustconnect.activation_complete", { address, chain: chainReference });
      onConnected();
    }).catch((error: unknown) => {
      activated.current = "";
      appendWalletConnectDiagnostic("trustconnect.activation_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      onError(error instanceof Error ? error.message : "TrustConnect could not connect this wallet");
    });
  }, [connection.address, connection.chain?.reference, connection.isConnected, connection.wallet, onConnected, onError, openRequested, restoreOnly]);

  return null;
}

export default function TrustConnectBridge({ onConnected, onDismiss = () => undefined, onError, openRequested = true, restoreOnly = false }: { onConnected: () => void; onDismiss?: () => void; onError: (message: string) => void; openRequested?: boolean; restoreOnly?: boolean }) {
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
        icons: [`${window.location.origin}${getRuntimeAppIconPath()}`],
      },
    })] : [];
    appendWalletConnectDiagnostic("trustconnect.config_created", {
      hasProjectId: Boolean(projectId),
      chains: chains.map((chain) => chain.id),
      origin: window.location.origin,
    });
    return { namespaces, services };
  }, []);

  return (
    <TrustConnectProvider config={config} theme="dark">
      <QueryClientProvider client={queryClient}>
        <TrustConnectSession onConnected={onConnected} onDismiss={onDismiss} onError={onError} openRequested={openRequested} restoreOnly={restoreOnly} />
      </QueryClientProvider>
    </TrustConnectProvider>
  );
}
