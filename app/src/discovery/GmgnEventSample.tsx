import{useEffect,useState}from"react";
import{GmgnEventSampleReportSchema,type GmgnEventSampleReport}from"../../../discovery/src/gmgn-event-sample-model";
import{getJson}from"./client";

export function GmgnEventSampleValues({data}:{data:GmgnEventSampleReport}){return<>
  <p>Compared at {new Date(data.cutoff_at).toLocaleString()}. Complete saved page: {data.page_events} events. Targeted selection: {data.selected_events} events ({data.selected_trade_events} trades) in {data.required_transactions} transactions. {data.unselected_events} events ({data.unselected_trade_events} trades) remain unexamined.</p>
  <p>Selection prioritizes two-sided transactions, then repeated same-side token sizes, then signature order. Every event in a selected transaction is retained; more than 20 selected events holds the whole sample.</p>
  <p>{data.cached_transactions} / {data.required_transactions} selected transaction bodies are saved. {data.state==="held"?"Comparison held by its bounds.":data.state==="cache_missing"?"Missing bodies are unknown.":"Saved bodies compared for this sample."}</p>
  <p>{data.exact_quantity_events} / {data.selected_trade_events} selected trade events match signed-wallet, side, time and exact instruction token quantities. {data.aggregate_only_events} events match only aggregate token quantities.</p>
  {data.groups.length>0&&<ul>{data.groups.map((group,i)=><li key={i}>{group.events} reported events · {group.parsed_instructions} parsed instructions · {group.status.replaceAll("_"," ")}</li>)}</ul>}
  <p>This targeted sample is not representative of the page or token. Missing bodies are unknown; quantity conflicts are not a fraud verdict. No independent finality attestation, verified USD valuation, organic-volume, scoring or action credit. Live RPC collection is disconnected; opening this view makes no provider requests. Later evidence never changes an archived score.</p>
  <details><summary>Sample gaps and replay</summary><ul>{data.gaps.map(gap=><li key={gap}>{gap.replaceAll("_"," ")}</li>)}</ul><p className="tenx-address">Plan hash: {data.plan_hash}</p><p className="tenx-address">Report hash: {data.report_hash}</p></details>
</>;}

export function GmgnEventSample({activityId,address}:{activityId:string;address:string}){
  const[open,setOpen]=useState(false),[loaded,setLoaded]=useState<GmgnEventSampleReport|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    if(!open)return;const controller=new AbortController();setError("");
    void getJson(`/api/10x/gmgn/event-sample/${activityId}`,GmgnEventSampleReportSchema,controller.signal).then(data=>{
      if(data.activity_id!==activityId||data.address!==address)throw Error("sample_binding_mismatch");
      if(!controller.signal.aborted)setLoaded(data);
    }).catch(()=>{if(!controller.signal.aborted)setError("Saved sample comparison is unavailable. No collection was triggered.");});
    return()=>controller.abort();
  },[open,activityId,address]);
  const data=loaded?.activity_id===activityId&&loaded.address===address?loaded:null;
  return<details onToggle={event=>{if(event.currentTarget===event.target)setOpen(event.currentTarget.open);}}><summary>Compare targeted sample with saved transactions</summary>{error&&<p role="alert">{error}{data?" The last comparison remains visible.":""}</p>}{data?<GmgnEventSampleValues data={data}/>:open&&!error?<p role="status">Comparing saved sample evidence…</p>:null}</details>;
}
