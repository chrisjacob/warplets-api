import { useEffect, useState } from "react";
import { GmgnPublicSummarySchema, type GmgnPublicSummary } from "../../../discovery/src/gmgn-model";
import { getJson } from "./client";

const usd = (value: number | null) => value === null ? "Unknown" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const percent = (value: number | null) => value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
export function GmgnEvidenceValues({ data }: { data: GmgnPublicSummary }) {
  if (!data.observations) return <p>No saved GMGN observations for this token in the recent cache. Missing data adds no score credit.</p>;
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
    {data.candle_count !== null && <p>{data.candle_count} saved one-minute candles · {data.candle_window_complete ? "requested window complete" : "requested window incomplete"} · {usd(data.candle_window_volume_usd)} reported USD volume in that window.</p>}
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
