import { useEffect, useRef, useState } from "react";
import { AttentionQueue, type AttentionQueueResult } from "../../../discovery/src/attention-queue-model";
import { gmgnChain, attentionAddress, type AttentionChainId } from "../../../discovery/src/attention-feed-contract";
import { providerAttentionOrder } from "../../../discovery/src/attention-lightweight";
import { getJson } from "./client";
import { DiscoveryNav } from "./DiscoveryNav";
import { navigateDiscovery } from "./navigation";
import { TokenImage } from "./TokenArtwork";
import "./discovery.css";
import "./trending.css";

const chains = { all: "All chains", solana: "Solana", base: "Base", bsc: "BSC", robinhood: "Robinhood" } as const;
type Chain = keyof typeof chains;
export const trendingRows = (report: AttentionQueueResult, chain: Chain = "all") =>
  providerAttentionOrder(report).filter(row => row.checks !== "adverse" && (chain === "all" || row.chain === chain));
export const gmgnTokenHref = (chain: AttentionChainId, address: string) => `https://gmgn.ai/${gmgnChain[chain]}/token/${encodeURIComponent(address)}`;
// Public static images only: exact chain/contract, no ticker lookup or provider API.
export const trendingTokenImageHref = (chain: AttentionChainId, address: string) => attentionAddress(chain,address)===address
  ? `https://dd.dexscreener.com/ds-data/tokens/${chain}/${address}.png` : null;
export function tokenLaunchAge(row: AttentionQueueResult["rows"][number], asOf: string) {
  // Only a fresh GMGN base supplies token opening time. Gecko/Dex timestamps are pool ages.
  const launch = row.reported_open_seconds, cutoff = Date.parse(asOf), started = (launch ?? 0) * 1000;
  if (!row.sources.some(s => s.provider === "gmgn" && s.fresh) || launch === null || launch <= 0
    || !Number.isFinite(started) || !Number.isFinite(cutoff) || started > cutoff) return { label: "—", launchedAt: null };
  const seconds = Math.floor((cutoff - started) / 1000);
  const label = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
  return { label, launchedAt: new Date(started).toISOString() };
}
const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: value >= 1000 ? "compact" : "standard", minimumFractionDigits: 0, maximumFractionDigits: value >= 1000 ? 1 : 2,
}).format(value);

export function TrendingLeaderboard({ report, busy = false, error = "", onRefresh }: {
  report: AttentionQueueResult | null; busy?: boolean; error?: string; onRefresh: () => void;
}) {
  const [chain, setChain] = useState<Chain>("all"), rows = report ? trendingRows(report, chain) : [];
  return <>
    <header className="tenx-trending-heading"><div><h1>Trending</h1><p>Memecoins getting attention.</p></div>
      <button className="tenx-trending-refresh" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
    </header>
    <div className="tenx-trending-toolbar"><label>Chain <select value={chain} onChange={event => setChain(event.target.value as Chain)}>
      {Object.entries(chains).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label><p role="status">{report ? <>{rows.length} tokens <span>· Updated <time dateTime={report.as_of}>{new Date(report.as_of).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span></> : busy ? "Loading trending tokens…" : "No saved list loaded"}</p></div>
    {error && <p className="tenx-trending-error" role="alert">{error}</p>}
    {rows.length > 0 ? <div className="tenx-trending-scroll" tabIndex={0} role="region" aria-label="Trending token leaderboard">
      <table className="tenx-trending-table"><caption className="sr-only">Trending tokens ranked by provider attention. All amounts in USD.</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Token</th><th scope="col" title="Time since GMGN's reported token launch/open time, at the saved snapshot.">Age</th><th scope="col">Market cap</th><th scope="col">Volume <span>24h</span></th><th scope="col">Liquidity</th><th scope="col"><span className="sr-only">Token link</span></th></tr></thead>
        <tbody>{rows.map((row, index) => { const href = gmgnTokenHref(row.chain, row.address), age = tokenLaunchAge(row, report!.as_of); return <tr key={`${row.chain}:${row.address}`}>
          <td className="tenx-trending-rank">{index + 1}</td><th scope="row"><a className="tenx-trending-token" href={href} target="_blank" rel="noopener noreferrer" title={`${chains[row.chain]} · ${row.address}`}>
            <TokenImage url={row.image_url} fallbackUrl={trendingTokenImageHref(row.chain,row.address)} thumbnailSize={64} name={row.name ?? row.symbol ?? "Token"} symbol={row.symbol ?? "?"}/>
            <span><strong>{row.symbol ?? row.name ?? `${row.address.slice(0, 6)}…${row.address.slice(-4)}`}</strong><small>{row.name && row.name !== row.symbol ? `${row.name} · ` : ""}{chains[row.chain]}</small></span>
          </a></th><td className="tenx-trending-age">{age.launchedAt ? <time dateTime={age.launchedAt} title={`Reported launch/open: ${new Date(age.launchedAt).toLocaleString()}`}>{age.label}</time> : <span title="Token launch time unavailable">—</span>}</td><td>{money(row.market_cap_usd)}</td><td>{money(row.volume_24h_usd)}</td><td>{money(row.liquidity_usd)}</td>
          <td><a className="tenx-trending-gmgn" href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${row.symbol ?? row.name ?? row.address} on GMGN (${chains[row.chain]})`}>View on GMGN <span aria-hidden="true">↗</span></a></td>
        </tr>; })}</tbody>
      </table></div> : report ? <div className="tenx-trending-empty"><h2>No fresh trending tokens</h2><p>{chain === "all" ? "The saved feeds have no fresh tokens to show. Check back after the next update." : "Try another chain or check back after the next update."}</p></div> : null}
    <p className="tenx-trending-note">GMGN Hot + GeckoTerminal Trending. Ranked by attention, not a safety rating. Age uses reported token launch/open time. Reported figures; — means unavailable.</p>
    {report && (report.history_truncated || report.gaps.length > 0) && <p className="tenx-trending-note">Showing the available saved sample; coverage is incomplete.</p>}
  </>;
}

export default function TrendingPage() {
  const [report, setReport] = useState<AttentionQueueResult | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const active = useRef<AbortController | null>(null), mounted = useRef(false);
  async function load() {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError("");
    try {
      const next = await getJson("/api/10x/discovery/attention", AttentionQueue, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
      if (mounted.current && !controller.signal.aborted) setReport(next);
    } catch { if (mounted.current && !controller.signal.aborted) setError("Couldn’t refresh trending tokens. Any list shown is the previous saved snapshot."); }
    finally { if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false); } }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; const request = active.current; active.current = null; request?.abort(); }; }, []);
  return <main className="tenx-discovery tenx-discovery--browse tenx-trending" tabIndex={-1} onClick={navigateDiscovery}>
    <DiscoveryNav path="/trending"/><TrendingLeaderboard report={report} busy={busy} error={error} onRefresh={() => void load()}/>
  </main>;
}
