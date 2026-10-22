import { useEffect, useId, useRef, useState } from "react";
import { AttentionQueue, type AttentionQueueResult } from "../../../discovery/src/attention-queue-model";
import { getJson } from "./client";
import { TokenImage } from "./TokenArtwork";
import { attentionCandlesFresh, type AttentionCandleResult } from "../../../discovery/src/attention-candle-model";
import { attentionTradersFresh, type AttentionTraderResult } from "../../../discovery/src/attention-trader-model";
import { AttentionReviewWorksheet } from "./AttentionReviewWorksheet";
import { AttentionActivityDetails } from "./AttentionActivityDetails";
import { AttentionHolderParticipation } from "./AttentionHolderParticipation";
import { captureAttentionReview, type ReviewContext } from "./attention-review-store";
import "./attention-queue.css";
import "./attention-detail.css";

const money = (v: number | null) => v === null ? "Unknown" : new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(v);
const sourceName = {gmgn:"GMGN",geckoterminal:"GeckoTerminal",dexscreener:"DEX Screener"};
export function AttentionCandleDetails({chain,review,asOf}:{chain:string;review:AttentionCandleResult|undefined;asOf:string}) {
  if(chain!=="solana")return <p>Candle review is not connected for this chain.</p>;
  if(!review)return <p>Candle review pending · one-token hourly pilot.</p>;
  const fresh=attentionCandlesFresh(review,new Date(asOf)),activity=review.activity;
  return <details><summary>GMGN candles · {review.candle_count}/60 minutes · {!fresh?"stale":!review.complete_window?"incomplete":activity.review_reasons.length?"pattern warnings":"sample reviewed"}</summary>
    <p>{new Date(review.window_start).toLocaleString()} – {new Date(review.window_end).toLocaleString()}. Saved {new Date(review.received_at).toLocaleString()}.</p>
    <p>{review.complete_window?"Complete requested hour":"Missing minutes; no gaps filled"}. {activity.adjacent_pairs} adjacent pairs; longest rising run {activity.longest_rising_run_pairs} pairs; {activity.adjacent_doubling_or_halving} close doublings/halvings; {activity.zero_reported_flow_moving_candles} moving candles with both reported flow fields zero.</p>
    {activity.review_reasons.length?<ul>{activity.review_reasons.map(r=><li key={r}>{r.replaceAll("_"," ")}</li>)}</ul>:<p>No configured pattern warnings in this sample.</p>}
    <p>Volume units: {review.units.state==="price_consistent"?`price-consistent with ${review.units.usd_field} as USD; not independently verified`:"unverified"}. Request context only; response does not establish mint or pool identity. These uncalibrated patterns do not establish wash trading, organic volume or safety.</p>
  </details>;
}
export function AttentionTraderDetails({chain,review,asOf}:{chain:string;review:AttentionTraderResult|undefined;asOf:string}) {
  if(chain!=="solana")return <p>Trader review is not connected for this chain.</p>;
  if(!review)return <p>Trader review pending · one-token hourly pilot.</p>;
  const sample=review.sample,fresh=attentionTradersFresh(review,new Date(asOf)),pct=(v:number|null)=>v===null?"Unknown":`${v.toFixed(1)}%`;
  return <details><summary>GMGN traders · {sample.returned_rows}/100 returned · {fresh?"ranked sample saved":"stale"}</summary>
    <p>Saved {new Date(review.received_at).toLocaleString()}. Top 100 by reported buy volume, no tag filter. Reporting period and population coverage unknown.</p>
    <p>{sample.regular_wallet_rows} regular wallet rows; {sample.excluded_non_wallet_rows} excluded non-wallet rows; {sample.unknown_address_type_rows} unknown address types. {sample.limit_reached?"Result limit reached; additional traders may be missing.":"Fewer than 100 returned; this does not establish a complete population."}</p>
    <p>{sample.complete_volume_rows} wallet rows with both flow fields; {sample.missing_volume_rows} missing one or both. Sample buy flow {money(sample.reported_buy_volume_usd)}; sell flow {money(sample.reported_sell_volume_usd)}. {sample.two_sided_wallet_rows} wallet rows with positive flow on both sides.</p>
    <p>Within complete wallet flow only: largest wallet {pct(sample.largest_wallet_flow_share_pct)}; top five {pct(sample.top_five_wallet_flow_share_pct)}. Ranked selection biases these shares.</p>
    <p>Request context only; response does not establish mint or pool identity. These are reported sample aggregates, not 24h or organic volume, holder counts or growth. Two-sided trading does not establish wash trading or safety. Scores and evidence gates are unchanged.</p>
  </details>;
}
export function AttentionTokenDetails({context,onClose,onReview,reviewBusy=false,newerReport=false,outsideView=false,onUpdate}:{context:ReviewContext;onClose:()=>void;onReview?:(context:ReviewContext)=>void;reviewBusy?:boolean;newerReport?:boolean;outsideView?:boolean;onUpdate?:()=>void}) {
  const title=useId(),heading=useRef<HTMLHeadingElement>(null),r=context.token;
  useEffect(()=>{heading.current?.focus();},[context]);
  return <section className="tenx-attention-detail" aria-labelledby={title}>
    <div className="tenx-attention-detail-header"><h3 id={title} ref={heading} tabIndex={-1}>Saved evidence · {r.symbol??"Unknown token"} · {r.chain}</h3><button className="tenx-button tenx-button--quiet" onClick={onClose}>Close evidence</button></div>
    <p className="tenx-address">{r.address}</p>
    <p>Snapshot saved at {new Date(context.as_of).toLocaleString()}. This view stays fixed while you inspect it; refreshing lists does not replace this evidence.</p>
    {outsideView&&<p role="status">This token is outside the current shortlist filters.</p>}
    {newerReport&&<p role="status">A different saved list is available. {onUpdate?<button className="tenx-button tenx-button--quiet" onClick={onUpdate}>Load latest saved evidence</button>:"This token is absent from that saved list; the inspected snapshot remains here."}</p>}
    <h4>Reported market activity</h4><dl className="tenx-attention-detail-metrics"><div><dt>24h volume</dt><dd>{money(r.volume_24h_usd)}</dd></div><div><dt>1h volume</dt><dd>{money(r.volume_1h_usd)}</dd></div><div><dt>Liquidity</dt><dd>{money(r.liquidity_usd)}</dd></div><div><dt>Market cap</dt><dd>{money(r.market_cap_usd)}</dd></div></dl>
    <p>Market source: {r.market_source?sourceName[r.market_source]:"Unknown"}{r.recent_volume_source&&r.recent_volume_source!==r.market_source?` · 1h volume: ${sourceName[r.recent_volume_source]}`:""}. Reported volume is not verified organic activity.</p>
    <h4>Attention sources and timing</h4><p>{r.attention_families} fresh attention provider{r.attention_families===1?"":"s"}; observed in {r.observed_hours} sampled hour{r.observed_hours===1?"":"s"}. Multiple windows from one provider count once.</p><ul>{r.sources.map(s=><li key={`${s.provider}:${s.window}`}>{sourceName[s.provider]} · {s.window}{s.rank!==null?` · #${s.rank}`:""}{s.previous_rank!==null?` · previous observed rank #${s.previous_rank}`:""}{s.search_interest!==null?` · ${s.search_interest.toLocaleString()} reported search/visit heat`:""} · {new Date(s.received_at).toLocaleString()}{!s.fresh?" · stale":""}</li>)}</ul>
    <h4>Quality checks</h4><p>{r.checks==="adverse"?"Adverse flags":"Quality review needed"} · {r.market_crosschecked?"Recent DEX market observation saved":"Market cross-check needed"}. Provider labels and missing checks do not prove safety.</p><ul>{r.reasons.map(reason=><li key={reason}>{reason.replaceAll("_"," ")}</li>)}</ul>
    <h4>Candles and participation</h4><AttentionCandleDetails chain={r.chain} review={context.candle_review??undefined} asOf={context.as_of}/><AttentionTraderDetails chain={r.chain} review={context.trader_review} asOf={context.as_of}/><AttentionActivityDetails chain={r.chain} issue={context.activity_issue} review={context.activity_review} asOf={context.as_of}/><AttentionHolderParticipation chain={r.chain} address={r.address} cutoff={context.as_of}/>
    {(context.history_truncated||context.gaps.length>0)&&<details><summary>Snapshot coverage gaps</summary>{context.history_truncated&&<p>Saved history reached its read bound. Persistence is based on the observed sample.</p>}<ul>{context.gaps.map(g=><li key={g}>{g.replaceAll("_"," ")}</li>)}</ul></details>}
    <p>Search interest and reported trading do not establish organic participation or safety. Scores and launch checks are unchanged.</p>
    {onReview&&<button disabled={reviewBusy} className="tenx-button" onClick={()=>onReview(structuredClone(context))}>Review this snapshot</button>}
  </section>;
}
export function AttentionQueueValues({report,onReview,reviewBusy=false}:{report:AttentionQueueResult;onReview?:(context:ReviewContext)=>void;reviewBusy?:boolean}) {
  const [chain,setChain]=useState("all"),[showAdverse,setShowAdverse]=useState(false),[matchesOnly,setMatchesOnly]=useState(false);
  const [selected,setSelected]=useState<ReviewContext|null>(null),opener=useRef<HTMLButtonElement|null>(null),chainControl=useRef<HTMLSelectElement>(null),detailId=useId();
  const rows=report.rows.filter(r=>(chain==="all"||r.chain===chain)&&(showAdverse||r.checks!=="adverse")&&(!matchesOnly||r.attention_families>=2)).slice(0,10);
  const isSelected=(r:AttentionQueueResult["rows"][number])=>selected?.token.address===r.address&&selected.token.chain===r.chain;
  const close=()=>{setSelected(null);if(opener.current?.isConnected)opener.current.focus();else chainControl.current?.focus();};
  return <><p>Saved view at {new Date(report.as_of).toLocaleString()}. {report.observed_tokens} observed tokens across {report.snapshot_count} saved lists. Token age has no maximum here.</p>
    <div className="tenx-attention-controls"><label>Chain <select ref={chainControl} value={chain} onChange={e=>setChain(e.target.value)}><option value="all">All observed chains</option>{["solana","base","bsc","robinhood"].map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label><input type="checkbox" checked={matchesOnly} onChange={e=>setMatchesOnly(e.target.checked)}/> Appears across attention providers</label>
      <label><input type="checkbox" checked={showAdverse} onChange={e=>setShowAdverse(e.target.checked)}/> Include adverse security flags</label></div>
    {!rows.length?<p role="status">No saved attention observations match this view. An empty or unavailable feed does not establish an absence of good tokens.</p>:<div className="tenx-table-scroll"><table className="tenx-attention-table"><thead><tr><th>Token</th><th>Attention</th><th>Reported trading</th><th>Review</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.chain}:${r.address}`}>
      <td><div className="tenx-attention-token"><TokenImage url={r.image_url} name={r.name??r.symbol??"Unknown token"} symbol={r.symbol??"?"}/><div><strong>{r.symbol??"Unknown symbol"}</strong><p>{r.name} · {r.chain}</p></div></div><details><summary>{r.address.slice(0,6)}…{r.address.slice(-4)} · contract</summary><p className="tenx-address">{r.address}</p></details>{r.chain==="solana"?<a href={`/token/solana/${r.address}`}>Inspect saved token checks →</a>:<a href={`https://gmgn.ai/${r.chain}/token/${r.address}`} target="_blank" rel="noopener noreferrer">Open terminal ↗</a>}</td>
      <td>{r.attention_families} fresh attention provider{r.attention_families===1?"":"s"}<p>Observed in {r.observed_hours} sampled hour{r.observed_hours===1?"":"s"}</p><p>{[...new Set(r.sources.map(s=>sourceName[s.provider]))].join(" · ")}</p></td>
      <td><p>24h volume {money(r.volume_24h_usd)}</p><p>1h volume {money(r.volume_1h_usd)}</p><p>Liquidity {money(r.liquidity_usd)}</p><p>Market cap {money(r.market_cap_usd)}</p><small>{r.market_source?sourceName[r.market_source]:"Market source unknown"}{r.recent_volume_source&&r.recent_volume_source!==r.market_source?` · 1h: ${sourceName[r.recent_volume_source]}`:""}</small></td>
      <td><strong>{r.checks==="adverse"?"Adverse flags":"Quality review needed"}</strong><p>{r.market_crosschecked?"Recent DEX market observation saved":"Market cross-check needed"}</p>{report.activity_issues.some(a=>a.chain===r.chain&&a.address===r.address)&&<p>Wallet-event attempt held</p>}<button className="tenx-button tenx-button--quiet" aria-label={`View evidence for ${r.symbol??"token"} on ${r.chain} ${r.address}`} aria-controls={detailId} aria-expanded={isSelected(r)} onClick={event=>{opener.current=event.currentTarget;setSelected(captureAttentionReview(report,r.address,r.chain));}}>View evidence</button></td>
    </tr>)}</tbody></table></div>}
    <div id={detailId}>{selected&&<AttentionTokenDetails context={selected} onClose={close} onReview={onReview} reviewBusy={reviewBusy} outsideView={!rows.some(isSelected)} newerReport={selected.as_of!==report.as_of} onUpdate={report.rows.some(isSelected)?()=>setSelected(captureAttentionReview(report,selected.token.address,selected.token.chain)):undefined}/>}</div>
    <p>Order prioritizes matches across fresh attention providers, then GMGN 24h search heat and source position. Multiple windows or pools from one provider count once. Search interest and reported volume do not establish organic participation or safety. Launch selection remains unavailable.</p>
    {(report.history_truncated||report.gaps.length>0)&&<details><summary>Coverage gaps</summary>{report.history_truncated&&<p>Saved history or displayed inventory reached its read bound. Persistence is based on the observed sample.</p>}<ul>{report.gaps.map(g=><li key={g}>{g.replaceAll("_"," ")}</li>)}</ul></details>}</>;
}
export function AttentionQueuePanel() {
  const [report,setReport]=useState<AttentionQueueResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [reviewContext,setReviewContext]=useState<ReviewContext|null>(null),[reviewBusy,setReviewBusy]=useState(false);
  const active=useRef<AbortController|null>(null),mounted=useRef(true);
  const load=async()=>{if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setError("");
    try{const value=await getJson("/api/10x/discovery/attention",AttentionQueue,AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]));if(mounted.current&&!controller.signal.aborted)setReport(value);}
    catch{if(mounted.current&&!controller.signal.aborted)setError("Attention lists could not load. Saved observations may be incomplete or stale.");}
    finally{if(active.current===controller){active.current=null;if(mounted.current)setBusy(false);}}};
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;const controller=active.current;active.current=null;controller?.abort();};},[]);
  return <section className="tenx-panel" aria-labelledby="attention-queue-title"><div className="tenx-row"><h2 id="attention-queue-title">Market attention · research queue</h2><button className="tenx-button tenx-button--quiet" disabled={busy} onClick={()=>void load()}>{busy?"Reading saved lists…":"Refresh saved lists"}</button></div>
    <p>Find memes attracting sustained or renewed attention across chains. These observations are separate from action eligibility and the structural grade below.</p>{error&&<p role="alert">{error}</p>}{report?<AttentionQueueValues report={report} onReview={setReviewContext} reviewBusy={reviewBusy}/>:<p role="status">{busy?"Reading saved attention observations…":"No attention observations loaded yet."}</p>}<AttentionReviewWorksheet context={reviewContext} onClose={()=>setReviewContext(null)} onBusyChange={setReviewBusy} loadedReport={report}/></section>;
}
