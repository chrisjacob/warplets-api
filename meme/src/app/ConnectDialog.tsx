import { lazy, Suspense, useEffect, useState } from "react";
import { WebConnectModal } from "@10x/connect/WebConnectModal";
import { configureConnectHost } from "@10x/connect/host";
import { logoutAppPrincipal } from "@10x/connect/appSession";
import { restoreWebWallet } from "@10x/connect/walletController";
import { getWallets } from "@wallet-standard/app";
import { encode58 } from "../shared/base58";
import "@10x/connect/styles";
const FarcasterSignInControl = lazy(
  () => import("@10x/connect/FarcasterSignInControl"),
);
configureConnectHost({ name: () => "10X.meme", icon: () => "/base.webp" });
import { api, type Identity } from "./client";
type SolanaAccount = { address: string; chains: readonly string[] };
type SolanaWallet = { name: string; features: Record<string, unknown> };
export default function ConnectDialog({
  onIdentity,
  onReady,
  open,
  onClose,
  identity: initialIdentity,
}: {
  onIdentity: (identity: Identity) => void;
  onReady: () => void;
  open: boolean;
  onClose: () => void;
  identity: Identity | null;
}) {
  const [role, setRole] = useState("reward");
  const [identity, setIdentity] = useState<Identity | null>(initialIdentity),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [wallets, setWallets] = useState<readonly SolanaWallet[]>([]),
    [selected, setSelected] = useState("");
  useEffect(() => setIdentity(initialIdentity), [initialIdentity]);
  const refresh = async () => {
    try {
      const next = (await api("/api/auth/session")) as Identity;
      setIdentity(next);
      onIdentity(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Local API unavailable");
    }
  };
  useEffect(() => {
    onReady();
    void refresh();
    void restoreWebWallet().catch(() => undefined);
    const registry = getWallets();
    const update = () =>
      setWallets(
        registry
          .get()
          .filter((w) => w.chains.some((c) => c.startsWith("solana:"))),
      );
    update();
    const offRegister = registry.on("register", update),
      offUnregister = registry.on("unregister", update);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);
  async function solana() {
    setBusy(true);
    setError(null);
    try {
      const wallet = wallets.find((w) => w.name === selected) ?? wallets[0];
      if (!wallet)
        throw Error("Install a Solana Wallet Standard compatible wallet.");
      const connect = wallet.features["standard:connect"] as
        | { connect: () => Promise<{ accounts: SolanaAccount[] }> }
        | undefined;
      const signer = wallet.features["solana:signMessage"] as
        | {
            signMessage: (input: {
              account: SolanaAccount;
              message: Uint8Array;
            }) => Promise<
              { signature: Uint8Array; signedMessage: Uint8Array }[]
            >;
          }
        | undefined;
      if (!connect || !signer)
        throw Error("This wallet does not support off-chain message signing.");
      const { accounts } = await connect.connect();
      const account = accounts.find((a) =>
        a.chains.some((c) => c.startsWith("solana:")),
      );
      if (!account) throw Error("No Solana account returned");
      const challenge = await api("/api/auth/solana/challenge", {
        address: account.address,
        role,
      });
      const result = await signer.signMessage({
        account,
        message: new TextEncoder().encode(challenge.message),
      });
      if (!result[0]) throw Error("No signature returned");
      await api("/api/auth/solana/verify", {
        nonce: challenge.nonce,
        signature: encode58(result[0].signature),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet verification failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <WebConnectModal
        open={open}
        onClose={() => {
          onClose();
        }}
        showPromotions={false}
        socialRequired
        identityConnected={!!identity?.farcasterFid}
        identityError={error}
        onClearIdentityError={() => setError(null)}
        onWalletConnected={() => void refresh()}
        farcasterControl={
          <Suspense fallback={<span>Loading…</span>}>
            <FarcasterSignInControl
              connected={!!identity?.farcasterFid}
              onAuthenticated={() => void refresh()}
              onError={setError}
              onDisconnect={async () => {
                await logoutAppPrincipal("farcaster");
                await refresh();
              }}
            />
          </Suspense>
        }
        extraWalletControls={
          <section className="web-connect-section launchpad-wallet-section">
            <h3>
              {role === "holding"
                ? "Solana holding wallet"
                : "Solana reward wallet"}
            </h3>
            <p>Sign a message. No funds move.</p>
            {identity?.solanaWallet && (
              <p className="fine">
                Verified · {identity.solanaWallet.slice(0, 6)}…
                {identity.solanaWallet.slice(-4)}
              </p>
            )}
            {wallets.length ? (
              <label>
                Wallet
                <select
                  aria-label="Solana wallet"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {wallets.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>No Solana wallet found.</p>
            )}
            <button
              disabled={!identity?.farcasterFid || busy || !wallets.length}
              onClick={() => void solana()}
            >
              {busy
                ? "Verifying…"
                : role === "reward"
                  ? "Verify reward wallet"
                  : "Verify holding wallet"}
            </button>
            <details>
              <summary>Wallet options</summary>
              <label>
                Use for
                <select
                  aria-label="Solana wallet purpose"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="reward">Reward destination</option>
                  <option value="holding">Additional holding wallet</option>
                </select>
              </label>
              {identity?.wallets
                .filter((w) => w.chain === "solana")
                .map((w) => (
                  <p className="fine" key={w.address}>
                    {w.role}: {w.address}
                  </p>
                ))}
              <p className="fine">Reward wallets count for holding too.</p>
            </details>
          </section>
        }
      />
    </>
  );
}
