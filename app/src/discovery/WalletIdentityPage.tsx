import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { IdentityChallengeResponse, type IdentitySessionView } from "../../../discovery/src/identity-model";
import { connectSolana, createSolanaChallenge, getWallets, loadSolanaIdentity, logoutSolanaIdentity, onWalletChange, signOwnership, supportedWallet, verifySolanaChallenge, type SolanaAccount, type SolanaConnection, type SolanaWallet } from "./walletIdentityClient";

type Challenge = z.infer<typeof IdentityChallengeResponse>;
export function SolanaIdentity() {
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
    if (!active.current) return;
    invalidate(); setIdentity(next);
    setNotice(challenge.intent === "unlink" ? "Wallet unlinked. All sessions for this identity were revoked. Sign in with a remaining wallet." : "Signed ownership verified. This local identity grants no votes.");
  }
  const signedIn = Boolean(identity?.authenticated && identity.expires_at && Date.parse(identity.expires_at) > now);
  const linked = identity?.wallets.some(w => w.address === connection?.account.address) ?? false;
  const seconds = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.expires_at) - now) / 1000)) : 0;
  return <>
    <header className="tenx-heading"><p className="tenx-eyebrow">LOCAL / SOLANA IDENTITY</p><h1>Your wallets.<br /><span>Your ownership proof.</span></h1><p>Link Solana wallets with signed messages. No fees, transfers or votes.</p></header>
    <aside className="tenx-notice"><strong>Foundation for community backing</strong><p>Ownership proves control of a key, not one person or organic activity. Votes, buy credits and rewards remain disabled. This local identity is separate from the header’s EVM / Farcaster account.</p></aside>
    <section className="tenx-panel"><div className="tenx-row"><h2>Local 10X identity</h2><span className="tenx-badge">{signedIn ? "Signed ownership" : identity ? "Signed out" : "Loading…"}</span></div>
      {signedIn && identity ? <><p className="tenx-address">{identity.identity_id}</p><p>Session expires {new Date(identity.expires_at!).toLocaleString()}. Up to ten signed wallets per identity.</p><ul className="tenx-linked-wallets">{identity.wallets.map(w => <li key={w.address}><span className="tenx-address">{w.address}</span><small>Linked {new Date(w.linked_at).toLocaleString()}</small></li>)}</ul><button className="tenx-button tenx-button--quiet" disabled={busy} onClick={() => void run(async () => { invalidate(); setIdentity(await logoutSolanaIdentity()); setNotice("This browser session was revoked. Wallet links are retained."); })}>Sign out this browser</button></> : <p>Sign a challenge to create or recover a local identity. Sign in with any previously linked wallet to return to the same identity.</p>}
    </section>
    <section className="tenx-panel"><h2>1. Choose a Solana wallet</h2><p>Connecting lets you choose an account. Linking requires the separate signature below.</p>
      {!wallets.length ? <p className="tenx-notice">No compatible Wallet Standard wallet detected. Open this local preview in a browser with a Solana software wallet that supports message signing. Hardware-only wallets, mobile deep links and transaction-based sign-in are not supported yet.</p> : <div className="tenx-admin-actions">{wallets.map((w, i) => <button key={`${w.name}-${i}`} className="tenx-button tenx-button--quiet" disabled={busy || !identity} onClick={() => void run(() => connect(w))}>Connect {w.name}</button>)}</div>}
      {connection && <><p>Selected extension: {connection.wallet.name}</p><label>Signing account<select disabled={busy} value={connection.account.address} onChange={e => { invalidate(); const account = accounts.find(a => a.address === e.target.value); if (account) setConnection({ wallet: connection.wallet, account }); }}>{accounts.map(a => <option key={a.address} value={a.address}>{a.address}</option>)}</select></label><p className="tenx-address">{connection.account.address}</p>
        <div className="tenx-admin-actions"><button className="tenx-button" disabled={busy || !identity || (signedIn && linked)} onClick={() => void run(() => prepare(signedIn ? "link" : "login"))}>{signedIn ? linked ? "Already linked" : "Prepare wallet link" : "Prepare sign-in"}</button>
          {signedIn && linked && <button className="tenx-button tenx-button--quiet" disabled={busy || (identity?.wallets.length ?? 0) < 2} onClick={() => void run(() => prepare("unlink"))}>Prepare signed unlink</button>}</div>
        {signedIn && linked && <p>Unlinking requires this wallet’s signature and revokes every session for the identity. Keep at least one linked wallet so you can sign in again.</p>}
      </>}
    </section>
    {challenge && <section className="tenx-panel"><h2>2. Review the ownership message</h2><p>{challenge.intent === "unlink" ? "This removes the selected wallet and signs out all sessions." : signedIn ? "This adds the selected wallet to the identity above." : "This signs in to a local identity."} Network: Solana mainnet. Message signature only.</p><pre className="tenx-identity-message">{challenge.message}</pre><p role="status">{seconds ? `Expires in ${seconds}s` : "Expired — prepare a new challenge."}</p><div className="tenx-admin-actions"><button className="tenx-button" disabled={busy || !seconds} onClick={() => void run(sign)}>{challenge.intent === "unlink" ? "Sign & unlink wallet" : "Sign & verify ownership"}</button><button className="tenx-button tenx-button--quiet" disabled={busy} onClick={invalidate}>Cancel</button></div></section>}
    <p role="status" aria-live="polite">{busy ? "Waiting for wallet or local verification…" : notice}</p>{error && <p role="alert" className="tenx-error">{error}</p>}
    <section className="tenx-panel"><h2>What comes next</h2><p>Confirmed supported buys, election windows, net-buy scoring, round-trip checks and Sybil review still need implementation. Linking does not make a token eligible or turn an existing holding into a vote.</p><p>Proofs and links stay in this workstation’s discovery database. Wallets keep their own keys. EVM linking and cross-account merging remain unavailable.</p></section>
  </>;
}
