import {useEffect,useState} from "react";
import {HolderAcquisitionReportSchema,type HolderAcquisitionReport} from "../../../discovery/src/holder-acquisition-model";
import {getJson} from "./client";
const time=(at:string)=>new Date(at).toLocaleString();
export function HolderAcquisitionValues({data}:{data:HolderAcquisitionReport}){
  const intervals=[{label:"From first saved inventory",value:data.since_first},
    ...(data.recent?.start_hash!==data.since_first?.start_hash?[{label:"Latest inventory interval",value:data.recent}]:[])];
  return <>
    <p><strong>Meaningful holder growth remains unknown.</strong> These checks match new positive-balance owners to signed swaps in one cached wallet sample. A match is not proof of independent buyers, organic demand or continuous holding. No scoring credit.</p>
    <p>Review cutoff {time(data.history.cutoff_at)}. Wallet sample: {data.wallet_observed_at?time(data.wallet_observed_at):"unavailable"}{data.wallet_stale?" · stale or missing":""}. {data.history.stale&&"Owner inventory is stale; these are historical observations."}</p>
    {intervals.map(({label,value})=>value&&<section key={label} aria-label={label}><h3>{label}</h3><p>{time(value.start_at)} → {time(value.end_at)}.</p>
      {value.status==="held"?<p>Acquisition comparison held. {value.raw_entrants===null?"Raw entrants are unknown.":`${value.raw_entrants} raw entrants remain unqualified.`}</p>:<p>{value.raw_entrants} raw entrants · {value.supported_net_buy_entrants} with sample-consistent signed net buys · {value.acquisition_unknown_entrants} with acquisition unknown.</p>}
      <p>{value.interval_sampled_trades} parsed trades in this interval; {value.finalized_matched_transactions} transactions match finalized signature-history rows. The sample does not establish all trading.</p>
      <details><summary>Exclusions and interval gaps</summary><ul>{Object.entries(value.exclusions).map(([key,count])=><li key={key}>{key.replaceAll("_"," ")}: {count} entrants</li>)}{value.gaps.map(gap=><li key={gap}>{gap.replaceAll("_"," ")}</li>)}</ul></details>
    </section>)}
    {!data.since_first&&<p>Two comparable saved owner inventories are needed. Missing acquisition evidence is unknown, not zero buying.</p>}
    <p>Each supported entrant needs positive quote flow, transaction net balances matching its parsed buys, no sampled sells, and an ending balance covering the sampled acquisition. These conservative sample checks can exclude legitimate trading. Unmatched recipients are not labelled dust or scams. Economic thresholds, full coverage and beneficial-owner independence remain open.</p>
    <details><summary>Source scope and replay</summary><p>Canonical mint/pool and token program must match the saved inventories. Slot and block-time bounds prevent trades outside the interval entering its count. Later evidence never changes an archived score; saved RPC metadata is not independent finality attestation.</p><ul>{data.gaps.map(gap=><li key={gap}>{gap.replaceAll("_"," ")}</li>)}</ul>
      {data.wallet_evidence_hash&&<a href={`/api/10x/wallet-evidence/${data.wallet_evidence_hash}`} target="_blank" rel="noopener noreferrer">Inspect saved wallet evidence ↗</a>}<p className="tenx-address">Report hash: {data.report_hash}</p></details>
  </>;
}
export function HolderAcquisition({address}:{address:string}){
  const[open,setOpen]=useState(false),[loaded,setLoaded]=useState<{address:string;data:HolderAcquisitionReport}|null>(null),[error,setError]=useState("");
  useEffect(()=>{if(!open)return;const controller=new AbortController();setError("");
    void getJson(`/api/10x/holders/acquisition/solana/${address}`,HolderAcquisitionReportSchema,controller.signal).then(data=>{if(!controller.signal.aborted&&data.history.address===address)setLoaded({address,data});})
      .catch(()=>{if(!controller.signal.aborted)setError("Cached acquisition evidence is unavailable. Raw holder history remains in its separate panel.");});
    return()=>controller.abort();},[address,open]);
  const data=loaded?.address===address?loaded.data:null;
  return <details id="holder-acquisition" className="tenx-evidence-disclosure" onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}>
    <summary><span>Holder acquisition checks</span><small>Signed swaps in a sample; meaningful growth unknown</small></summary><div className="tenx-evidence-body">{error&&<p role="alert">{error}{data?" The last response remains visible.":""}</p>}{data?<HolderAcquisitionValues data={data}/>:!error&&open?<p role="status">Replaying cached signed swaps…</p>:null}</div>
  </details>;
}
