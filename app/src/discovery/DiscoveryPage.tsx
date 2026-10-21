import { lazy, Suspense, useEffect, useState } from "react";
import type { AssessedCandidate, Proof } from "../../../discovery/src/model";
import type { CandidateCard as Card } from "../../../discovery/src/candidate-card";
import { CardListResponse } from "./client";
import { navigateDiscovery } from "./navigation";
import { DiscoveryNav } from "./DiscoveryNav";
import { CollectionDetails, isCollectionAnchor } from "./CollectionDetails";
import { EvidenceDisclosure } from "./EvidenceDisclosure";
import { EligibilityOverview, TokenMarketOverview, WalletRiskSummary, creationAge, eligibilityMeaning, shortBlocker, marketSnapshotStale } from "./TokenOverview";
import { SimulationNotice } from "./SimulationNotice";
import { DEFAULT_POLICY } from "../../../discovery/src/model";
import { reportedCapReview } from "../../../discovery/src/market-review";
import { ActivityResponse, CoverageResponse, DetailResponse, ElectionDetailResponse, ElectionsResponse, getJson, marketSource, readableReason, ReviewsResponse, StatusResponse, type ListData } from "./client";
import { CandidateExpiryNotice, CandidateInventory } from "./CandidateRetention";
import {MarketBatchCoverage} from "./MarketBatchCoverage";
import { SourcePilotPanel } from "./SourcePilotPanel";
import { GmgnEvidence } from "./GmgnEvidence";
import { HolderHistory } from "./HolderHistory";
import {DiscoveryScoreBadge,DiscoveryScorePanel} from "./DiscoveryScore";
import {DiscoveryScoreResponse} from "./client";
import {ScoreResearchResponse} from "./client";
import {ScoreResearch} from "./ScoreResearch";
import {ScoreFollowup} from "./ScoreFollowup";
import {ScoreFollowupResponse} from "./client";
import type { ElectionSummary } from "../../../discovery/src/election-model";
import { TokenHistory, TokenImage, useTokenArtwork } from "./TokenMarket";
import { WalletAnalysisPanel } from "./WalletAnalysis";
import { feeSol, TradingFeesPanel } from "./TradingFees";
import { WalletWorkResponseSchema } from "../../../discovery/src/wallet-work-model";
import { PolicyLab, PolicyView } from "./PolicyReview";
import { SignalResearch } from "./SignalResearch";
import { SignalsResponse } from "./client";
import { WalletPlansResponseSchema } from "../../../discovery/src/wallet-plan-model";
import { WalletCoveragePlan } from "./WalletCoveragePlan";
import { OperationsResponse } from "./client";
import { OperationsPanel } from "./OperationsPanel";
import { SolanaIdentity } from "./WalletIdentityPage";
import { BackingLab, BackingPage } from "./BackingRehearsal";
import { AttentionRewardLab, AttentionRewardsPage } from "./AttentionRewards";
import { InboxRecoveryPanel } from "./InboxRecoveryPanel";
import { MintReviewsPanel } from "./MintReviewsPanel";
import { MintReviewsResponse } from "../../../discovery/src/mint-review-model";
import { InboxRecoveryResponse } from "../../../discovery/src/inbox-recovery-model";
import "./discovery.css";

const LazyLaunchRecovery = lazy(() => import("./LaunchRecoveryLab").then(m => ({ default: m.LaunchRecoveryPage })));
const LazyLaunchRecoveryAdmin = lazy(() => import("./LaunchRecoveryLab").then(m => ({ default: m.LaunchRecoveryAdmin })));
const LazyLaunchCurve = lazy(() => import("./LaunchCurveLab").then(m => ({ default: m.LaunchCurveLabPage })));
const LazyLaunchCurveAdmin = lazy(() => import("./LaunchCurveLab").then(m => ({ default: m.LaunchCurveAdmin })));
const LazyAttentionContent = lazy(() => import("./AttentionContent").then(m => ({ default: m.AttentionContentPage })));
const LazyContentModeration = lazy(() => import("./AttentionContent").then(m => ({ default: m.ContentModerationLab })));
function AttentionContentPage(props: { campaignId?: string; submitOnly?: boolean }) { return <Suspense fallback={<p role="status">Loading content review…</p>}><LazyAttentionContent {...props} /></Suspense>; }
function ContentModerationLab(props: { token: string }) { return <Suspense fallback={<p role="status">Loading moderation controls…</p>}><LazyContentModeration {...props} /></Suspense>; }

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
function MarketCapReview({ candidate, detailed = false }: { candidate: Pick<Card, "market" | "creation">; detailed?: boolean }) {
  const review = reportedCapReview(candidate, new Date(), DEFAULT_POLICY.max_market_age_seconds);
  if (!review) return null;
  return <aside className="tenx-notice"><strong>High reported cap for a new token · review</strong><p>{detailed ? `${money(review.market_cap_usd)} reported cap · created ${review.age_hours.toFixed(1)} hours ago. Review supply, pool depth and connected wallets.` : "Reported cap above $10M within 24 hours of creation."}</p>
    {detailed && <><p>Reported snapshot fetched {time(review.fetched_at)}. {review.market_stale ? "Snapshot is stale or has an invalid timestamp." : "Within the current freshness window."}</p><details><summary>Why this is flagged</summary><p>Above $10M within 24 hours is a review heuristic, not a fraud finding or an eligibility rule. Inspect holder concentration alongside wallet evidence. Reported liquidity / market cap: {review.liquidity_to_cap_pct === null ? "Unavailable" : `${review.liquidity_to_cap_pct.toFixed(2)}%`}. This ratio does not measure cash backing or executable exit liquidity. Market cap remains provider reported; FDV is not substituted.</p></details></>}
    {!detailed && review.market_stale && <p>Saved market snapshot is stale or has an invalid timestamp.</p>}
  </aside>;
}
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
  return <aside className="tenx-freshness tenx-freshness--compact" role="status"><span className={`tenx-dot ${data.source_freshness.stale ? "tenx-dot--stale" : ""}`} />
    <div><strong>{data.source_freshness.stale ? "Data needs refreshing" : "Saved observations"}</strong><span> · Updated {time(data.as_of)} · Coverage incomplete. </span><a href="/status#coverage">Data status →</a></div>
  </aside>;
}
function CandidateCard({ candidate: c, metadataUrl, metadataLoading }: { candidate: Card; metadataUrl?: string | null; metadataLoading?: boolean }) {
  const fixture = c.mode === "fixture";
  return <article className="tenx-candidate">
    <div className="tenx-candidate-heading"><a className="tenx-artwork-link" href={`/token/solana/${c.address}${fixture ? "?mode=fixture" : ""}`} aria-label={`Inspect ${c.name} (${c.address})`}><TokenImage url={c.market?.image_url} metadataUrl={metadataUrl} metadataLoading={metadataLoading} name={c.name} symbol={c.symbol} /></a><div className="tenx-token-name"><h2><a href={`/token/solana/${c.address}${fixture ? "?mode=fixture" : ""}`}>{c.name}</a></h2><p>{c.symbol} <span>· Solana · OG token</span></p></div></div>
    <DiscoveryScoreBadge score={c.discovery_score} rank={c.discovery_rank} />
    <div className="tenx-metrics"><div><span>Market cap</span><strong>{money(c.market?.market_cap_usd)}</strong></div><div><span>Liquidity</span><strong>{money(c.market?.liquidity_usd)}</strong></div><div><span>Created</span><strong>{creationAge(c.creation?.block_time)}</strong></div></div>
    {c.market && marketSnapshotStale(c.market) && <p className="tenx-market-warning">Market data needs refreshing.</p>}
    <MarketCapReview candidate={c} />
    <p className="tenx-reason">{c.reasons.length?`Checks to review: ${c.reasons.slice(0,2).map(shortBlocker).join(" · ")}`:"Required action checks passed at this observation. This does not guarantee safety."}</p>
    <details className="tenx-card-evidence"><summary>Token identity & action checks</summary><p className="tenx-address">{c.address}</p><p>{eligibilityMeaning(c.eligibility)} · <Badge status={c.eligibility} /></p><p>{fixture ? "Simulated origin evidence" : c.verification === "verified" ? "Original creation and graduation verified" : "Origin checks incomplete"}</p><p>{c.holders ? `${c.holders.holder_count} owners · largest ${c.holders.top1_pct?.toFixed(2) ?? "?"}% · ${c.holders.status} saved inventory` : "Holder inventory pending"}</p>{!fixture && <a href={`https://solscan.io/token/${c.address}`} target="_blank" rel="noopener noreferrer">View mint on Solscan ↗</a>}</details>
    <div className="tenx-card-bottom"><span>Solana · original token</span><a href={`/token/solana/${c.address}${fixture ? "?mode=fixture" : ""}`}>Charts & evidence →</a></div>
  </article>;
}
function DiscoveryDiagnostics() {
  const coverage = useRemote(signal => getJson("/api/10x/discovery/coverage", CoverageResponse, signal), "coverage");
  const walletWork = useRemote(signal => getJson("/api/10x/discovery/wallet-work", WalletWorkResponseSchema, signal), "wallet-work");
  const walletPlan = useRemote(signal=>getJson("/api/10x/discovery/wallet-plan",WalletPlansResponseSchema,signal),"wallet-plan");
  return <>
    {coverage.data && <section className="tenx-panel"><h2>Action readiness · {coverage.data.data.eligible} / 10</h2><p>{coverage.data.data.created_24h} stored tokens have verified creation times within 24 hours. {coverage.data.data.market_floor_met} meet fresh reported market-cap and liquidity floors; {coverage.data.data.holder_checks_met} pass creation, graduation, market and holder gates before wallet review.</p><p>Discover ranks observed tokens by score before these action checks pass. This readiness diagnostic never waives a gate; source scans remain incomplete.</p><details><summary>What is blocking eligibility?</summary><ul>{coverage.data.data.blockers.map(b => <li key={b.code}>{b.count}: {readableReason(b.code)}</li>)}</ul><p>One token may have multiple blockers. {coverage.data.data.creation_unknown} stored tokens still lack a verified creation time.</p></details><a href="/status">Inspect free budgets & refresh coverage →</a></section>}
    {coverage.error && <p className="tenx-notice" role="alert">Eligibility coverage could not refresh. {coverage.data ? "Last coverage remains visible." : "Check Data status."}</p>}
    <WalletCoveragePlan data={walletPlan.data?.data ?? null} error={walletPlan.error} />
    {walletWork.error && <p className="tenx-notice" role="alert">Funding progress could not refresh. {walletWork.data ? "Last response remains visible." : "Check Data status."}</p>}
    {walletWork.data && <section className="tenx-panel"><h2>Finishing wallet & funding checks</h2><p>Saved funding scans resume before another trade sample is collected. Progress does not refresh eligibility: each token still needs a fresh full wallet snapshot and every other check.</p><p>Catch-up allowance reserved: {walletWork.data.data.catchup_reserved} / {walletWork.data.data.catchup_limit} RPC calls, inside the existing wallet and global daily budgets.</p>{!!walletWork.data.data.work.length && <details><summary>Direct funding progress ({walletWork.data.data.work.length} tokens)</summary><div className="tenx-table-scroll"><table><thead><tr><th>Token</th><th>Examined windows</th><th>Decoded transactions</th><th>Next step</th></tr></thead><tbody>{walletWork.data.data.work.map(w => <tr key={w.address}><td><a href={`/token/solana/${w.address}`}>{w.symbol}</a><p className="tenx-address">{w.address}</p></td><td>{w.examined_windows} / {w.windows}</td><td>{w.decoded_transactions} · {w.pending_transactions} pending</td><td>{w.stage === "direct_funding" ? "Continue saved funding scan" : w.stage === "refresh_required" ? "Collect fresh wallet snapshot" : "Source or sample limit remains"}<details><summary>Gaps & timing</summary><p>Progress: {time(w.attempted_at)}. Wallet snapshot: {time(w.snapshot_at)}.</p><ul>{w.gaps.map(g => <li key={g}>{readableReason(g)}</li>)}</ul></details></td></tr>)}</tbody></table></div></details>}</section>}
  </>;
}
function Discover() {
  useEffect(() => {
    const moveLegacyAnchor = () => { if (isCollectionAnchor(window.location.hash)) window.location.replace('/status' + window.location.hash); };
    moveLegacyAnchor(); window.addEventListener('hashchange', moveLegacyAnchor);
    return () => window.removeEventListener('hashchange', moveLegacyAnchor);
  }, []);
  const [mode, setMode] = useState<"live" | "fixture">("live"), [filter, setFilter] = useState("all");
  const [age, setAge] = useState("24h"),[sort,setSort]=useState("score");
  const url = `/api/10x/candidates?mode=${mode}&limit=100&view=cards&status=${filter}&age=${mode === "fixture" ? "all" : age}&sort=${sort}`;
  const { data, error } = useRemote(signal => getJson(url, CardListResponse, signal), url);
  const artwork = useTokenArtwork(mode === "live" ? data?.data.candidates.map(c => c.address) ?? [] : []);
  const reviewAt = new Date(), capReviews = data?.data.candidates.filter(c => reportedCapReview(c, reviewAt, DEFAULT_POLICY.max_market_age_seconds)).length ?? 0;
  return <>
    <header className="tenx-heading tenx-heading--discover"><p className="tenx-eyebrow">SOLANA / ORIGINAL TOKENS</p><h1>Discover memecoins.</h1><p>Compare scores, explore the charts and check the evidence.</p></header>
    <div className="tenx-toolbar"><label>Sort by<select value={sort} onChange={e=>setSort(e.target.value)}><option value="score">Discovery score · highest first</option><option value="liquidity">Fresh reported liquidity</option></select></label>{mode === "live" && <label>Created<select value={age} onChange={e => setAge(e.target.value)}><option value="24h">Past 24 hours · verified</option><option value="all">All stored observations</option></select></label>}</div>
    <p className="tenx-footnote">Scores grade measured support, not the chance of safety. Missing evidence and observed risks remain visible. <a href="/transparency">How scoring works →</a></p>
    {mode === "fixture" && <aside className="tenx-notice">SIMULATION — synthetic examples, not live tokens or verified market data. <button className="tenx-button tenx-button--quiet" onClick={() => setMode("live")}>Return to live observations</button></aside>}
    {error && <p className="tenx-notice" role="alert">{error} {data ? "The last response remains visible." : "Start the local discovery service to load data."}</p>}
    {data ? <><Freshness data={data} /><p>{data.data.candidates.length} tokens in this view · {sort==="score"?"Ranked by Discovery score":"Ordered by fresh reported liquidity"} · 100 maximum</p>
      <div className="tenx-section-title"><h2>{filter === "all" ? "Ranked observations" : `${filter[0]!.toUpperCase()} action checks`}</h2><span>Score / 100</span></div>
      {data.data.candidates.length ? data.data.candidates.map(c => <CandidateCard key={c.address} candidate={c} metadataUrl={artwork[c.address]?.image_url} metadataLoading={mode === "live" && artwork[c.address] === undefined} />) : <section className="tenx-empty"><h2>No tokens match this view</h2><p>Change the date or action-check filter to inspect other observations. Missing data remains unknown in every score.</p><a href="/status">Inspect data status →</a></section>}
      {!!capReviews && <p className="tenx-footnote">{capReviews} tokens have reported caps above $10M within 24 hours of verified creation. Each is flagged for review; this does not change eligibility or ranking.</p>}
      <p className="tenx-footnote">Checks do not guarantee safety. Images and names can be copied; confirm the mint address.</p>
    </> : !error && <p role="status" className="tenx-empty">Loading discovery…</p>}
    <details className="tenx-list-options"><summary>Action-check filters & example data</summary><p>All observed tokens can be scored. Separate eligibility gates still govern future voting and launch decisions; buying links do not count as votes. Names and artwork can be copied.</p><label>Action checks<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All ranked observations</option><option value="eligible">Eligible</option><option value="provisional">Provisional</option><option value="excluded">Excluded</option></select></label><label>Data source<select value={mode} onChange={e => setMode(e.target.value as "live" | "fixture")}><option value="live">Saved live observations</option><option value="fixture">Simulation examples</option></select></label>{data&&<p>Action readiness across observed inputs: {data.data.counts.eligible} eligible · {data.data.counts.provisional} provisional · {data.data.counts.excluded} excluded. This is separate from score ranking.</p>}</details>
  </>;
}
function CandidateDetail({ address }: { address: string }) {
  const mode = new URLSearchParams(window.location.search).get("mode") === "fixture" ? "fixture" : "live";
  const url = `/api/10x/candidates/solana/${encodeURIComponent(address)}?mode=${mode}`;
  const { data, error } = useRemote(signal => getJson(url, DetailResponse, signal), url);
  const scoring=useRemote(signal=>getJson(`/api/10x/discovery/scores/solana/${encodeURIComponent(address)}?mode=${mode}`,DiscoveryScoreResponse,signal),`score:${mode}:${address}`);
  const [copied, setCopied] = useState(false);
  const artwork = useTokenArtwork(mode === "live" ? [address] : []);
  if (!data) return error ? <p role="alert" className="tenx-notice">{error}</p> : <p role="status" className="tenx-empty">Loading candidate evidence…</p>;
  const c = data.data, fixture = c.mode === "fixture";
  return <>
    <a href="/discover" className="tenx-back">← All contenders</a>
    {error && <p role="alert" className="tenx-notice">{error} The last verified response remains visible.</p>}
    <header className="tenx-heading"><p className="tenx-eyebrow">SOLANA / OG TOKEN</p><div className="tenx-token-heading"><TokenImage url={c.market?.image_url} metadataUrl={artwork[address]?.image_url} metadataLoading={!fixture && artwork[address] === undefined} name={c.name} symbol={c.symbol} large /><div className="tenx-token-name"><h1>{c.name}</h1><div className="tenx-row"><span>{c.symbol}</span></div></div></div></header>
    {fixture && <aside className="tenx-notice">SIMULATION — token identities, proofs and market values are synthetic examples.</aside>}
    {data.retention && <CandidateExpiryNotice receipt={data.retention} />}
    <div className="tenx-token-identity"><span className="tenx-address">{c.address}</span><button className="tenx-button tenx-button--quiet" onClick={() => void navigator.clipboard.writeText(c.address).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "Copied" : "Copy mint"}</button>{!fixture && <a href={`https://solscan.io/token/${c.address}`} target="_blank" rel="noopener noreferrer">Explorer ↗</a>}</div>
    <TokenMarketOverview candidate={c} />
    <DiscoveryScorePanel record={scoring.data?.record??null} error={scoring.error} />
    <MarketCapReview candidate={c} detailed />
    {(c.wallet_analysis?.signals.length || c.wallet_analysis?.status === "signals_detected") ? <WalletRiskSummary candidate={c} /> : null}
    {!fixture && <TokenHistory address={c.address} />}
    <h2 className="tenx-evidence-title" id="evidence">Supporting evidence</h2>
    <p className="tenx-footnote">Launches and voting are disabled. Verified checks do not guarantee safety.</p>
    {!fixture && <GmgnEvidence key={c.address} address={c.address} />}
    <EvidenceDisclosure id="action-checks" title="Voting & launch readiness"><EligibilityOverview status={c.eligibility} reasons={c.reasons} /></EvidenceDisclosure>
    <EvidenceDisclosure id="identity-evidence" title="Token identity & artwork sources">
    <section className="tenx-panel"><h2>Token identity</h2><p className="tenx-address">{c.address}</p><button className="tenx-button tenx-button--quiet" onClick={() => void navigator.clipboard.writeText(c.address).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "Copied" : "Copy full address"}</button>
      <p className="tenx-address">PumpSwap pool: {c.pool}</p>{!fixture && <a href={`https://solscan.io/token/${c.address}`} target="_blank" rel="noopener noreferrer">View token on Solscan ↗</a>}</section>
    {!fixture && artwork[address]?.metadata_uri && <details className="tenx-panel"><summary>Artwork source</summary><p>Presentation metadata linked by this mint’s saved Pump creation. Artwork can be copied and does not establish authenticity or eligibility. Market-provider images take precedence when available.</p><p>Metadata fetched {time(artwork[address]!.fetched_at)}. {artwork[address]!.error ? "Image unavailable from this metadata source." : "The creation link and metadata response hash are retained."}</p><a href={artwork[address]!.metadata_uri!} target="_blank" rel="noopener noreferrer">View creation-linked metadata ↗</a><p className="tenx-address">Metadata hash: {artwork[address]!.metadata_hash ?? "Unavailable"}</p></details>}
    </EvidenceDisclosure>
    <EvidenceDisclosure id="origin-evidence" title="Creation & graduation evidence" summary={fixture ? "Synthetic example" : c.verification === "verified" ? "Origin transactions verified" : "Origin checks incomplete"}>
    <Evidence proof={c.creation} label="Original token creation" fixture={fixture} /><Evidence proof={c.graduation} label="Pump → PumpSwap graduation" fixture={fixture} />
    </EvidenceDisclosure>
    <EvidenceDisclosure id="market-evidence" title="Market source & reported values">
    <section className="tenx-panel"><h2>Market snapshot</h2><dl><dt>Market cap (provider reported)</dt><dd>{money(c.market?.market_cap_usd)}</dd><dt>FDV (separate)</dt><dd>{money(c.market?.fdv_usd)}</dd><dt>Price</dt><dd>{money(c.market?.price_usd)}</dd><dt>Liquidity</dt><dd>{money(c.market?.liquidity_usd)}</dd></dl><p>{c.market ? `Source: ${marketSource(c.market.source)} · fetched ${time(c.market.fetched_at)}. Provider observation time is unavailable; market cap is not an independent circulating-supply audit.` : "Market enrichment is off or unavailable. No values have been invented."}</p></section>
    </EvidenceDisclosure>
    {!fixture && <EvidenceDisclosure id="activity-evidence" title="Trading fees & activity" summary="Sampled transactions; organic activity unverified"><TradingActivity address={c.address} /></EvidenceDisclosure>}
    <EvidenceDisclosure id="holder-evidence" title="Holder concentration evidence" summary={c.holders ? `${c.holders.holder_count} saved owners · ${c.holders.status} inventory` : "Inventory pending"}><HolderPanel candidate={c} /></EvidenceDisclosure>
    {!fixture && <HolderHistory key={`holder-history-${c.address}`} address={c.address} />}
    <EvidenceDisclosure id="wallet-evidence" title="Wallet & funding evidence" summary={c.wallet_analysis?.status === "signals_detected" ? "Connections to review" : c.wallet_analysis?.status === "no_signal_in_sample" ? "No supported signal in sample · coverage limits apply" : "Wallet checks unavailable"}><WalletAnalysisPanel analysis={c.wallet_analysis} /></EvidenceDisclosure>
    <EvidenceDisclosure id="account-evidence" title="Onchain permissions & reserves">
    <section className="tenx-panel"><h2>Onchain risk checks</h2><dl><dt>Mint authority</dt><dd>{c.risk.mint_authority}</dd><dt>Freeze authority</dt><dd>{c.risk.freeze_authority}</dd><dt>Pool reserves</dt><dd>{c.risk.pool_reserves_verified ? "Verified initialized + nonzero" : "Unverified"}</dd><dt>Finalized account slot</dt><dd>{c.risk.context_slot?.toLocaleString() ?? "Unavailable"}</dd></dl><p>Observed {time(c.risk.observed_at)}</p>{!fixture && c.risk.payload_hash && <a href={`/api/10x/account-evidence/${c.risk.payload_hash}`} target="_blank" rel="noopener noreferrer">Inspect saved account evidence ↗</a>}</section>
    </EvidenceDisclosure>
  </>;
}
function HolderPanel({ candidate: c }: { candidate: AssessedCandidate }) {
  const h = c.holders, percent = (n: number | null) => n === null ? "Unknown" : `${n.toFixed(2)}%`;
  return <section className="tenx-panel"><div className="tenx-row"><h2>Holder concentration</h2><span className={`tenx-badge tenx-badge--${h?.status ?? "unverified"}`}>Inventory {h?.status ?? "unverified"}</span></div>
    {h ? <><dl><dt>Positive-balance owners</dt><dd>{h.holder_count.toLocaleString()}{h.status === "partial" ? " (lower bound)" : ""}</dd><dt>Largest owner / total supply</dt><dd>{percent(h.top1_pct)}</dd><dt>Top ten owners / supply</dt><dd>{percent(h.top10_pct)}</dd><dt>Creation user / supply</dt><dd>{percent(h.creator_pct)}</dd><dt>Canonical pool vault / supply</dt><dd>{percent(h.pool_pct)}</dd><dt>Account type & size</dt><dd>{h.layout_certified ? "Certified" : "Legacy evidence; cannot pass"}</dd><dt>Finalized inventory slot</dt><dd>{h.context_slot?.toLocaleString() ?? "Unavailable"}</dd></dl>
      <p>Observed {time(h.observed_at)}. Owners are aggregated across token accounts. Only the exact canonical pool vault is exempt from holder concentration. Shares use total minted supply.</p>
      <p>Supply reconciliation: {h.inventoried_raw} / {h.supply_raw} raw units across {h.account_count} accounts.</p>
      {h.payload_hash && c.mode === "live" && <a href={`/api/10x/holder-evidence/${h.payload_hash}`} target="_blank" rel="noopener noreferrer">Replayable holder evidence ↗</a>}
      <details><summary>Largest owners and classification gaps</summary><div className="tenx-table-scroll"><table><thead><tr><th>Owner</th><th>Supply</th><th>Role</th></tr></thead><tbody>{h.owners.map(o => <tr key={`${o.role}:${o.owner}`}><td className="tenx-address">{o.owner}</td><td>{percent(o.supply_pct)}</td><td>{o.role.replaceAll("_", " ")}</td></tr>)}</tbody></table></div><ul>{h.gaps.map(g => <li key={g}>{readableReason(g)}</li>)}</ul></details>
    </> : <p>No reconciled owner inventory yet. This token cannot pass the holder gate.</p>}
    <p>Separate addresses may share a controller. Account owners are not a verified beneficial-owner or Sybil count. LP lock status remains unknown. Inspect the activity panel for sampled fee evidence and the wallet panel for trading and funding evidence.</p>
  </section>;
}
function TradingActivity({address}:{address:string}) {
  const url=`/api/10x/activity/solana/${encodeURIComponent(address)}`, {data,error}=useRemote(signal=>getJson(url,ActivityResponse,signal),url), a=data?.data;
  const sol=feeSol;
  return <section className="tenx-panel" id="trading-activity"><h2>Fees & price behaviour</h2><p>Paid fees and price changes help describe trading. Organic activity and reported-volume authenticity remain unverified.</p>
    {error && <p role="alert">Activity evidence could not refresh. {a?"The last observation remains visible.":"Check Data status."}</p>}
    {a ? <><dl><dt>Network fees in verified swap transactions</dt><dd>{sol(a.fees.network_fee_lamports_raw)}</dd><dt>Sampled swap transactions / trades</dt><dd>{a.fees.transactions} / {a.fees.trades}</dd><dt>Distinct fee payers</dt><dd>{a.fees.distinct_payers}</dd><dt>Largest payer / transactions</dt><dd>{a.fees.largest_payer_transaction_pct===null?"Unavailable":`${a.fees.largest_payer_transaction_pct.toFixed(1)}%`}</dd><dt>Sampled buyers / sellers</dt><dd>{a.wallets?`${a.wallets.buyers} / ${a.wallets.sellers}`:"Unavailable"}</dd><dt>Sampled round-trip wallets</dt><dd>{a.wallets?.round_trips??"Unavailable"}</dd><dt>Buyers with a shared funder</dt><dd>{a.wallets?.shared_funder_buyers??"Unavailable"}</dd><dt>Saved positive price observations · 24h</dt><dd>{a.prices.samples}</dd><dt>Up / down / unchanged steps</dt><dd>{a.prices.upward_steps} / {a.prices.downward_steps} / {a.prices.unchanged_steps}</dd><dt>Largest comparable price step</dt><dd>{a.prices.largest_step_pct===null?"Unavailable":`${a.prices.largest_step_pct.toFixed(2)}%`}</dd><dt>Continuous sampled return</dt><dd>{a.prices.continuous_return_pct===null?"Unavailable":`${a.prices.continuous_return_pct.toFixed(2)}%`}</dd></dl>
      <p>Wallet sample: {time(a.wallet_observed_at)}. Latest price observation: {time(a.prices.last_at)}. Prices are saved provider observations. Missing values, duplicate times, source changes and gaps over 30 minutes break comparisons.</p>
      <TradingFeesPanel fees={a.trading_fees}/>
      <p>Network fees count each successful verified swap transaction once. The whole transaction can contain other actions. Fee-paying activity can include bots or connected wallets. Shared fee payers and separate wallets can have several explanations. These diagnostics do not change eligibility.</p>
      <details><summary>Evidence & coverage gaps</summary><ul>{a.gaps.map(g=><li key={g}>{readableReason(g)}</li>)}</ul><a href={url} target="_blank" rel="noopener noreferrer">Inspect cached activity evidence ↗</a>{a.wallet_evidence_hash && <p><a href={`/api/10x/wallet-evidence/${a.wallet_evidence_hash}`} target="_blank" rel="noopener noreferrer">Inspect underlying transaction sample ↗</a></p>}</details>
    </> : !error && <p role="status">Reading saved activity observations…</p>}
  </section>;
}
function ResearchView() {
  const { data, error } = useRemote(signal => getJson("/api/10x/research/reviews", ReviewsResponse, signal), "reviews");
  const signals = useRemote(signal => getJson("/api/10x/research/signals",SignalsResponse,signal),"signals");
  const [scoreModel,setScoreModel]=useState<"discovery-score-v1"|"discovery-score-v2"|"discovery-score-v3"|"discovery-score-v4">("discovery-score-v4");
  const scores=useRemote(signal=>getJson(`/api/10x/research/scores?model=${scoreModel}`,ScoreResearchResponse,signal),`score-research:${scoreModel}`);
  const followup=useRemote(signal=>getJson("/api/10x/research/scores/followup",ScoreFollowupResponse,signal),"score-followup");
  return <><header className="tenx-heading"><p className="tenx-eyebrow">RESEARCH / DAILY REVIEW</p><h1>Learn from yesterday.</h1><p>Frozen selection-time metrics, later outcomes, and testable filter proposals. Missing evidence remains visible.</p></header>
    <aside className="tenx-notice">Reviews run automatically on the local timer, using Australia/Sydney calendar days. Recommendations are tracked separately from observed tokens. Proposed rules do not change the active policy.</aside>
    <ScoreResearch data={scores.data?.data?.model===scoreModel?scores.data.data:null} error={scores.error} model={scoreModel} onModelChange={setScoreModel} collection={<ScoreFollowup data={followup.data?.data??null} error={followup.error}/>} />
    <SignalResearch data={signals.data?.data ?? null} error={signals.error} />
    {data && <section className="tenx-panel"><h2>Collecting today · {data.data.collection.day}</h2><p>{data.data.collection.tokens} observed tokens · {data.data.collection.recommended} recommended selections. First observations and first eligible recommendations are retained separately. {data.data.collection.wallet_samples} usable wallet-sample baselines are frozen for later outcome review.</p><p>Last snapshot: {time(data.data.collection.last_snapshot_at)}. Each 24-hour outcome remains pending until its observation window matures and an acceptable endpoint is available.</p></section>}
    {error && <p role="alert">{error}</p>}{data?.data.reports.map(report => <section className="tenx-panel" key={report.input_hash}><div className="tenx-row"><h2>{report.day}</h2><span>{report.counts.measured} measured / {report.counts.observed} tracked</span></div>
      <dl><dt>Recommended at selection</dt><dd>{report.counts.recommended}</dd><dt>24h windows pending</dt><dd>{report.counts.pending}</dd><dt>Insufficient outcome data</dt><dd>{report.counts.insufficient_data}</dd><dt>Severe loss signals</dt><dd>{report.counts.severe_loss_signals}</dd></dl>
      {!report.counts.observed && <p>No selection-time snapshots were captured for this day. The review loop starts collecting now; no past selections have been invented.</p>}
      <h3>Filter improvement proposals</h3>{report.proposals.length ? report.proposals.map((p, i) => <p key={i}>{p.feature}: {p.direction} {p.threshold}. Holdout loss precision {(p.validation_loss_precision * 100).toFixed(0)}% across {p.validation_flagged} flagged outcomes; {p.validation_nonloss_excluded} non-loss outcomes would be excluded. Research proposal; inactive.</p>) : <p>No supported rule changes yet. Proposals require at least 40 measured outcomes, adequate feature coverage and a chronological holdout.</p>}
      {!!report.wallet_watch.length && <details><summary>Wallet associations to investigate ({report.wallet_watch.length})</summary>{report.wallet_watch.map(w => <p key={w.wallet} className="tenx-address">{w.wallet}: {w.severe_loss_associations} distinct severe-loss associations as {w.role}. This is an association to review, not a fraud finding or automatic ban.</p>)}</details>}
      {!!report.outcomes.length && <details><summary>Outcome ledger and frozen features</summary><div className="tenx-table-scroll"><table><thead><tr><th>Token</th><th>Cohort</th><th>24h return</th><th>Liquidity change</th><th>Result</th></tr></thead><tbody>{report.outcomes.map(o => <tr key={o.address}><td><a href={`/token/solana/${o.address}`}>{o.symbol}</a><details><summary>Inputs</summary><pre className="tenx-result">{JSON.stringify({ cohort_kind: o.cohort_kind, selected_at: o.selected_at, input_hash: o.input_hash, features: o.features, gaps: o.gaps }, null, 2)}</pre></details></td><td>{o.recommended ? "Recommended" : "Observed"}</td><td>{o.return_24h_pct === null ? "Unavailable" : `${o.return_24h_pct.toFixed(2)}%`}</td><td>{o.liquidity_change_pct === null ? "Unavailable" : `${o.liquidity_change_pct.toFixed(2)}%`}</td><td>{o.status === "measured" ? readableReason(o.outcome) : readableReason(o.status)}</td></tr>)}</tbody></table></div></details>}
      <p>Wallet research uses its own first-sample baseline when a token was not recommended. New snapshots include sampled wallet metrics and verified trading roles. Older snapshots retain unknown values. Historical fee-revenue features, actual bundles and lifetime wallet histories remain unknown. Losses and disappearing liquidity are signals to investigate.</p><details><summary>Report provenance</summary><p className="tenx-address">{report.input_hash}</p><p>Generated {time(report.created_at)} · {report.version}</p><ul>{report.gaps.map(g => <li key={g}>{readableReason(g)}</li>)}</ul></details>
    </section>)}{data && !data.data.reports.length && <p className="tenx-empty">The first daily report will appear after the local maintenance tick.</p>}
  </>;
}
function ElectionSummaryPanel({ run }: { run: ElectionSummary }) {
  return <section className="tenx-panel"><div className="tenx-row"><h2>{run.result.outcome === "no_eligible_winner" ? "No eligible winner" : "Simulated discovery winner"}</h2><span>{run.kind === "daily" ? "Daily rehearsal" : "Operator rehearsal"}</span></div>
    <p>Observed {time(run.created_at)} · UTC day {run.day}</p>
    <dl><dt>Observed candidates</dt><dd>{run.result.counts.observed}</dd><dt>Eligible / provisional / excluded</dt><dd>{run.result.counts.eligible} / {run.result.counts.provisional} / {run.result.counts.excluded}</dd><dt>Ranked shortlist</dt><dd>{run.result.counts.shortlisted} / 100 maximum</dd></dl>
    {run.result.winner_address ? <p className="tenx-address">Simulated winner: <a href={`/token/solana/${run.result.winner_address}`}>{run.result.candidates.find(c => c.address === run.result.winner_address)?.symbol} · {run.result.winner_address}</a></p> : <p>No candidate passed every required discovery check at this snapshot. No winner is forced.</p>}
    <a href={`/elections/${run.id}`}>Inspect frozen inputs & replay →</a>
  </section>;
}
function ElectionsView({ id }: { id?: string }) {
  const index = useRemote(signal => getJson("/api/10x/elections", ElectionsResponse, signal), "elections");
  const detail = useRemote(signal => id ? getJson(`/api/10x/elections/${encodeURIComponent(id)}`, ElectionDetailResponse, signal) : Promise.resolve(null), id ?? "no-election-detail");
  const record = detail.data?.data.record, error = id ? detail.error : index.error;
  return <><header className="tenx-heading"><p className="tenx-eyebrow">DISCOVERY / ELECTION REHEARSALS</p><h1>Every selection, inspectable.</h1><p>Frozen local evidence, repeatable ranking, and an explicit no-winner outcome.</p></header>
    <SimulationNotice><p>Discovery rehearsals use the proposed local eligibility policy, then liquidity, creation time and address to break ties. Community purchases do not count as votes yet. A simulated winner cannot trigger a launch.</p></SimulationNotice>
    {index.data?.data.automation.last_error && <p role="alert" className="tenx-notice">Daily rehearsal needs attention: {readableReason(index.data.data.automation.last_error)}. Previous snapshots are retained; the next maintenance tick retries.</p>}
    {error && <p role="alert" className="tenx-notice">{error} {record ? "The previously verified snapshot remains visible." : "No unverified result is shown."}</p>}
    {id ? <><a className="tenx-back" href="/elections">← All rehearsals</a>{record ? <><ElectionSummaryPanel run={record} />
      <section className="tenx-panel"><h2>Replay verified</h2><p>The saved inputs reproduce the saved result. Input, result and record hashes match. This check used zero provider requests.</p><p>Replay checks consistency of retained evidence and rules; it does not certify complete provider coverage or token safety.</p><dl><dt>Rules version</dt><dd>{record.inputs.rules_version}</dd><dt>Policy version</dt><dd>{record.inputs.policy.version}</dd></dl>
        <details><summary>Hashes & frozen policy</summary><p className="tenx-address">Input: {record.input_hash}</p><p className="tenx-address">Result: {record.result_hash}</p><p className="tenx-address">Record: {record.record_hash}</p><pre className="tenx-result">{JSON.stringify(record.inputs.policy, null, 2)}</pre></details>
        <p><a href={`/api/10x/elections/${record.id}`} target="_blank" rel="noopener noreferrer">Open complete snapshot & replay evidence ↗</a></p>
      </section>
      <section className="tenx-panel"><h2>Decisions at observation time</h2><p>All {record.result.counts.observed} retained candidates are shown, including those outside the ranked shortlist. Later refreshes do not change these decisions.</p>{record.result.candidates.map(c => <details key={c.address}><summary>{c.rank ? `#${c.rank} · ` : ""}{c.symbol} · {c.eligibility}</summary><p className="tenx-address"><a href={`/token/solana/${c.address}`}>{c.address}</a></p><dl><dt>Market cap</dt><dd>{money(c.market_cap_usd)}</dd><dt>Liquidity</dt><dd>{money(c.liquidity_usd)}</dd></dl>{c.reasons.length ? <ul>{c.reasons.map(r => <li key={r}>{readableReason(r)}</li>)}</ul> : <p>Passed this snapshot’s discovery checks. Launch certification and community voting remain disabled.</p>}</details>)}</section>
      <section className="tenx-panel"><h2>Scope & gaps</h2><ul>{record.result.gaps.map(g => <li key={g}>{readableReason(g)}</li>)}</ul></section>
    </> : !error && <p role="status">Checking saved election evidence…</p>}</> : <><section className="tenx-panel"><h2>Daily local rehearsal</h2><p>{index.data?.data.schedule ?? "The first local maintenance tick of each UTC day records a discovery rehearsal."} The workstation must be awake. This is a readiness observation, not an election cutoff or a reconstruction of past market conditions.</p><p>Operator rehearsals are available in <a href="/admin/10x">Admin</a>. Recent results appear below; older records remain accessible by their snapshot link.</p></section>{index.data?.data.runs.map(run => <ElectionSummaryPanel key={run.id} run={run} />)}{index.data && !index.data.data.runs.length && <p className="tenx-empty">No rehearsals recorded yet. The next local maintenance tick will create the first snapshot.</p>}</>}
  </>;
}
function StatusView() {
  const { data, error } = useRemote(signal => getJson("/api/10x/system/status", StatusResponse, signal), "status");
  const health=useRemote(signal=>getJson("/api/10x/system/operations",OperationsResponse,signal),"operations");
  const recovery=useRemote(signal=>getJson("/api/10x/discovery/inbox-recovery",InboxRecoveryResponse,signal),"inbox-recovery");
  const mintReviews=useRemote(signal=>getJson("/api/10x/discovery/mint-reviews",MintReviewsResponse,signal),"mint-reviews");
  return <><header className="tenx-heading"><p className="tenx-eyebrow">DATA / OPERATIONS</p><h1>Know what’s fresh.</h1><p>Source coverage, proof gaps and free-service budgets, in plain sight.</p></header>
    <CollectionDetails><DiscoveryDiagnostics /></CollectionDetails>
    <OperationsPanel data={health.data?.data??null} error={health.error} />
    <InboxRecoveryPanel data={recovery.data?.data??null} error={recovery.error} />
    <MintReviewsPanel data={mintReviews.data?.data??null} error={mintReviews.error} />
    {data?.data.inventory && <CandidateInventory inventory={data.data.inventory} />}
    {data?.data.market_batches && <MarketBatchCoverage data={data.data.market_batches} />}
    <SourcePilotPanel data={data?.data.source_pilot ?? null} error={error} />
    {error && <p role="alert" className="tenx-notice">{error}</p>}{data ? <><Freshness data={data} /><section className="tenx-panel"><h2>Local ingestion</h2><dl><dt>State</dt><dd>{data.data.paused ? "Paused" : data.data.running ? "Refreshing" : "Waiting for next tick"}</dd><dt>Last source issue</dt><dd>{data.data.last_error ? readableReason(data.data.last_error) : "None recorded"}</dd><dt>Queued signatures</dt><dd>{data.data.pending_signatures}</dd><dt>Market provider</dt><dd>{data.coverage.market_enabled ? `${marketSource(data.data.market_provider ?? "geckoterminal")} enabled locally` : "Off pending usage review"}</dd><dt>Proof adapter</dt><dd className="tenx-address">{data.data.adapter_version}</dd></dl></section>
      <section className="tenx-panel"><h2>Daily source budgets · UTC</h2>{(["rpc", "market"] as const).map(provider => { const used = data.data.usage.find(u => u.provider === provider)?.used ?? 0, limit = data.data.daily_limits[provider]; return <div className="tenx-budget" key={provider}><div className="tenx-row"><strong>{provider === "rpc" ? "Solana public RPC" : "Market enrichment"}</strong><span>{used} / {limit}</span></div><meter min={0} max={limit} value={used} aria-label={`${provider} daily requests`} /></div>; })}<p>Budgets pause work when exhausted. No paid upgrade or onchain transaction is enabled.</p></section>
    <section className="tenx-panel"><h2>Local automation</h2><dl><dt>Timer heartbeat</dt><dd>{time(data.data.automation?.heartbeat_at ?? null)}</dd><dt>Next paced source refresh</dt><dd>{time(data.data.automation?.next_refresh_at ?? null)}</dd><dt>Last daily review check</dt><dd>{time(data.data.automation?.reviewed_at ?? null)}</dd></dl><p>Source requests are paced across the remaining free daily budget. Daily reports catch up hourly, even when source work is paused or exhausted. The workstation must be awake.</p><a href="/research">Review outcomes & proposals →</a></section>
    <section className="tenx-panel"><h2>Token artwork</h2><p>Creation-linked metadata is cached automatically: up to three tokens per minute, at most 120 metadata requests per UTC day inside the shared market budget. Identical content-addressed metadata is reused. Saved creation evidence supplies the link; no extra Solana RPC calls are needed.</p><dl><dt>Metadata requests today</dt><dd>{data.data.usage.find(u => u.provider === "artwork")?.used ?? 0} / 120</dd><dt>Next artwork tick</dt><dd>{time(data.data.artwork_automation?.next_refresh_at ?? null)}</dd><dt>Last artwork issue</dt><dd>{data.data.artwork_automation?.last_error ?? "None recorded"}</dd></dl></section>
    <section className="tenx-panel"><h2>Election rehearsals</h2><p>One discovery snapshot at the first maintenance tick each UTC day; no backfill of missed days. No provider requests, community votes or launches.</p><dl><dt>Last daily snapshot</dt><dd>{time(data.data.election_automation?.last_snapshot_at ?? null)}</dd><dt>Last rehearsal issue</dt><dd>{readableReason(data.data.election_automation?.last_error ?? "none_recorded")}</dd></dl><a href="/elections">Inspect frozen selections & replay →</a></section>
    <section className="tenx-panel"><h2>Focused contender checks</h2><dl><dt>Risk refresh targets</dt><dd>{data.data.quality_automation?.targets ?? 0} / 10</dd><dt>Quality RPC use / allowance</dt><dd>{data.data.quality_automation?.daily_used ?? 0} / {data.data.quality_automation?.daily_limit ?? 0} (inside the global cap)</dd><dt>Last refresh</dt><dd>{time(data.data.quality_automation?.last_success ?? null)}</dd><dt>Next due refresh</dt><dd>{time(data.data.quality_automation?.next_refresh_at ?? null)}</dd><dt>Source issue</dt><dd>{readableReason(data.data.quality_automation?.last_error ?? "none_recorded")}</dd></dl><p>Current contenders share a batched account read. Holder inventories rotate before expiry; missing inventories are collected first. Broad discovery leaves room for these checks and wallet analysis inside the same free daily allowance.</p></section>
    <section className="tenx-panel"><h2>Wallet analysis automation</h2><dl><dt>Enabled locally</dt><dd>{data.data.wallet_automation?.enabled ? "Yes" : "No"}</dd><dt>Wallet RPC usage / allowance</dt><dd>{data.data.wallet_automation?.daily_used ?? 0} / {data.data.wallet_automation?.daily_limit ?? 0} (within global RPC cap)</dd><dt>Last wallet snapshot</dt><dd>{time(data.data.wallet_automation?.last_success ?? null)}</dd><dt>Next wallet tick</dt><dd>{time(data.data.wallet_automation?.next_refresh_at ?? null)}</dd><dt>Last wallet source issue</dt><dd>{readableReason(data.data.wallet_automation?.last_error ?? "none_recorded")}</dd></dl><p>One stored token per paced tick. At most 18 RPC requests per tick. Funding scans resume for up to eight wallets, with up to three pages of 50 references and 12 decoded transactions per wallet. Three wallets advance per tick; gaps and hard limits stay visible. Actual bundles and lifetime wallet history remain unknown.</p></section>
    {data.data.backing_index_automation&&<section className="tenx-panel"><h2>Backing history allowance</h2><dl><dt>Enabled locally</dt><dd>{data.data.backing_index_automation.enabled?"Yes":"No"}</dd><dt>Reserved calls / daily subset</dt><dd>{data.data.backing_index_automation.daily_used} / {data.data.backing_index_automation.daily_limit}</dd></dl><p>This allowance sits inside the wallet and global RPC caps. New rehearsals scan at most 16 frozen signed wallets after cutoff, with four RPC calls per tick and 64 per window. Missing history holds projections. Empty membership uses no calls. Reservations can include attempts stopped by another quota.</p><a href="/backing">Inspect wallet-window coverage →</a></section>}
    <section className="tenx-panel"><h2>Coverage limits</h2><ul><li>Recent Pump migration-authority activity only; scans are bounded and may miss transactions.</li><li>Creation search inspects at most 3,000 bonding-curve signatures and three historical transactions.</li><li>WSOL-quoted canonical PumpSwap pools only.</li><li>Holder analysis requires a supply-reconciled owner inventory. Partial inventories cannot pass.</li><li>Provider market cap can be unavailable even when FDV exists.</li></ul></section>
    </> : !error && <p role="status">Loading source status…</p>}</>;
}
function AdminView() {
  const [token, setToken] = useState(""), [data, setData] = useState<Record<string, unknown> | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [electionRequestId, setElectionRequestId] = useState(() => crypto.randomUUID());
  const [reviewMint,setReviewMint]=useState("");
  async function action(path: string, body?: unknown) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/10x/admin/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? "Enter the local operator token to continue." : `Request failed (${response.status}).`);
      if (value && typeof value === "object") setData(value as Record<string, unknown>);
      if (path === "dry-run") setElectionRequestId(crypto.randomUUID());
      setMessage(path==="mint-reviews"?value&&typeof value==="object"&&"duplicate" in value&&value.duplicate===true?"This mint already has a review. Inspect its saved progress in Data status; resubmitting does not restart the scan.":"Mint review saved. The paced collector will check it within existing source limits; no eligibility is granted.":"Local operation completed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); }
    finally { setBusy(false); }
  }
  return <><header className="tenx-heading"><p className="tenx-eyebrow">LOCAL / ADMIN</p><h1>Discovery controls.</h1><p>Read jobs, pause ingestion and run a simulated election. No token launch or spending controls exist here.</p></header>
    <section className="tenx-panel"><label className="tenx-admin-token">Local operator token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="Required for admin requests" /></label><p>The token stays in this page’s memory. It is not saved in browser storage.</p>
      <div className="tenx-admin-actions"><button disabled={busy || !token} className="tenx-button" onClick={() => void action("jobs")}>Inspect jobs</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("refresh", { reason: "Operator requested local refresh" })}>Refresh now</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("pause", { paused: true, reason: "Operator paused local discovery" })}>Pause</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("pause", { paused: false, reason: "Operator resumed local discovery" })}>Resume</button><button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("dry-run", { reason: "Operator requested election dry run", request_id: electionRequestId })}>Election dry run</button></div>
      <button disabled={busy || !token} className="tenx-button tenx-button--quiet" onClick={() => void action("wallet-refresh", { reason: "Operator requested local wallet sample" })}>Refresh wallet analysis</button>
      <form className="tenx-content-form" onSubmit={e=>{e.preventDefault();if(!busy&&token)void action("mint-reviews",{address:reviewMint.trim(),reason:"Operator requested exact-mint discovery review"});}}><label>Solana mint to review<input value={reviewMint} onChange={e=>setReviewMint(e.target.value)} required maxLength={44} pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" autoComplete="off" spellCheck={false}/></label><button className="tenx-button tenx-button--quiet" disabled={busy||!token||!reviewMint.trim()}>Queue token review</button><p>This saves a request for the paced collector. It does not refresh immediately or bypass evidence gates. <a href="/status#mint-reviews">Inspect requested reviews →</a></p></form>
      <p role="status" aria-live="polite">{busy ? "Working locally…" : message}</p></section>{data && <section className="tenx-panel"><h2>Operation result</h2>{typeof data.id === "string" && data.mode === "dry_run" && <p><a href={`/elections/${data.id}`}>Inspect this rehearsal & verified replay →</a></p>}<pre className="tenx-result">{JSON.stringify(data, null, 2)}</pre></section>}<PolicyLab token={token} /><BackingLab token={token} /><AttentionRewardLab token={token} /><Suspense fallback={<p role="status">Loading curve lab…</p>}><LazyLaunchCurveAdmin token={token}/></Suspense><Suspense fallback={<p role="status">Loading recovery lab…</p>}><LazyLaunchRecoveryAdmin token={token}/></Suspense><ContentModerationLab token={token} /></>;
}
export default function DiscoveryPage({ path }: { path: string }) {
  const clean = path.replace(/\/+$/, "");
  const match = clean.match(/^\/token\/solana\/([^/]+)$/);
  const election = clean.match(/^\/elections(?:\/([^/]+))?$/);
  return <main className="tenx-discovery" tabIndex={-1} onClick={navigateDiscovery}><DiscoveryNav key={clean} path={clean} />{match ? <CandidateDetail key={match[1]} address={match[1]!} /> : election ? <ElectionsView key={election[1] ?? "index"} id={election[1]} /> : clean === "/status" ? <StatusView /> : clean === "/transparency" ? <PolicyView /> : clean === "/research" ? <ResearchView /> : clean === "/backing" ? <BackingPage /> : clean === "/attention" || clean === "/submit" || clean.startsWith("/campaign/") ? <AttentionContentPage key={clean + window.location.search} campaignId={clean.startsWith("/campaign/") ? clean.split("/")[2] : undefined} submitOnly={clean === "/submit"} /> : clean === "/launch-recovery" ? <Suspense fallback={<p role="status">Loading recovery lab…</p>}><LazyLaunchRecovery /></Suspense> : clean === "/launch-lab" ? <Suspense fallback={<p role="status">Loading curve lab…</p>}><LazyLaunchCurve /></Suspense> : clean === "/rewards" ? <AttentionRewardsPage /> : clean === "/wallets" ? <SolanaIdentity /> : clean === "/admin/10x" ? <AdminView /> : <Discover />}</main>;
}
