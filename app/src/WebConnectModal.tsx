import { lazy, Suspense, useState, type ReactNode } from "react";
import { trackAppEvent } from "./analytics";
import { connectBaseAccount, connectLegacyInjectedWallet, lastWalletConnectorId, useWalletController } from "./walletController";

const TrustConnectBridge = lazy(() => import("./TrustConnectBridge"));

export function WebConnectModal({ open, onClose, farcasterControl }: {
  open: boolean;
  onClose: () => void;
  farcasterControl: ReactNode;
}) {
  const wallet = useWalletController();
  const [showOtherWallets, setShowOtherWallets] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
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
    onClose();
  };
  const run = async (connector: "base" | "injected") => {
    setLocalError(null);
    try {
      if (connector === "base") await connectBaseAccount();
      else await connectLegacyInjectedWallet();
      finish();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Wallet connection failed");
    }
  };

  return (
    <div className="web-connect-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="web-connect-modal" role="dialog" aria-modal="true" aria-labelledby="web-connect-title">
        <div className="web-connect-heading">
          <div>
            <h2 id="web-connect-title">Connect</h2>
            <p>Wallet signing and Farcaster identity are independent. Connect either or both.</p>
          </div>
          <button type="button" className="web-connect-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="web-connect-options">
          {import.meta.env.VITE_BASE_ACCOUNT_ENABLED === "true" ? (
            <button className="web-connect-choice" type="button" disabled={Boolean(wallet.connecting)} onClick={() => void run("base")}>
              <strong>Base Account</strong><span>Recommended for Base App and the web</span>
            </button>
          ) : null}

          {import.meta.env.VITE_TRUSTCONNECT_ENABLED === "true" ? (
            <div className="web-connect-option-group">
              <button className="web-connect-choice" type="button" onClick={() => {
                trackAppEvent("connector_selected", { connector: "trustconnect" });
                setShowOtherWallets(true);
              }}>
                <strong>Other wallets</strong><span>Installed wallets or WalletConnect mobile/QR</span>
              </button>
              {showOtherWallets ? (
                <Suspense fallback={<div className="web-connect-loading">Loading wallet choices…</div>}>
                  <TrustConnectBridge onConnected={finish} onError={setLocalError} />
                </Suspense>
              ) : null}
            </div>
          ) : null}

          <button className="web-connect-choice" type="button" disabled={Boolean(wallet.connecting)} onClick={() => void run("injected")}>
            <strong>Browser wallet</strong><span>Compatibility option for an injected wallet</span>
          </button>

          <div className="web-connect-farcaster">
            <span>Farcaster identity</span>
            {farcasterControl}
          </div>

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

        {(localError || wallet.error) ? <p className="web-connect-error" role="alert">{localError || wallet.error}</p> : null}
        {wallet.connecting ? <p className="web-connect-loading">Waiting for {wallet.connecting}…</p> : null}
      </section>
    </div>
  );
}
