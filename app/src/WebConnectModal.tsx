import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { trackAppEvent } from "./analytics";
import { linkCurrentWalletAndIdentity, loadAppSession, unlinkCurrentWalletAndIdentity } from "./appSession";
import { hapticSuccess } from "./haptics";
import { clearWalletConnectionError, connectBaseAccount, connectLegacyInjectedWallet, currentWalletSession, disconnectWallet, lastWalletConnectorId, useWalletController } from "./walletController";
import { appendWalletConnectDiagnostic, clearWalletConnectDiagnostics, readWalletConnectDiagnostics, subscribeWalletConnectDiagnostics } from "./walletConnectDiagnostics";

const TrustConnectBridge = lazy(() => import("./TrustConnectBridge"));
const FARCASTER_WARPLETS_MINI_APP_URL =
  import.meta.env.VITE_FARCASTER_WARPLETS_MINI_APP_URL?.trim()
  || "https://farcaster.xyz/miniapps/xzCEVqZVx3Sq/10x-warplets";

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
  const [walletDiagnostics, setWalletDiagnostics] = useState(() => readWalletConnectDiagnostics());
  const connectionError = identityError || localError || wallet.error;

  useEffect(() => subscribeWalletConnectDiagnostics(() => {
    setWalletDiagnostics(readWalletConnectDiagnostics());
  }), []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const record = (event: string) => appendWalletConnectDiagnostic(`browser.${event}`, {
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      path: window.location.pathname,
    });
    const onFocus = () => record("focus");
    const onBlur = () => record("blur");
    const onVisibility = () => record("visibilitychange");
    const onPageShow = (event: PageTransitionEvent) => appendWalletConnectDiagnostic("browser.pageshow", { persisted: event.persisted });
    const onPageHide = (event: PageTransitionEvent) => appendWalletConnectDiagnostic("browser.pagehide", { persisted: event.persisted });
    record("diagnostics_mounted");
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      record("diagnostics_unmounted");
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
    if (wallet.connecting !== "base-account") return;
    let popupHadFocus = false;
    let resetTimer: number | null = null;
    const markPopupFocused = () => { popupHadFocus = true; };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") markPopupFocused();
    };
    const handleFocusReturn = () => {
      if (!popupHadFocus) return;
      resetTimer = window.setTimeout(() => {
        if (!currentWalletSession()) {
          clearWalletConnectionError();
          setLocalError(null);
        }
      }, 300);
    };
    window.addEventListener("blur", markPopupFocused);
    window.addEventListener("focus", handleFocusReturn);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", markPopupFocused);
      window.removeEventListener("focus", handleFocusReturn);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (resetTimer != null) window.clearTimeout(resetTimer);
    };
  }, [wallet.connecting]);

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
  const trustConnectEnabled = import.meta.env.VITE_TRUSTCONNECT_ENABLED === "true";
  const restoreTrustConnect = !open && lastWalletConnectorId()?.startsWith("trustconnect-") === true;
  const persistentTrustConnect = trustConnectEnabled ? (
    <div hidden aria-hidden="true">
      <Suspense fallback={null}>
        <TrustConnectBridge
          openRequested={open && showOtherWallets}
          restoreOnly={restoreTrustConnect}
          onConnected={open ? finish : () => undefined}
          onDismiss={() => {
            clearWalletConnectionError();
            setShowOtherWallets(false);
            setLocalError(null);
          }}
          onError={open ? handleWalletError : () => undefined}
        />
      </Suspense>
    </div>
  ) : null;

  if (!open) return <>{persistentTrustConnect}</>;

  const connectedConnector = wallet.session?.connectorId ?? null;
  const walletConnected = Boolean(connectedConnector);
  const baseWalletConnected = connectedConnector === "base-account";
  const browserWalletConnected = connectedConnector === "legacy-injected";
  const trustWalletConnected = connectedConnector?.startsWith("trustconnect-") === true;
  const handleDisconnectWallet = async () => {
    setLocalError(null);
    setDisconnectingWallet(true);
    appendWalletConnectDiagnostic("ui.disconnect_clicked", {
      connectorId: connectedConnector,
      trustWalletConnected,
    });
    try {
      await disconnectWallet();
      appendWalletConnectDiagnostic("ui.wallet_disconnect_complete", { connectorId: connectedConnector });
    } catch (error) {
      appendWalletConnectDiagnostic("ui.wallet_disconnect_failed", {
        connectorId: connectedConnector,
        message: error instanceof Error ? error.message : String(error),
      });
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
    <>
      {persistentTrustConnect}
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
                        appendWalletConnectDiagnostic("ui.other_wallets_clicked", {
                          visibility: document.visibilityState,
                          focused: document.hasFocus(),
                        });
                        setLocalError(null);
                        clearWalletConnectionError();
                        onClearIdentityError?.();
                        setShowOtherWallets(true);
                      }}>
                        {disconnectingWallet && trustWalletConnected ? "Disconnecting…" : trustWalletConnected ? "Disconnect" : showOtherWallets ? "Connecting…" : "Connect"}
                      </button>
                    </div>
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
            {import.meta.env.DEV ? (
              <details className="wallet-connect-diagnostics">
                <summary>WalletConnect diagnostics ({walletDiagnostics.length})</summary>
                <div className="wallet-connect-diagnostics__actions">
                  <button type="button" onClick={() => clearWalletConnectDiagnostics()}>Clear</button>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(walletDiagnostics, null, 2))}>Copy JSON</button>
                </div>
                <pre>{walletDiagnostics.map((entry) => `${entry.at.slice(11, 23)} ${entry.event}${entry.details ? ` ${JSON.stringify(entry.details)}` : ""}`).join("\n")}</pre>
              </details>
            ) : null}
          </div>
        </OverlayScrollbarsComponent>
      </section>
      {wallet.connecting ? (
        <div className="web-connect-progress-toast" role="status" aria-live="polite">
          <span>Connecting {walletConnectorLabel(wallet.connecting)}…</span>
          <button
            type="button"
            className="trade-toast__close"
            aria-label="Close connection message"
            title="Close"
            onClick={() => {
              setShowOtherWallets(false);
              clearWalletConnectionError();
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12" /><path d="M18 6L6 18" />
            </svg>
          </button>
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
    </>
  );
}
