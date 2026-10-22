import {useEffect,useRef,useState} from "react";
import {DiscoveryYield,type DiscoveryYieldReport} from "../../../discovery/src/discovery-yield-model";
import {getJson} from "./client";

export function DiscoveryYieldValues({report:r}:{report:DiscoveryYieldReport}){
  return <><p>Saved pipeline at {new Date(r.cutoff).toLocaleString()}. This sample cannot tell us whether the wider market has good tokens.</p><dl>
    <dt>Observed signatures awaiting inspection</dt><dd>{r.signatures.pending} / {r.signatures.observed}{r.signatures.oldest_pending_at&&<> · oldest queued {new Date(r.signatures.oldest_pending_at).toLocaleString()}</>}</dd>
    <dt>Past-day migration leads awaiting first inspection</dt><dd>{r.leads.unchecked_graduated_24h} / {r.leads.graduated_24h}</dd>
    <dt>Current candidates without recovered creation time</dt><dd>{r.candidates.active_creation_unknown} / {r.candidates.active} · outside the default first-day view</dd>
    <dt>Saved creation / graduation within 24 hours</dt><dd>{r.candidates.created_24h} / {r.candidates.graduated_24h} · these are different windows</dd>
    <dt>Recently fetched market cache / current candidates</dt><dd>{r.candidates.active_fresh_market} / {r.candidates.active} · {r.candidates.active_fresh_reported_volume} with recent reported volume</dd>
  </dl><p>Migration scan: {r.harvest.checkpoint==="migration_required"?"pagination migration required; new harvest is held":r.harvest.checkpoint==="continuing"?"continuing a saved page boundary":r.harvest.checkpoint==="invalid"?"checkpoint needs review; harvesting is held":"ready for the next bounded page"}. Intake remains incomplete. Older skipped history is not recovered by this status.</p>
    {(r.candidates.invalid_cached_identity+r.leads.invalid_cached_json)>0&&<p role="alert">{r.candidates.invalid_cached_identity} candidate identities and {r.leads.invalid_cached_json} lead payloads need review; they remain in the inventory denominator.</p>}
    <p>Counts describe cached fields; market schemas are not revalidated and source receipts have not been replayed here. Reported volume is not verified organic volume. V4 ranks structural support; qualified daily volume and holder growth do not affect it. Missing evidence is not a pass, and voting/launch gates remain separate.</p></>;
}
export function DiscoveryYieldPanel({allCurrentHref}:{allCurrentHref:string}){
  const [report,setReport]=useState<DiscoveryYieldReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const active=useRef<AbortController|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort();};},[]);
  const load=async()=>{if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setError("");try{const value=await getJson('/api/10x/discovery/yield',DiscoveryYield,AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]));if(mounted.current&&!controller.signal.aborted)setReport(value);}catch{if(mounted.current&&!controller.signal.aborted)setError('Pipeline counts could not load. '+(report?'The previous cutoff remains visible.':'Coverage remains unknown.'));}finally{if(active.current===controller){active.current=null;if(mounted.current)setBusy(false);}}};
  return <details className="tenx-browse-explainer" onToggle={event=>{if(event.currentTarget.open&&!report&&!busy&&!error)void load();}}><summary>Why Discovery can miss promising tokens</summary><p>Only a bounded part of the market reaches this inventory. Low grades can reflect missing or stale evidence, not just adverse checks.</p><p><a href={allCurrentHref}>Inspect current candidates with older or unknown creation times →</a></p><button type="button" className="tenx-button tenx-button--quiet" disabled={busy} onClick={()=>void load()}>{busy?'Reading saved pipeline…':'Refresh pipeline counts'}</button>{error&&<p role="alert">{error}</p>}{report&&<DiscoveryYieldValues report={report}/>}</details>;
}
