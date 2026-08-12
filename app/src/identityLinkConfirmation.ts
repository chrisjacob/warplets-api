export interface IdentityLinkConfirmationRequest {
  walletAddress: string;
  resolve: (confirmed: boolean) => void;
}

const EVENT_NAME = "warplets:confirm-identity-link";

export function requestIdentityLinkConfirmation(walletAddress: string): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<IdentityLinkConfirmationRequest>(EVENT_NAME, {
      detail: { walletAddress, resolve },
    }));
  });
}

export function subscribeIdentityLinkConfirmation(
  listener: (request: IdentityLinkConfirmationRequest) => void,
): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<IdentityLinkConfirmationRequest>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
