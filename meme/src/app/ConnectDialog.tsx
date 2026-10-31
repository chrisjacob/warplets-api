import { lazy, Suspense, useEffect, useState, useRef } from "react";
import { WebConnectModal } from "@10x/connect/WebConnectModal";
import { configureConnectHost } from "@10x/connect/host";
import { logoutAppPrincipal } from "@10x/connect/appSession";
import { restoreWebWallet } from "@10x/connect/walletController";
import { getWallets } from "@wallet-standard/app";
import { encode58 } from "../shared/base58";
import "@10x/connect/styles";
import { connectionSuccessEffects, miniAppSuccess } from "./connectionEffects";
import { latestRequest } from "./latestRequest";
import { useFeedback } from "./Feedback";
const FarcasterSignInControl = lazy(
  () => import("@10x/connect/FarcasterSignInControl"),
);
configureConnectHost({
  name: () => "10X.meme",
  icon: () => "/base.webp",
  success: () => miniAppSuccess(),
});
import { api, type Identity } from "./client";
import { miniRuntime, nativeAccount, nativeSignature } from "./miniRuntime";
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
  const notify = useFeedback();
  const [role, setRole] = useState("reward");
  useEffect(() => {
    if (open) setRole("reward");
  }, [open]);
  const [nativeSolana, setNativeSolana] = useState(false);
  useEffect(() => {
    let active = true;
    void miniRuntime().then((runtime) => {
      if (active)
        setNativeSolana(
          runtime?.capabilities.includes("wallet.getSolanaProvider") === true,
        );
    });
    return () => {
      active = false;
    };
  }, []);
  const celebrated = useRef(new Map<string, string>());
  const identityRequests = useRef(latestRequest());
  const accountScope = useRef(initialIdentity?.farcasterFid);
  const [identity, setIdentity] = useState<Identity | null>(initialIdentity),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [wallets, setWallets] = useState<readonly SolanaWallet[]>([]),
    [selected, setSelected] = useState("");
  useEffect(() => {
    if (accountScope.current !== initialIdentity?.farcasterFid) {
      identityRequests.current.cancel();
      accountScope.current = initialIdentity?.farcasterFid;
    }
    setIdentity(initialIdentity);
    if (!initialIdentity?.farcasterFid) celebrated.current.delete("farcaster");
    if (!initialIdentity?.walletAddress) celebrated.current.delete("base");
  }, [initialIdentity]);
  function connected(kind: string, key: string, message: string) {
    if (celebrated.current.get(kind) === key) return;
    celebrated.current.set(kind, key);
    notify(message);
    void connectionSuccessEffects();
  }
  const refresh = async () => {
    let verified: Identity | undefined;
    await identityRequests.current.run(
      (signal) =>
        api("/api/auth/session", undefined, "GET", signal) as Promise<Identity>,
      (next) => {
        verified = next;
        setIdentity(next);
        onIdentity(next);
      },
      (e) => setError(e instanceof Error ? e.message : "Local API unavailable"),
    );
    return verified;
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
      identityRequests.current.cancel();
      offRegister();
      offUnregister();
    };
  }, []);
  async function solana(native = false) {
    setBusy(true);
    setError(null);
    try {
      if (native) {
        const runtime = await miniRuntime();
        if (!runtime?.capabilities.includes("wallet.getSolanaProvider"))
          throw Error("Solana wallet is unavailable in this host.");
        const provider = await runtime.sdk.wallet.getSolanaProvider();
        if (!provider)
          throw Error("Solana wallet is unavailable in this host.");
        const address = await nativeAccount(provider);
        const challenge = await api(
          "/api/auth/solana/challenge",
          {
            address,
            role,
          },
          "POST",
          undefined,
          identity?.farcasterFid,
        );
        const signed = await provider.signMessage(challenge.message);
        await api(
          "/api/auth/solana/verify",
          {
            nonce: challenge.nonce,
            signature: nativeSignature(signed.signature),
          },
          "POST",
          undefined,
          identity?.farcasterFid,
        );
        const next = await refresh();
        if (
          next?.wallets.some(
            (w) =>
              w.chain === "solana" && w.address === address && w.role === role,
          )
        )
          connected(
            "solana:" + role,
            address,
            role === "reward"
              ? "Reward wallet verified."
              : "Holding wallet verified.",
          );
        return;
      }
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
      const challenge = await api(
        "/api/auth/solana/challenge",
        {
          address: account.address,
          role,
        },
        "POST",
        undefined,
        identity?.farcasterFid,
      );
      const result = await signer.signMessage({
        account,
        message: new TextEncoder().encode(challenge.message),
      });
      if (!result[0]) throw Error("No signature returned");
      await api(
        "/api/auth/solana/verify",
        {
          nonce: challenge.nonce,
          signature: encode58(result[0].signature),
        },
        "POST",
        undefined,
        identity?.farcasterFid,
      );
      const next = await refresh();
      if (
        next?.wallets.some(
          (w) =>
            w.chain === "solana" &&
            w.address === account.address &&
            w.role === role,
        )
      )
        connected(
          "solana:" + role,
          account.address,
          role === "reward"
            ? "Reward wallet verified."
            : "Holding wallet verified.",
        );
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
        onWalletConnected={(address) =>
          void refresh().then((next) => {
            if (next?.walletAddress?.toLowerCase() === address.toLowerCase())
              connected("base", address.toLowerCase(), "Wallet connected.");
          })
        }
        farcasterControl={
          <Suspense fallback={<span>Loading…</span>}>
            <FarcasterSignInControl
              connected={!!identity?.farcasterFid}
              onAuthenticated={(authenticated) =>
                void refresh().then((next) => {
                  if (next?.farcasterFid === authenticated.fid) {
                    connected(
                      "farcaster",
                      String(authenticated.fid),
                      "Farcaster connected.",
                    );
                    onClose();
                  }
                })
              }
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
            <p className="fine">Verified ATTN trading results are public.</p>
            {nativeSolana && (
              <button
                disabled={!identity?.farcasterFid || busy}
                onClick={() => void solana(true)}
              >
                {busy ? "Verifying…" : "Use Farcaster Solana wallet"}
              </button>
            )}
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
                  disabled={busy}
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
              <>
                <p>No Solana wallet found.</p>
                {!nativeSolana && (
                  <p className="fine">
                    Use your wallet’s in-app browser, or a browser with a Solana
                    wallet installed.
                  </p>
                )}
              </>
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
                  disabled={busy}
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
