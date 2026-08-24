import type { EthereumProvider } from "./walletTrade";

interface BaseAccountCommunicator {
  disconnect?: () => void;
  popup?: { closed?: boolean; close?: () => void } | null;
}

interface BaseAccountProviderInternals extends EthereumProvider {
  communicator?: BaseAccountCommunicator;
}

/**
 * Base Account's popup normally closes itself shortly after an RPC response.
 * Base's iOS in-app browser can retain that popup as a full-screen white view,
 * so close the completed transport explicitly without disconnecting the
 * authenticated Base account held by the provider.
 */
export function dismissBaseAccountPopup(provider: EthereumProvider): boolean {
  const communicator = (provider as BaseAccountProviderInternals).communicator;
  if (!communicator) return false;

  const popup = communicator.popup;
  try {
    communicator.disconnect?.();
  } catch {
    try {
      if (popup && popup.closed !== true) popup.close?.();
    } catch {
      // The host may already have closed or invalidated the popup handle.
    }
  }

  try { window.focus(); } catch { /* unsupported by some embedded browsers */ }
  return true;
}
