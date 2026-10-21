import { useEffect, useState } from "react";
import { HolderHistoryReportSchema, type HolderHistoryReport } from "../../../discovery/src/holder-history-model";
import { getJson } from "./client";

const time = (at: string) => new Date(at).toLocaleString();
export function HolderHistoryValues({ data }: { data: HolderHistoryReport }) {
  const intervals = [
    { label: "From first saved snapshot", delta: data.since_first },
    ...(data.recent?.start_hash !== data.since_first?.start_hash ? [{ label: "Latest observed interval", delta: data.recent }] : []),
  ];
  return <>
    <p><strong>Meaningful holder growth: unknown.</strong> These are changes in positive token balances. Unsolicited dust, airdrops and shared controllers are unclassified. Raw growth adds no scoring credit.</p>
    <p>Saved inventories within the 24 hours ending {time(data.cutoff_at)}. {data.stale && <strong>Latest inventory stale or missing; this is not current momentum.</strong>}</p>
    {data.status === "limited" ? <p>At least 97 archived inventories exceed this review's 96-record bound. Comparisons are withheld; no convenient subset is selected.</p> : !data.snapshots.length ? <p>No saved full owner inventories in this window. A missing baseline is unknown, not zero.</p> : <>
      <div className="tenx-table-scroll"><table><caption>Selected saved inventories · exact canonical vault excluded</caption><thead><tr><th>Observed</th><th>Raw owners</th><th>Inventory</th><th>Slot</th></tr></thead><tbody>{data.snapshots.map(row=><tr key={row.payload_hash}>
        <td><a href={`/api/10x/holder-evidence/${row.payload_hash}`} target="_blank" rel="noopener noreferrer">{time(row.observed_at)}</a></td><td>{row.raw_owner_count.toLocaleString()}</td>
        <td>{row.complete && row.layout_certified ? "Supply reconciled; layout certified" : "Partial or uncertified"}</td><td>{row.context_slot.toLocaleString()}</td>
      </tr>)}</tbody></table></div>
      {!data.since_first && <p>A second comparable inventory is needed. No historical zero baseline is assumed.</p>}
      {intervals.map(({label,delta})=>delta && <section key={label} aria-label={label}><h3>{label}</h3><p>{time(delta.start_at)} → {time(delta.end_at)} · {(delta.duration_seconds/3600).toFixed(2)} hours between snapshots.</p>
        {delta.status === "held" ? <p>Comparison held: {delta.gaps.map(v=>v.replaceAll("_"," ")).join(" · ")}.</p> : <>
          <p>{delta.starting_owners} → {delta.ending_owners} raw owners · {delta.entrants} entrant{delta.entrants===1?"":"s"} · {delta.exits} exit{delta.exits===1?"":"s"} · net {delta.net_change! > 0 ? "+" : ""}{delta.net_change}.</p>
          <p>Raw change: {delta.raw_growth_pct === null ? "undefined with a zero baseline" : `${delta.raw_growth_pct.toFixed(2)}%`}. {delta.retained} starting owners still have a positive balance at the end{delta.positive_balance_retention_pct === null ? "; retention percentage undefined" : ` (${delta.positive_balance_retention_pct.toFixed(2)}%)`}.</p>
        </>}
      </section>)}
    </>}
    <p>All token accounts are aggregated by owner; the public top-owner list is not used to reconstruct growth. Endpoint balances do not prove uninterrupted holding or voluntary purchases. These intervals are not certified 24h or since-creation growth. Economic balance and acquisition rules still need calibration; Discovery scores and action checks remain unchanged.</p>
    <details><summary>History coverage and provenance</summary><p>At most the first and latest two saved snapshots are replayed. Collector timestamps are not exact block times. Historical request finality is not independently attested by the archived payload.</p><ul>{data.gaps.map(gap=><li key={gap}>{gap.replaceAll("_"," ")}</li>)}</ul><p className="tenx-address">Report hash: {data.report_hash}</p></details>
  </>;
}
export function HolderHistory({ address }: { address: string }) {
  const [open,setOpen] = useState(false),[loaded,setLoaded] = useState<{address:string;data:HolderHistoryReport}|null>(null),[error,setError] = useState("");
  useEffect(()=>{
    if (!open) return;
    const controller = new AbortController();setError("");
    void getJson(`/api/10x/holders/history/solana/${address}`,HolderHistoryReportSchema,controller.signal).then(data=>{
      if(!controller.signal.aborted && data.address===address)setLoaded({address,data});
    }).catch(()=>{if(!controller.signal.aborted)setError("Saved holder history is temporarily unavailable.");});
    return ()=>controller.abort();
  },[address,open]);
  const data=loaded?.address===address?loaded.data:null;
  return <details id="holder-history" className="tenx-evidence-disclosure" onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}>
    <summary><span>Holder growth & retention</span><small>Raw balance changes; meaningful growth unknown</small></summary>
    <div className="tenx-evidence-body">{error && <p role="alert">{error}{data?" The last response remains visible.":""}</p>}{data?<HolderHistoryValues data={data}/>:!error && open?<p role="status">Replaying saved owner inventories…</p>:null}</div>
  </details>;
}
