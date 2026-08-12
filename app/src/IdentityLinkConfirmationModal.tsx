import { useCallback, useEffect, useRef, useState } from "react";
import {
  subscribeIdentityLinkConfirmation,
  type IdentityLinkConfirmationRequest,
} from "./identityLinkConfirmation";

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function IdentityLinkConfirmationModal() {
  const [request, setRequest] = useState<IdentityLinkConfirmationRequest | null>(null);
  const requestRef = useRef<IdentityLinkConfirmationRequest | null>(null);

  const finish = useCallback((confirmed: boolean) => {
    const pending = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    pending?.resolve(confirmed);
  }, []);

  useEffect(() => subscribeIdentityLinkConfirmation((nextRequest) => {
    requestRef.current?.resolve(false);
    requestRef.current = nextRequest;
    setRequest(nextRequest);
  }), []);

  useEffect(() => () => {
    requestRef.current?.resolve(false);
    requestRef.current = null;
  }, []);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish, request]);

  if (!request) return null;

  return (
    <div
      className="identity-link-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && finish(false)}
    >
      <section className="identity-link-modal" role="dialog" aria-modal="true" aria-labelledby="identity-link-title">
        <header className="identity-link-heading">
          <h2 id="identity-link-title"><span>Link</span> Wallet to Identity</h2>
          <button type="button" className="identity-link-close" onClick={() => finish(false)} aria-label="Don't link" title="Close">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12" /><path d="M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="identity-link-content">
          <p>
            Wallet <strong>{shortAddress(request.walletAddress)}</strong> is not currently associated with your Farcaster profile.
            Only link it if you personally control both accounts.
          </p>

          <div className="identity-link-explanation identity-link-explanation--enabled">
            <h3>Linking will:</h3>
            <ul>
              <li><span className="identity-link-list-icon identity-link-list-icon--tick" aria-hidden="true">✓</span><span>Save a verified association inside 10X between this wallet and your Farcaster identity.</span></li>
              <li><span className="identity-link-list-icon identity-link-list-icon--tick" aria-hidden="true">✓</span><span>Support linked services such as Base notifications and account continuity.</span></li>
              <li><span className="identity-link-list-icon identity-link-list-icon--tick" aria-hidden="true">✓</span><span>Keep this wallet connected for signing and transactions.</span></li>
            </ul>
          </div>

          <div className="identity-link-explanation identity-link-explanation--excluded">
            <h3>Linking will not:</h3>
            <ul>
              <li><span className="identity-link-list-icon identity-link-list-icon--cross" aria-hidden="true">×</span><span>Add the wallet to Farcaster or make it your primary or verified Farcaster wallet.</span></li>
              <li><span className="identity-link-list-icon identity-link-list-icon--cross" aria-hidden="true">×</span><span>Change anything in Farcaster or Base.</span></li>
              <li><span className="identity-link-list-icon identity-link-list-icon--cross" aria-hidden="true">×</span><span>Grant spending permissions, approve transactions or let 10X control your wallet.</span></li>
              <li><span className="identity-link-list-icon identity-link-list-icon--cross" aria-hidden="true">×</span><span>Move Farcaster-based favourites away from your Farcaster primary or verified wallet.</span></li>
            </ul>
          </div>

          <p className="identity-link-decline-note">
            Choosing “Don’t Link” keeps the wallet connected for signing, but does not save this association between Wallet and Identity.
          </p>

          <div className="identity-link-actions">
            <button type="button" className="identity-link-primary" onClick={() => finish(true)}>Link Wallet to Identity</button>
            <button type="button" className="identity-link-secondary" onClick={() => finish(false)}>Don’t Link</button>
          </div>
        </div>
      </section>
    </div>
  );
}
