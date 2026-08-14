import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { trackAppEvent } from "./analytics";
import { linkCurrentWalletAndIdentity, loadAppSession, unlinkCurrentWalletAndIdentity } from "./appSession";
import { hapticSuccess } from "./haptics";
import { clearWalletConnectionError, connectBaseAccount, connectLegacyInjectedWallet, currentWalletSession, disconnectWallet, lastWalletConnectorId, useWalletController } from "./walletController";

const TrustConnectBridge = lazy(() => import("./TrustConnectBridge"));
const FARCASTER_WARPLETS_MINI_APP_URL =
  import.meta.env.VITE_FARCASTER_WARPLETS_MINI_APP_URL?.trim()
  || "https://farcaster.xyz/miniapps/uR3Rzs-k6AnV/10x/warplets";

function walletConnectorLabel(connector: string): string {
  if (connector === "base-account") return "Base wallet";
  if (connector === "legacy-injected") return "browser wallet";
  if (connector.startsWith("trustconnect-")) return "wallet";
  if (connector === "farcaster") return "Farcaster wallet";
  return "wallet";
}

function BaseAccountIcon() {
  return <img aria-hidden="true" alt="" src="/base.webp" className="web-connect-provider-icon" />;
}

function FarcasterIcon() {
  return <img aria-hidden="true" alt="" src="/farcaster.webp" className="web-connect-provider-icon" />;
}

function TrustConnectIcon() {
  return <img aria-hidden="true" alt="" src="/trust.webp" className="web-connect-provider-icon" />;
}

function BrowserWalletIcon() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" className="web-connect-provider-icon web-connect-provider-icon-browser">
    <rect width="32" height="32" rx="7" fill="#001500" />
    <rect x="5" y="8" width="22" height="17" rx="4" fill="#001b00" stroke="#00FF00" strokeWidth="1.75" />
    <path d="M6 12h20" stroke="#00FF00" strokeWidth="1.75" />
    <path d="M19 15h9v7h-9a3.5 3.5 0 1 1 0-7Z" fill="#00FF00" />
    <circle cx="21" cy="18.5" r="1.2" fill="#004d00" />
  </svg>;
}

export function WebConnectModal({ open, onClose, farcasterControl, identityConnected = false, identityError = null, onClearIdentityError, onWalletConnected }: {
  open: boolean;
  onClose: () => void;
  farcasterControl: ReactNode;
  identityConnected?: boolean;
  identityError?: string | null;
  onClearIdentityError?: () => void;
  onWalletConnected?: (address: string) => void;
}) {
  const wallet = useWalletController();
  const [showOtherWallets, setShowOtherWallets] = useState(false);
  const [disconnectingWallet, setDisconnectingWallet] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [identitiesLinked, setIdentitiesLinked] = useState(false);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const connectionError = identityError || localError || wallet.error;

  useEffect(() => {
    if (!open) {
      setShowOtherWallets(false);
      setLocalError(null);
      setSuccessMessage(null);
    }
  }, [open]);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    if (!open || !identityConnected || !wallet.session?.address) {
      setIdentitiesLinked(false);
      return;
    }
    let active = true;
    void loadAppSession().then((session) => {
      if (active) setIdentitiesLinked(session.identitiesLinked);
    }).catch(() => {
      if (active) setIdentitiesLinked(false);
    });
    return () => { active = false; };
  }, [identityConnected, open, wallet.session?.address]);

  if (!open) {
    const lastConnector = lastWalletConnectorId();
    const restoreTrustConnect = import.meta.env.VITE_TRUSTCONNECT_ENABLED === "true" && lastConnector?.startsWith("trustconnect-");
    return restoreTrustConnect ? (
      <div hidden aria-hidden="true">
        <Suspense fallback={null}>
          <TrustConnectBridge restoreOnly onConnected={() => undefined} onError={() => undefined} />
        </Suspense>
      </div>
    ) : null;
  }

  const finish = () => {
    setLocalError(null);
    const address = currentWalletSession()?.address;
    if (address) onWalletConnected?.(address);
    onClose();
  };
  const run = async (connector: "base" | "injected") => {
    setLocalError(null);
    clearWalletConnectionError();
    onClearIdentityError?.();
    try {
      const session = connector === "base"
        ? await connectBaseAccount()
        : await connectLegacyInjectedWallet();
      setLocalError(null);
      onWalletConnected?.(session.address);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet connection failed";
      setShowOtherWallets(false);
      setLocalError(/reject|denied|cancel|closed/i.test(message)
        ? "Wallet connection was cancelled."
        : message);
    }
  };
  const handleWalletError = (message: string) => {
    clearWalletConnectionError();
    setShowOtherWallets(false);
    setLocalError(/reject|denied|cancel|closed/i.test(message)
      ? "Wallet connection was cancelled."
      : message);
  };
  const connectedConnector = wallet.session?.connectorId ?? null;
  const walletConnected = Boolean(connectedConnector);
  const baseWalletConnected = connectedConnector === "base-account";
  const browserWalletConnected = connectedConnector === "legacy-injected";
  const trustWalletConnected = connectedConnector?.startsWith("trustconnect-") === true;
  const handleDisconnectWallet = async () => {
    setLocalError(null);
    setDisconnectingWallet(true);
    try {
      await disconnectWallet();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Wallet could not be disconnected");
    } finally {
      setDisconnectingWallet(false);
    }
  };
  const handleBaseWalletAction = async () => {
    if (baseWalletConnected) await handleDisconnectWallet();
    else await run("base");
  };
  const handleBrowserWalletAction = async () => {
    if (browserWalletConnected) await handleDisconnectWallet();
    else await run("injected");
  };
  const handleIdentityRelationship = async () => {
    const address = wallet.session?.address;
    if (!address || !identityConnected || relationshipBusy) return;
    setLocalError(null);
    setRelationshipBusy(true);
    try {
      if (identitiesLinked) {
        await unlinkCurrentWalletAndIdentity();
        setIdentitiesLinked(false);
        void hapticSuccess();
        setSuccessMessage("Wallet and social successfully unlinked.");
      } else if (await linkCurrentWalletAndIdentity(address)) {
        setIdentitiesLinked(true);
        void hapticSuccess();
        setSuccessMessage("Wallet and social successfully linked.");
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Wallet and social relationship could not be updated");
    } finally {
      setRelationshipBusy(false);
    }
  };

  return (
    <div className="web-connect-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="web-connect-modal" role="dialog" aria-modal="true" aria-labelledby="web-connect-title">
        <div className="web-connect-heading">
          <h2 id="web-connect-title"><span>Connect</span> Wallet &amp; Social</h2>
          <button type="button" className="web-connect-close" onClick={onClose} aria-label="Close connect modal" title="Close">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12" /><path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
        <OverlayScrollbarsComponent
          className="web-connect-scroll"
          options={{ scrollbars: { theme: "os-theme-10x", autoHide: "scroll", clickScroll: true } }}
          defer
        >
          <div className="web-connect-content">
            <section className="web-connect-section" aria-labelledby="web-connect-wallet-heading">
              <div className="web-connect-section-heading">
                <h3 id="web-connect-wallet-heading">Wallet</h3>
                <p>Connect to trade, verify ownership and save favourites.</p>
              </div>
              <div className="web-connect-options">
                {import.meta.env.VITE_BASE_ACCOUNT_ENABLED === "true" ? (
                  <div className="web-connect-provider-card">
                    <div className="web-connect-provider-copy">
                      <BaseAccountIcon />
                      <span><strong>Base wallet</strong></span>
                    </div>
                    <button className={`web-connect-cta${baseWalletConnected ? " web-connect-cta--disconnect" : ""}`} type="button" disabled={Boolean(wallet.connecting) || disconnectingWallet || (walletConnected && !baseWalletConnected)} onClick={() => void handleBaseWalletAction()}>
                      {disconnectingWallet && baseWalletConnected ? "Disconnecting…" : wallet.connecting === "base-account" ? "Connecting…" : baseWalletConnected ? "Disconnect" : "Connect"}
                    </button>
                  </div>
                ) : null}

                {import.meta.env.VITE_TRUSTCONNECT_ENABLED === "true" ? (
                  <div className="web-connect-option-group">
                    <div className="web-connect-provider-card">
                      <div className="web-connect-provider-copy">
                        <TrustConnectIcon />
                        <span><strong>Other wallets</strong></span>
                      </div>
                      <button className={`web-connect-cta${trustWalletConnected ? " web-connect-cta--disconnect" : ""}`} type="button" disabled={Boolean(wallet.connecting) || disconnectingWallet || (walletConnected && !trustWalletConnected)} onClick={() => {
                        if (trustWalletConnected) {
                          void handleDisconnectWallet();
                          return;
                        }
                        trackAppEvent("connector_selected", { connector: "trustconnect" });
                        setLocalError(null);
                        clearWalletConnectionError();
                        onClearIdentityError?.();
                        setShowOtherWallets(true);
                      }}>
                        {disconnectingWallet && trustWalletConnected ? "Disconnecting…" : trustWalletConnected ? "Disconnect" : "Connect"}
                      </button>
                    </div>
                    {showOtherWallets ? (
                      <Suspense fallback={<div className="web-connect-loading">Loading wallet choices…</div>}>
                        <TrustConnectBridge onConnected={finish} onError={handleWalletError} />
                      </Suspense>
                    ) : null}
                  </div>
                ) : null}

                <div className="web-connect-provider-card">
                  <div className="web-connect-provider-copy">
                    <BrowserWalletIcon />
                    <span><strong>Browser wallet</strong></span>
                  </div>
                  <button className={`web-connect-cta${browserWalletConnected ? " web-connect-cta--disconnect" : ""}`} type="button" disabled={Boolean(wallet.connecting) || disconnectingWallet || (walletConnected && !browserWalletConnected)} onClick={() => void handleBrowserWalletAction()}>
                    {disconnectingWallet && browserWalletConnected ? "Disconnecting…" : wallet.connecting === "legacy-injected" ? "Connecting…" : browserWalletConnected ? "Disconnect" : "Connect"}
                  </button>
                </div>
              </div>
            </section>

            <section className="web-connect-section" aria-labelledby="web-connect-identity-heading">
              <div className="web-connect-section-heading">
                <h3 id="web-connect-identity-heading">Social <span className="web-connect-optional-chip">Optional</span></h3>
                <p>Connect Farcaster for your profile, friends and social features.</p>
              </div>
              <div className="web-connect-options">
                <div className="web-connect-farcaster">
                  <div className="web-connect-provider-copy">
                    <FarcasterIcon />
                    <span><strong>Farcaster identity</strong></span>
                  </div>
                  {farcasterControl}
                </div>
                {wallet.session?.address && identityConnected ? (
                  <button
                    type="button"
                    className="web-connect-identity-link"
                    disabled={relationshipBusy}
                    onClick={() => void handleIdentityRelationship()}
                  >
                    {relationshipBusy
                      ? "Updating Wallet and Social…"
                      : identitiesLinked ? "Unlink Wallet and Social" : "Link Wallet and Social"}
                  </button>
                ) : null}
                {import.meta.env.VITE_X_AUTH_ENABLED === "true" ? (
                  <a
                    className="web-connect-choice"
                    href={`/api/auth/x/start?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}
                    onClick={() => trackAppEvent("connector_selected", { connector: "x-oauth" })}
                  >
                    <strong>Connect X identity</strong><span>OAuth 2.0 with PKCE; separate from wallet signing</span>
                  </a>
                ) : null}
              </div>
            </section>

            <div className="web-connect-farcaster-footer">
              <p>For the best experience, use the Farcaster Mini App.</p>
              <a className="web-connect-farcaster-cta" href={FARCASTER_WARPLETS_MINI_APP_URL} target="_blank" rel="noreferrer">
                Open in Farcaster
              </a>
              <a
                className="web-connect-farcaster-bonus-link"
                href="https://farcaster.xyz/~/code/1Y7636"
                target="_blank"
                rel="noreferrer"
              >
                Bonus: 20% off trading fees (click here)
              </a>
            </div>
          </div>
        </OverlayScrollbarsComponent>
      </section>
      {wallet.connecting ? (
        <div className="web-connect-progress-toast" role="status" aria-live="polite">
          Connecting {walletConnectorLabel(wallet.connecting)}…
        </div>
      ) : null}
      {connectionError && !wallet.connecting ? (
        <div className="web-connect-progress-toast web-connect-progress-toast--danger" role="alert">
          <span>{connectionError}</span>
          <button type="button" aria-label="Dismiss connection error" title="Dismiss" onClick={() => {
            setLocalError(null);
            setShowOtherWallets(false);
            clearWalletConnectionError();
            onClearIdentityError?.();
          }}>×</button>
        </div>
      ) : null}
      {successMessage && !connectionError && !wallet.connecting ? (
        <div className="web-connect-progress-toast" role="status" aria-live="polite">
          {successMessage}
        </div>
      ) : null}
    </div>
  );
}
