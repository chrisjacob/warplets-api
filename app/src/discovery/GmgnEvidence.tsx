import { useEffect, useState } from "react";
import { GmgnPublicSummarySchema, type GmgnPublicSummary } from "../../../discovery/src/gmgn-model";
import { getJson } from "./client";

const usd = (value: number | null) => value === null ? "Unknown" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const percent = (value: number | null) => value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
export function GmgnEvidenceValues({ data }: { data: GmgnPublicSummary }) {
  if (!data.observations && !data.candle_coverage) return <p>No saved GMGN observations for this token in the recent cache. Missing data adds no score credit.</p>;
  return <>
    <p>GMGN reports · received {data.received_at ? new Date(data.received_at).toLocaleString() : "at an unknown time"}{data.stale && <strong> · Stale receipt</strong>}. Provider measurement time is unknown.</p>
    <div className="tenx-market-overview"><dl>
      <div><dt>Reported 24h volume</dt><dd>{usd(data.reported_volume_24h_usd)}</dd></div>
      <div><dt>Reported 1h volume</dt><dd>{usd(data.reported_volume_1h_usd)}</dd></div>
      <div><dt>Reported holders</dt><dd>{data.reported_holder_count?.toLocaleString() ?? "Unknown"}</dd></div>
      <div><dt>GMGN wash-trading label</dt><dd>{data.provider_wash_flag === true ? "Flagged by provider" : data.provider_wash_flag === false ? "Not flagged; coverage unknown" : "Unknown"}</dd></div>
      <div><dt>Reported suspected-insider holdings</dt><dd>{percent(data.provider_insider_hold_ratio)}</dd></div>
      <div><dt>Reported bundler volume share</dt><dd>{percent(data.provider_bundler_volume_ratio)}</dd></div>
    </dl></div>
    {data.candle_count !== null && <p>{data.candle_count} saved one-minute candles · {data.candle_window_complete ? "requested window complete" : "requested window incomplete"} · {data.candle_window_volume_usd === null ? data.candle_coverage?.units.state === "price_consistent" ? "Full-window USD turnover withheld while coverage or flow totals are incomplete." : "USD turnover unknown; candle volume units are unverified." : `${usd(data.candle_window_volume_usd)} reported window turnover using price-consistent USD units.`}</p>}
    {data.candle_coverage && <section aria-label="Candle coverage and units">
      <p>{data.candle_coverage.succeeded_parts} / 4 window parts received · {data.candle_coverage.missing_minutes} missing minutes · {data.candle_coverage.overlap_conflicts} conflicting overlap minutes. The last part overlaps forty minutes; matching candles count once.</p>
      <p>{data.candle_coverage.units.state === "price_consistent" ? `Price-consistent units: ${data.candle_coverage.units.usd_field} = USD; ${data.candle_coverage.units.token_field} = token units. Supported by ${data.candle_coverage.units.informative_candles} positive-flow candles.` : "Candle volume units remain unknown: insufficient, ambiguous or inconsistent price evidence."} Both interpretations are tested against USD high/low prices with 1% tolerance; at least twelve informative candles must agree. This is arithmetic corroboration, not independent trade verification or organic-volume proof.</p>
      {data.candle_coverage.receipt_span_ms!==null && data.candle_coverage.receipt_span_ms>300000 && <p>Collection spanned more than five minutes; matched-capture freshness is not established.</p>}
    </section>}
    {data.candle_review && <section aria-label="Candle pattern review">
      <p><strong>{data.candle_review.review_reasons.length ? "Trading pattern needs review" : "Candle pattern measurements"}</strong> · {data.candle_review.window_start} to {data.candle_review.window_end} · received {new Date(data.candle_review.received_at).toLocaleString()}.</p>
      <ul>
        <li>{data.candle_review.longest_rising_run_pairs} consecutive rising one-minute closes; {data.candle_review.rising_adjacent_pairs} rising pairs out of {data.candle_review.adjacent_pairs} observed adjacent pairs.</li>
        <li>{data.candle_review.alternating_body_pairs} adjacent candle pairs alternate up/down bodies.</li>
        <li>{data.candle_review.adjacent_doubling_or_halving} adjacent close doublings/halvings; {data.candle_review.zero_reported_flow_moving_candles} moving candles with both reported flow fields explicitly zero.</li>
      </ul>
      <p>Review triggers: an adjacent close doubles/halves, a price moves with both flow fields zero, or twelve consecutive rising closes. These uncalibrated checks describe the observed bars. Missing minutes break runs. Candles alone do not establish wash trading; an absent trigger does not establish clean trading.</p>
    </section>}
    {data.trader_sample && <section aria-label="Ranked trader sample">
      <h3>Ranked trader participation</h3>
      <p>Top {data.trader_sample.returned_rows} returned rows, requested by reported buy volume descending with no tag filter. Received {new Date(data.trader_sample.received_at).toLocaleString()}. {data.trader_sample.limit_reached&&"The 100-row limit was reached."} This is a ranked sample with unknown population coverage.</p>
      <p><strong>Aggregate period unknown; these are not 24h totals.</strong> No exact start/end is supplied. Do not combine these flows with candle or reported daily volume.</p>
      <dl>
        <dt>Regular wallet rows reported by GMGN</dt><dd>{data.trader_sample.regular_wallet_rows}; {data.trader_sample.excluded_non_wallet_rows} exchange/pool rows excluded; {data.trader_sample.unknown_address_type_rows} unknown address types excluded</dd>
        <dt>Rows with both USD flow fields</dt><dd>{data.trader_sample.complete_volume_rows} / {data.trader_sample.regular_wallet_rows}</dd>
        <dt>Reported buy / sell USD in those rows</dt><dd>{usd(data.trader_sample.reported_buy_volume_usd)} / {usd(data.trader_sample.reported_sell_volume_usd)}</dd>
        <dt>Largest / top-five combined-flow share</dt><dd>{data.trader_sample.largest_wallet_flow_share_pct===null?"Unknown":`${data.trader_sample.largest_wallet_flow_share_pct.toFixed(1)}%`} / {data.trader_sample.top_five_wallet_flow_share_pct===null?"Unknown":`${data.trader_sample.top_five_wallet_flow_share_pct.toFixed(1)}%`}</dd>
        <dt>Rows reporting both buys and sells</dt><dd>{data.trader_sample.two_sided_wallet_rows} / {data.trader_sample.complete_volume_rows}; smaller USD legs sum to {usd(data.trader_sample.two_sided_smaller_leg_usd)}</dd>
        <dt>Reported buy / sell transactions</dt><dd>{data.trader_sample.reported_buy_transactions??"Unknown"} / {data.trader_sample.reported_sell_transactions??"Unknown"} across {data.trader_sample.complete_count_rows} rows with both counts</dd>
      </dl>
      <p>Shares use only the returned regular-wallet rows with both volume fields. Missing fields stay unknown; pool and unclassified rows earn no participation support. Buy-ranked selection misses other activity. Two-sided trading is ordinary behavior too: the smaller-leg sum does not match actual counterparties, prove round trips or establish wash trading. Wallet labels do not prove independent owners. No organic-volume or scoring credit.</p>
    </section>}
    <p>Volume is a reported total, not verified organic demand. Holder count includes unclassified balances; meaningful holder growth remains unknown. A missing or unflagged provider label does not establish clean trading. These observations do not change the Discovery score or action checks.</p>
    <details><summary>Coverage and source limits</summary><ul>{data.gaps.map(gap => <li key={gap}>{gap.replaceAll("_", " ")}</li>)}</ul></details>
    <a href={`https://gmgn.ai/sol/token/${data.address}`} target="_blank" rel="noopener noreferrer">View source on GMGN ↗</a>
  </>;
}
export function GmgnEvidence({ address }: { address: string }) {
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState<{ address: string; data: GmgnPublicSummary } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setError("");
    void getJson(`/api/10x/gmgn/solana/${address}`, GmgnPublicSummarySchema, controller.signal).then(data => {
      if (!controller.signal.aborted && data.address === address) setLoaded({ address, data });
    }).catch(() => { if (!controller.signal.aborted) setError("Saved GMGN evidence is temporarily unavailable."); });
    return () => controller.abort();
  }, [address, open]);
  const data = loaded?.address === address ? loaded.data : null;
  return <details id="gmgn-evidence" className="tenx-evidence-disclosure" onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary><span>GMGN activity & risk evidence</span><small>Reported signals; separate from score</small></summary>
    <div className="tenx-evidence-body">{error && <p role="alert">{error}{data ? " The last response remains visible." : ""}</p>}{data ? <GmgnEvidenceValues data={data} /> : !error && open ? <p role="status">Loading saved observations…</p> : null}</div>
  </details>;
}
