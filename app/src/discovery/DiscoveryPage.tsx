import { useEffect, useState } from "react";
import type { AssessedCandidate, Proof } from "../../../discovery/src/model";
import { DetailResponse, getJson, ListResponse, readableReason, StatusResponse, type ListData } from "./client";
import "./discovery.css";

const money = (value: number | null | undefined) => value == null ? "Unavailable" : value > 0 && value < 0.000001 ? `$${value.toExponential(3)}` : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 6 : 0 }).format(value);
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Awaiting first successful refresh";
function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true; let controller: AbortController | undefined;
    setData(null); setError("");
    const refresh = async () => {
      controller?.abort(); const current = new AbortController(); controller = current;
      try { const value = await load(current.signal); if (active && !current.signal.aborted) { setData(value); setError(""); } }
      catch (e) { if (active && !current.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load discovery."); }
    };
    void refresh(); const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => { active = false; controller?.abort(); window.clearInterval(interval); };
    // key is the complete request identity; load is deliberately rebuilt on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, error };
}
function Badge({ status }: { status: string }) { return <span className={`tenx-badge tenx-badge--${status}`}>{status}</span>; }
function Evidence({ proof, label, fixture }: { proof: Proof | null; label: string; fixture: boolean }) {
  return <section className="tenx-evidence"><div className="tenx-row"><h3>{label}</h3><Badge status={proof ? fixture ? "simulated" : "verified" : "unverified"} /></div>
    {proof ? <><p>{time(proof.block_time)}</p><dl><dt>Instruction</dt><dd>{proof.instruction}</dd><dt>Finalized slot</dt><dd>{proof.slot.toLocaleString()}</dd></dl>
      <p className="tenx-address">{proof.signature}</p>
      {!fixture && <div className="tenx-inline-links"><a href={`https://solscan.io/tx/${proof.signature}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a><a href={`/api/10x/evidence/${proof.signature}`} target="_blank" rel="noopener noreferrer">Inspect saved evidence ↗</a></div>}
      <details><summary>Evidence hash and adapter</summary><p className="tenx-address">SHA-256 {proof.payload_hash}</p><p>{proof.adapter_version}</p><p>Fetched {time(proof.fetched_at)} · finalized RPC</p></details>
    </> : <p>No acceptable finalized transaction evidence is available.</p>}
  </section>;
}
function Freshness({ data }: { data: Pick<ListData, "as_of" | "coverage" | "source_freshness"> }) {
  return <aside className="tenx-freshness" role="status"><span className={`tenx-dot ${data.source_freshness.stale ? "tenx-dot--stale" : ""}`} />
    <div><strong>{data.source_freshness.stale ? "Data needs refreshing" : "Local ingestion connected"}</strong><p>Last successful refresh: {time(data.as_of)}</p><p>Bounded coverage · finalized Pump → PumpSwap · WSOL quotes</p></div>
  </aside>;
}
function CandidateCard({ candidate: c }: { candidate: AssessedCandidate }) {
  const fixture = c.mode === "fixture";
  return <article className="tenx-candidate">
    <div className="tenx-row"><span className="tenx-token-icon" aria-hidden="true">{c.symbol.slice(0, 2)}</span><div className="tenx-token-name"><h2><a href={`/token/solana/${c.address}${fixture ? "?mode=fixture" : ""}`}>{c.name}</a></h2><p>{c.symbol} <span>· Solana · OG token</span></p></div><Badge status={c.eligibility} /></div>
    <p className="tenx-address">{c.address}</p>
    <div className="tenx-metrics"><div><span>Market cap</span><strong>{money(c.market?.market_cap_usd)}</strong></div><div><span>Liquidity</span><strong>{money(c.market?.liquidity_usd)}</strong></div><div><span>Chain evidence</span><strong>{fixture ? "Simulated" : c.verification === "verified" ? "Verified origin + migration" : "Incomplete"}</strong></div></div>
    <p className="tenx-reason">{c.reasons.slice(0, 2).map(readableReason).join(" · ") || "Meets the current local discovery policy"}</p>
    <div className="tenx-card-bottom"><span>{c.creation ? `Created ${time(c.creation.block_time)}` : "Token creation time unknown"}</span><a href={`/token/solana/${c.address}${fixture ? "?mode=fixture" : ""}`}>Inspect evidence →</a></div>
  </article>;
}
function Discover() {
  const [mode, setMode] = useState<"live" | "fixture">("live"), [filter, setFilter] = useState("all");
  const url = `/api/10x/candidates?mode=${mode}&limit=100&status=${filter}`;
  const { data, error } = useRemote(signal => getJson(url, ListResponse, signal), url);
  return <>
    <header className="tenx-heading"><p className="tenx-eyebrow">10X DISCOVER / SOLANA</p><h1>Find the meme.<br /><span>Inspect the evidence.</span></h1><p>Discover recently graduated OG tokens and inspect what’s verified. Missing evidence stays provisional.</p></header>
    <div className="tenx-toolbar"><label>Data source<select value={mode} onChange={e => setMode(e.target.value as "live" | "fixture")}><option value="live">Live chain reads</option><option value="fixture">Simulation examples</option></select></label><label>Eligibility<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All observed</option><option value="eligible">Eligible</option><option value="provisional">Provisional</option><option value="excluded">Excluded</option></select></label></div>
    {mode === "fixture" && <aside className="tenx-notice">SIMULATION — synthetic examples for review. These are not live tokens or verified market data.</aside>}
    {error && <p className="tenx-notice" role="alert">{error} {data ? "The last response remains visible." : "Start the local discovery service to load data."}</p>}
    {data ? <><Freshness data={data} /><div className="tenx-stats" aria-label="Candidate totals"><div><strong>{data.data.counts.eligible}</strong><span>Eligible</span></div><div><strong>{data.data.counts.provisional}</strong><span>Provisional</span></div><div><strong>{data.data.counts.excluded}</strong><span>Excluded</span></div></div>
      <div className="tenx-section-title"><h2>{filter === "all" ? "Observed contenders" : `${filter[0]!.toUpperCase()}${filter.slice(1)} contenders`}</h2><span>100 maximum</span></div>
      {data.data.candidates.length ? data.data.candidates.map(c => <CandidateCard key={c.address} candidate={c} />) : <section className="tenx-empty"><h2>{filter === "eligible" ? "No eligible tokens yet" : "No candidates in this view yet"}</h2><p>Missing proof, market data or holder analysis keeps tokens provisional. We don’t fill the list with unverified claims.</p><a href="/status">Inspect data status →</a></section>}
      <p className="tenx-footnote">A new pool does not prove a new token or graduation. Data checks do not guarantee safety. Buying links do not count as votes.</p>
    </> : !error && <p role="status" className="tenx-empty">Loading discovery…</p>}
  </>;
}
function CandidateDetail({ address }: { address: string }) {
  const mode = new URLSearchParams(window.location.search).get("mode") === "fixture" ? "fixture" : "live";
  const url = `/api/10x/candidates/solana/${encodeURIComponent(address)}?mode=${mode}`;
  const { data, error } = useRemote(signal => getJson(url, DetailResponse, signal), url);
  const [copied, setCopied] = useState(false);
  if (error) return <p role="alert" className="tenx-notice">{error}</p>;
  if (!data) return <p role="status" className="tenx-empty">Loading candidate evidence…</p>;
  const c = data.data, fixture = c.mode === "fixture";
  return <>
    <a href="/discover" className="tenx-back">← All contenders</a>
    <header className="tenx-heading"><p className="tenx-eyebrow">SOLANA / OG TOKEN</p><h1>{c.name}</h1><div className="tenx-row"><span>{c.symbol}</span><Badge status={c.eligibility} /></div></header>
    {fixture && <aside className="tenx-notice">SIMULATION — addresses and proofs in this example are synthetic.</aside>}
    <section className="tenx-panel"><h2>Token identity</h2><p className="tenx-address">{c.address}</p><button className="tenx-button tenx-button--quiet" onClick={() => void navigator.clipboard.writeText(c.address).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "Copied" : "Copy full address"}</button>
      <p className="tenx-address">PumpSwap pool: {c.pool}</p>{!fixture && <a href={`https://solscan.io/token/${c.address}`} target="_blank" rel="noopener noreferrer">View token on Solscan ↗</a>}</section>
    <section className="tenx-panel"><h2>Eligibility review</h2><ul>{c.reasons.map(reason => <li key={reason}>{readableReason(reason)}</li>)}</ul><p>Launches and voting are disabled. This review is not a guarantee of token safety.</p></section>
    <Evidence proof={c.creation} label="Original token creation" fixture={fixture} /><Evidence proof={c.graduation} label="Pump → PumpSwap graduation" fixture={fixture} />
    <section className="tenx-panel"><h2>Market snapshot</h2><dl><dt>Market cap</dt><dd>{money(c.market?.market_cap_usd)}</dd><dt>FDV (separate)</dt><dd>{money(c.market?.fdv_usd)}</dd><dt>Price</dt><dd>{money(c.market?.price_usd)}</dd><dt>Liquidity</dt><dd>{money(c.market?.liquidity_usd)}</dd></dl><p>{c.market ? `Source: GeckoTerminal · fetched ${time(c.market.fetched_at)}. Provider observation time is unavailable.` : "Market enrichment is off or unavailable. No values have been invented."}</p></section>
    <section className="tenx-panel"><h2>Onchain risk checks</h2><dl><dt>Mint authority</dt><dd>{c.risk.mint_authority}</dd><dt>Freeze authority</dt><dd>{c.risk.freeze_authority}</dd><dt>Pool reserves</dt><dd>{c.risk.pool_reserves_verified ? "Verified initialized + nonzero" : "Unverified"}</dd><dt>Holder concentration</dt><dd>Unknown</dd><dt>Finalized account slot</dt><dd>{c.risk.context_slot?.toLocaleString() ?? "Unavailable"}</dd></dl><p>Observed {time(c.risk.observed_at)}</p>{!fixture && c.risk.payload_hash && <a href={`/api/10x/account-evidence/${c.risk.payload_hash}`} target="_blank" rel="noopener noreferrer">Inspect saved account evidence ↗</a>}</section>
  </>;
}
function StatusView() {
  const { data, error } = useRemote(signal => getJson("/api/10x/system/status", StatusResponse, signal), "status");
  return <><header className="tenx-heading"><p className="tenx-eyebrow">DATA / OPERATIONS</p><h1>Know what’s fresh.</h1><p>Source coverage, proof gaps and free-service budgets, in plain sight.</p></header>
    {error && <p role="alert" className="tenx-notice">{error}</p>}{data ? <><Freshness data={data} /><section className="tenx-panel"><h2>Local ingestion</h2><dl><dt>State</dt><dd>{data.data.paused ? "Paused" : data.data.running ? "Refreshing" : "Waiting for next tick"}</dd><dt>Last source issue</dt><dd>{data.data.last_error ? readableReason(data.data.last_error) : "None recorded"}</dd><dt>Queued signatures</dt><dd>{data.data.pending_signatures}</dd><dt>Market provider</dt><dd>{data.coverage.market_enabled ? "GeckoTerminal enabled locally" : "Off pending usage review"}</dd><dt>Proof adapter</dt><dd className="tenx-address">{data.data.adapter_version}</dd></dl></section>
      <section className="tenx-panel"><h2>Daily source budgets · UTC</h2>{(["rpc", "market"] as const).map(provider => { const used = data.data.usage.find(u => u.provider === provider)?.used ?? 0, limit = data.data.daily_limits[provider]; return <div className="tenx-budget" key={provider}><div className="tenx-row"><strong>{provider === "rpc" ? "Solana public RPC" : "Market enrichment"}</strong><span>{used} / {limit}</span></div><meter min={0} max={limit} value={used} aria-label={`${provider} daily requests`} /></div>; })}<p>Budgets pause work when exhausted. No paid upgrade or onchain transaction is enabled.</p></section>
    <section className="tenx-panel"><h2>Coverage limits</h2><ul><li>Recent Pump migration-authority activity only; scans are bounded and may miss transactions.</li><li>Creation search inspects at most 3,000 bonding-curve signatures and three historical transactions.</li><li>WSOL-quoted canonical PumpSwap pools only.</li><li>Holder concentration remains unverified and blocks eligibility.</li><li>Provider market cap can be unavailable even when FDV exists.</li></ul></section>
    </> : !error && <p role="status">Loading source status…</p>}</>;
}
function AdminView() {
  const [token, setToken] = useState(""), [data, setData] = useState<Record<string, unknown> | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  async function action(path: string, body?: unknown) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/10x/admin/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? "Enter the local operator token to continue." : `Request failed (${response.status}).`);
      if (value && typeof value === "object") setData(value as Record<string, unknown>);
      setMessage("Local operation completed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); }
    finally { setBusy(false); }
  }
  return <><header className="tenx-heading"><p className="tenx-eyebrow">LOCAL / ADMIN</p><h1>Discovery controls.</h1><p>Read jobs, pause ingestion and run a simulated election. No token launch or spending controls exist here.</p></header>
    <section className="tenx-panel"><label className="tenx-admin-token">Local operator token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="Required for admin requests" /></label><p>The token stays in this page’s memory. It is not saved in browser storage.</p>
      <div className="tenx-admin-actions"><button disabled={busy || !token} className="tenx-button" onClick={() => void action("jobs")}>Inspect jobs</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("refresh", { reason: "Operator requested local refresh" })}>Refresh now</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("pause", { paused: true, reason: "Operator paused local discovery" })}>Pause</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("pause", { paused: false, reason: "Operator resumed local discovery" })}>Resume</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("dry-run", { reason: "Operator requested election dry run" })}>Election dry run</button></div>
      <p role="status" aria-live="polite">{busy ? "Working locally…" : message}</p></section>{data && <section className="tenx-panel"><h2>Operation result</h2><pre className="tenx-result">{JSON.stringify(data, null, 2)}</pre></section>}</>;
}
export default function DiscoveryPage({ path }: { path: string }) {
  const clean = path.replace(/\/+$/, "");
  const match = clean.match(/^\/token\/solana\/([^/]+)$/);
  return <main className="tenx-discovery"><nav aria-label="10X discovery navigation" className="tenx-nav"><a href="/discover" aria-current={clean === "/discover" ? "page" : undefined}>Discover</a><a href="/status" aria-current={clean === "/status" ? "page" : undefined}>Data status</a><a href="/admin/10x" aria-current={clean === "/admin/10x" ? "page" : undefined}>Admin</a><a href="/thesis">Thesis ↗</a></nav>{match ? <CandidateDetail key={match[1]} address={match[1]!} /> : clean === "/status" ? <StatusView /> : clean === "/admin/10x" ? <AdminView /> : <Discover />}</main>;
}
