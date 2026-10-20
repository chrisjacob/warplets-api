import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { IdentityChallengeResponse, type IdentitySessionView } from "../../../discovery/src/identity-model";
import { connectSolana, createSolanaChallenge, getWallets, loadSolanaIdentity, logoutSolanaIdentity, onWalletChange, signOwnership, supportedWallet, verifySolanaChallenge, type SolanaAccount, type SolanaConnection, type SolanaWallet } from "./walletIdentityClient";

import { safeWalletReturn, verifiedSignInReturn } from "./walletReturn";

type Challenge = z.infer<typeof IdentityChallengeResponse>;
export function SolanaIdentity() {
  const requestedReturn = new URLSearchParams(window.location.search).get("returnTo"), returnTo = safeWalletReturn(requestedReturn);
  const [identity, setIdentity] = useState<IdentitySessionView | null>(null), [wallets, setWallets] = useState<readonly SolanaWallet[]>([]);
  const [connection, setConnection] = useState<SolanaConnection | null>(null), [accounts, setAccounts] = useState<readonly SolanaAccount[]>([]);
  const [challenge, setChallenge] = useState<Challenge | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now()), epoch = useRef(0), active = useRef(true);
  function invalidate() { epoch.current++; setChallenge(null); }
  useEffect(() => {
    active.current = true;
    const registry = getWallets(), update = () => setWallets(registry.get().filter(supportedWallet));
    update(); const registered = registry.on("register", update), unregistered = registry.on("unregister", update);
    const refresh = () => {
      const version = epoch.current;
      void loadSolanaIdentity().then(v => {
        if (active.current && epoch.current === version) { setIdentity(v); setError(""); }
      }).catch(e => {
        if (active.current && epoch.current === version) setError(e instanceof Error ? e.message : "Session unavailable.");
      });
    };
    refresh(); window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active.current = false; epoch.current++; registered(); unregistered(); window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!connection) return;
    const changed = () => {
      invalidate(); setConnection(null); setAccounts([]); setNotice("Wallet accounts changed. Connect and review a new challenge.");
    };
    const offChange = onWalletChange(connection.wallet, changed);
    const offRemove = getWallets().on("unregister", (...removed) => { if (removed.includes(connection.wallet)) changed(); });
    return () => { offChange(); offRemove(); };
  }, [connection]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "Wallet action failed."); }
    finally { if (active.current) setBusy(false); }
  }
  async function connect(wallet: SolanaWallet) {
    invalidate(); setConnection(null); setAccounts([]);
    const offered = await connectSolana(wallet);
    if (!active.current) return;
    if (!offered.length) throw new Error("No authorized Solana account supports raw message signing. Hardware/off-chain-only signing is not supported in this local version.");
    setAccounts(offered); setConnection({ wallet, account: offered[0]! });
  }
  async function prepare(intent: "login" | "link" | "unlink") {
    if (!connection) return;
    invalidate(); const version = epoch.current;
    const next = await createSolanaChallenge(connection.account.address, intent);
    if (active.current && epoch.current === version) setChallenge(next);
  }
  async function sign() {
    if (!connection || !challenge) return;
    if (Date.parse(challenge.expires_at) <= Date.now()) throw new Error("Challenge expired. Create a new one.");
    const version = epoch.current;
    const signature = await signOwnership(connection, challenge.message, () => active.current && epoch.current === version);
    const next = await verifySolanaChallenge(challenge.challenge_id, signature);
    if (!active.current || epoch.current !== version) return;
    const destination = verifiedSignInReturn(challenge.intent, next.authenticated, requestedReturn);
    invalidate(); setIdentity(next);
    if (destination) window.location.assign(destination);
    setNotice(challenge.intent === "unlink" ? "Wallet unlinked. All sessions for this identity were revoked. Sign in with a remaining wallet." : "Signed ownership verified. This local identity grants no votes.");
  }
  const signedIn = Boolean(identity?.authenticated && identity.expires_at && Date.parse(identity.expires_at) > now);
  const linked = identity?.wallets.some(w => w.address === connection?.account.address) ?? false;
  const seconds = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.expires_at) - now) / 1000)) : 0;
  return <>
    <header className="tenx-heading"><p className="tenx-eyebrow">ACCOUNT / SOLANA</p><h1>{signedIn ? "My wallets" : "Sign in with Solana"}</h1><p>Review and sign a message. No transaction or fee.</p></header>
    {requestedReturn && <p className="tenx-task-return">{signedIn ? <a className="tenx-button" href={returnTo}>Continue to your task →</a> : <>After sign-in, you’ll return to your previous page. <a href={returnTo}>← Back without signing in</a></>}</p>}
    {!identity && !error && <p role="status">Checking sign-in status…</p>}
    {signedIn && identity && <section className="tenx-panel"><div className="tenx-row"><h2>Sign-in status</h2><span className="tenx-badge">{signedIn ? "Signed in" : identity ? "Signed out" : "Loading…"}</span></div>
      <><details><summary>Session details</summary><p className="tenx-address">{identity.identity_id}</p><p>Session expires {new Date(identity.expires_at!).toLocaleString()}. Up to ten signed wallets per identity.</p></details><ul className="tenx-linked-wallets">{identity.wallets.map(w => <li key={w.address}><span className="tenx-address">{w.address}</span><small>Linked {new Date(w.linked_at).toLocaleString()}</small></li>)}</ul><button className="tenx-button tenx-button--quiet" disabled={busy} onClick={() => void run(async () => { invalidate(); setIdentity(await logoutSolanaIdentity()); setNotice("This browser session was revoked. Wallet links are retained."); })}>Sign out this browser</button></>
    </section>}
    <section className="tenx-panel"><h2>1. Choose a Solana wallet</h2><p>Connecting selects your account. You’ll review the message before signing.</p>
      {!wallets.length ? <><p>No compatible Solana wallet detected in this browser.</p><details><summary>Wallet requirements</summary><p>Use a Solana software wallet with Wallet Standard and message signing in this browser. Hardware-only wallets, mobile deep links and transaction-based sign-in are not supported in this local preview.</p></details></> : <div className="tenx-admin-actions">{wallets.map((w, i) => <button key={`${w.name}-${i}`} className="tenx-button tenx-button--quiet" disabled={busy || !identity} onClick={() => void run(() => connect(w))}>Connect {w.name}</button>)}</div>}
      {connection && <><p>Selected extension: {connection.wallet.name}</p><label>Signing account<select disabled={busy} value={connection.account.address} onChange={e => { invalidate(); const account = accounts.find(a => a.address === e.target.value); if (account) setConnection({ wallet: connection.wallet, account }); }}>{accounts.map(a => <option key={a.address} value={a.address}>{a.address}</option>)}</select></label><p className="tenx-address">{connection.account.address}</p>
        <div className="tenx-admin-actions"><button className="tenx-button" disabled={busy || !identity || (signedIn && linked)} onClick={() => void run(() => prepare(signedIn ? "link" : "login"))}>{signedIn ? linked ? "Already linked" : "Review wallet-link message" : "Review sign-in message"}</button>
          {signedIn && linked && <button className="tenx-button tenx-button--quiet" disabled={busy || (identity?.wallets.length ?? 0) < 2} onClick={() => void run(() => prepare("unlink"))}>Prepare signed unlink</button>}</div>
        {signedIn && linked && <p>Unlinking requires this wallet’s signature and revokes every session for the identity. Keep at least one linked wallet so you can sign in again.</p>}
      </>}
    </section>
    {challenge && <section className="tenx-panel"><h2>2. Review the ownership message</h2><p>{challenge.intent === "unlink" ? "This removes the selected wallet and signs out all sessions." : signedIn ? "This adds the selected wallet to the identity above." : "This signs in to a local identity."} Network: Solana mainnet. Message signature only.</p><pre className="tenx-identity-message">{challenge.message}</pre><p role="status">{seconds ? `Expires in ${seconds}s` : "Expired — prepare a new challenge."}</p><div className="tenx-admin-actions"><button className="tenx-button" disabled={busy || !seconds} onClick={() => void run(sign)}>{challenge.intent === "unlink" ? "Sign & unlink wallet" : "Sign & verify ownership"}</button><button className="tenx-button tenx-button--quiet" disabled={busy} onClick={invalidate}>Cancel</button></div></section>}
    <p role="status" aria-live="polite">{busy ? "Waiting for wallet or local verification…" : notice}</p>{error && <p role="alert" className="tenx-error">{error}</p>}
    <details className="tenx-panel"><summary>About this sign-in</summary><p>A signature proves control of a wallet, not a unique person, social authorship or organic activity. Voting, buy credits and rewards are disabled. Existing holdings do not become votes.</p><p>This local Solana identity is separate from EVM and Farcaster connections. Proofs and links stay in this workstation’s discovery database. Wallets keep their own keys; EVM linking and cross-account merging remain unavailable.</p></details>
  </>;
}
