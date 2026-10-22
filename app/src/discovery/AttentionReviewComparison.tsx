import { useState } from "react";
import type { AttentionQueueResult } from "../../../discovery/src/attention-queue-model";
import { compareAttentionReview, type AttentionReviewComparison } from "./attention-review-comparison";
import type { ReviewContext } from "./attention-review-store";

const money = (n: number | null) => n === null ? "Unknown" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
export function AttentionReviewComparisonValues({ result }: { result: AttentionReviewComparison }) {
  if (result.state === "absent") return <p>This exact chain and contract is absent from the loaded shortlist at {result.as_of}. {result.truncated && "The saved view reached its coverage bound. "}Absence does not prove attention faded, failure or safety.</p>;
  if (result.state === "not_newer") return <p>The loaded list cutoff ({result.as_of}) is the same or earlier. Refresh saved lists explicitly if you want to check for a later view.</p>;
  const columns = [result.original, result.current];
  const rows: [string, (c: ReviewContext) => string][] = [
    ["List cutoff", c => c.as_of], ["Fresh attention providers", c => String(c.token.attention_families)],
    ["Sampled hours observed", c => String(c.token.observed_hours)], ["Reported 24h volume", c => money(c.token.volume_24h_usd)],
    ["Reported 1h volume", c => money(c.token.volume_1h_usd)], ["Reported liquidity", c => money(c.token.liquidity_usd)],
    ["Reported market cap", c => money(c.token.market_cap_usd)],
    ["Market source", c => c.token.market_source ?? "Unknown"], ["1h volume source", c => c.token.recent_volume_source ?? "Unknown"],
    ["Quality review", c => c.token.checks === "adverse" ? "Adverse flags" : "Review needed"],
    ["View coverage", c => c.history_truncated ? "Bound reached" : "No truncation reported"],
  ];
  return <><div className="tenx-review-comparison-table"><table><caption>Same chain and contract · saved and loaded observations</caption><thead><tr><th scope="col">Observation</th><th scope="col">Draft snapshot</th><th scope="col">Loaded snapshot</th></tr></thead><tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{columns.map((c, i) => <td key={i}>{value(c)}</td>)}</tr>)}</tbody></table></div>
    <div className="tenx-review-comparison-cards"><p>Same chain and contract · draft and loaded observations</p>{rows.map(([label, value]) => <section key={label}><h5>{label}</h5><dl>{columns.map((c, i) => <div key={i}><dt>{i ? "Loaded snapshot" : "Draft snapshot"}</dt><dd>{value(c)}</dd></div>)}</dl></section>)}</div>
    <div className="tenx-review-comparison-sources">{columns.map((c, i) => <div key={i}><h5>{i ? "Loaded" : "Draft"} source observations</h5>{c.token.sources.length ? <ul>{c.token.sources.map((s, n) => <li key={n}>{s.provider} · {s.window} · rank {s.rank ?? "unknown"} · {s.fresh ? "fresh in that view" : "stale in that view"}<br/>Received {s.received_at}</li>)}</ul> : <p>No source observations retained.</p>}{c.token.reasons.length > 0 && <p>Concerns: {c.token.reasons.map(r => r.replaceAll("_", " ")).join("; ")}</p>}<p>Saved view gaps: {c.gaps.length ? c.gaps.join("; ") : "None reported; coverage is still a sample."}</p></div>)}</div>
    <p>A later list cutoff does not freshen source timestamps or verify volume, holder growth, safety or your follow-up outcome. This comparison stays fixed until you compare again.</p></>;
}
export function AttentionReviewComparison({ context, loadedReport, disabled, onAdopt }: { context: ReviewContext; loadedReport?: AttentionQueueResult | null; disabled: boolean; onAdopt: (context: ReviewContext) => void }) {
  const [preview, setPreview] = useState<{ baseline: ReviewContext; result: AttentionReviewComparison | null; error: boolean } | null>(null);
  // A different draft hides a prior preview immediately, including before effects.
  const visible = preview?.baseline === context ? preview : null;
  const compare = () => { if (disabled || !loadedReport) return; try { setPreview({ baseline: context, result: compareAttentionReview(context, loadedReport), error: false }); } catch { setPreview({ baseline: context, result: null, error: true }); } };
  return <div className="tenx-review-comparison"><h4>Compare follow-up observations</h4><p>Compare this draft with the exact token in the currently loaded attention lists. This reads no providers and does not save or replace your draft.</p>
    <button type="button" className="tenx-button tenx-button--quiet" disabled={disabled || !loadedReport} onClick={compare}>Compare with loaded observations</button>
    {!loadedReport && <p>Load saved attention lists first. No source request runs from this comparison.</p>}
    {visible?.error && <p role="alert">The comparison could not be admitted. Check the list and device clock; your draft and saved history are unchanged.</p>}
    {visible?.result && <><p role="status">{visible.result.state === "ready" ? "Comparison captured. Your draft is unchanged." : "No newer matching snapshot admitted."}</p><AttentionReviewComparisonValues result={visible.result}/>{visible.result.state === "ready" && <><p>Adopting replaces only this draft's observation snapshot. Your labels stay in the draft; earlier saved revisions and the first-review date stay unchanged. Save a revision separately to retain it.</p><button type="button" className="tenx-button" disabled={disabled} onClick={() => { if (!disabled && visible.result?.state === "ready") onAdopt(structuredClone(visible.result.current)); }}>Use compared observations in this draft</button></>}</>}
  </div>;
}
