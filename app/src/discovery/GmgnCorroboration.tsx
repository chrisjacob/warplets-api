import{useEffect,useState}from"react";
import{GmgnCorroborationReportSchema,type GmgnCorroborationReport}from"../../../discovery/src/gmgn-corroboration-model";
import{getJson}from"./client";
export function GmgnCorroborationValues({data}:{data:GmgnCorroborationReport}){return<>
  <p>Compared at {new Date(data.cutoff_at).toLocaleString()} against activity received {new Date(data.activity_received_at).toLocaleString()}. {data.cached_transactions} / {data.required_transactions} required transaction bodies are saved. {data.status==="held"&&"Comparison held by its bounds."}</p>
  <p>{data.exact_quantity_events} / {data.reported_trade_events} reported trade events match signed-wallet, side, time and exact instruction token quantities in the saved RPC sample. {data.aggregate_only_events} events match only aggregate token quantities. {data.non_trade_events} non-trade events are excluded.</p>
  <ul>{data.groups.map((group,i)=><li key={i}>{group.events} reported events · {group.parsed_instructions} parsed instructions · {group.status.replaceAll("_"," ")}</li>)}</ul>
  <p>Missing bodies are unknown. Quantity conflicts can reflect provider aggregation or parsing gaps; they are not a fraud verdict. RPC body consistency is not independent finality attestation or verified USD valuation. No organic-volume, scoring or action credit. Later evidence never changes an archived score.</p>
  <details><summary>Comparison gaps and replay</summary><ul>{data.gaps.map(gap=><li key={gap}>{gap.replaceAll("_"," ")}</li>)}</ul><p className="tenx-address">Report hash: {data.report_hash}</p></details>
</>;}
export function GmgnCorroboration({activityId,address}:{activityId:string;address:string}){
  const[open,setOpen]=useState(false),[loaded,setLoaded]=useState<GmgnCorroborationReport|null>(null),[error,setError]=useState("");
  useEffect(()=>{if(!open)return;const controller=new AbortController();setError("");void getJson(`/api/10x/gmgn/corroboration/${activityId}`,GmgnCorroborationReportSchema,controller.signal).then(data=>{if(data.activity_id!==activityId||data.address!==address)throw Error("comparison_binding_mismatch");if(!controller.signal.aborted)setLoaded(data);}).catch(()=>{if(!controller.signal.aborted)setError("Saved RPC comparison is unavailable. No collection was triggered.");});return()=>controller.abort();},[open,activityId,address]);
  const data=loaded?.activity_id===activityId&&loaded.address===address?loaded:null;
  return<details onToggle={event=>{if(event.currentTarget===event.target)setOpen(event.currentTarget.open);}}><summary>Compare with saved RPC transactions</summary>{error&&<p role="alert">{error}{data?" The last comparison remains visible.":""}</p>}{data?<GmgnCorroborationValues data={data}/>:open&&!error?<p role="status">Comparing saved transaction evidence…</p>:null}</details>;
}
