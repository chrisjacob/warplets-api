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
export interface Identity {
  farcasterFid: number | null;
  solanaWallet: string | null;
  baseWallets: string[];
  wallets: { chain: string; address: string; role: string }[];
}
export async function api(
  path: string,
  body?: unknown,
  method = body == null ? "GET" : "POST",
) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body != null
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Request failed");
  return data;
}
type SolanaAccount = { address: string; chains: readonly string[] };
type SolanaWallet = { name: string; features: Record<string, unknown> };
export function IdentityPanel({
  onIdentity,
}: {
  onIdentity: (identity: Identity | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [identity, setIdentity] = useState<Identity | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [wallets, setWallets] = useState<readonly SolanaWallet[]>([]),
    [selected, setSelected] = useState("");
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
        role: "reward",
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
      <button
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        Connect
      </button>
      <span className="identity-summary">
        {identity?.farcasterFid
          ? `FID ${identity.farcasterFid}`
          : "Farcaster not connected"}{" "}
        · {identity?.solanaWallet ? "Solana verified" : "Reward wallet needed"}
      </span>
      <WebConnectModal
        open={open}
        onClose={() => {
          setOpen(false);
          void refresh();
        }}
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
          <section className="web-connect-section">
            <h3>Solana reward wallet</h3>
            <p>
              A signed message verifies your destination. No transaction or
              funds are requested.
            </p>
            <p>{identity?.solanaWallet ?? "No verified reward wallet"}</p>
            <label>
              Solana wallet{" "}
              <select
                aria-label="Solana wallet"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose wallet</option>
                {wallets.map((w) => (
                  <option key={w.name}>{w.name}</option>
                ))}
              </select>
            </label>
            <button
              disabled={!identity?.farcasterFid || busy}
              onClick={() => void solana()}
            >
              {busy ? "Verifying…" : "Verify reward wallet"}
            </button>
            <p>
              Base boosts: {identity?.baseWallets.length ?? 0} verified linked
              wallets. Changes apply to future eligibility snapshots.
            </p>
          </section>
        }
      />
    </>
  );
}
