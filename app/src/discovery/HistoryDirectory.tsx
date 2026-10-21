import {useEffect,useRef,useState} from "react";
import {Address} from "../../../discovery/src/model";
import {HistoryCursor,HistoryDirectory,type HistoryDirectory as Directory} from "../../../discovery/src/history-directory-model";

type Query={mode:"live"|"fixture";mint:string};
export function historyUrl(query:Query,cursor:string|null=null){const params=new URLSearchParams({mode:query.mode,limit:"100"});if(query.mint)params.set("mint",query.mint);if(cursor)params.set("cursor",cursor);return `/api/10x/history?${params}`;}
export async function readHistoryPage(query:Query,cursor:string|null,signal:AbortSignal):Promise<Directory>{
  const response=await fetch(historyUrl(query,cursor),{cache:"no-store",signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  if(!response.ok||!response.body)throw Error("history_unavailable");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>256000)throw Error("history_response_bound");chunks.push(part.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
  const report=HistoryDirectory.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const after=cursor?HistoryCursor.parse(JSON.parse(atob(cursor))).after:"";
  if(report.mode!==query.mode||report.mint!==(query.mint||null)||report.rows.some(row=>row.address<=after))throw Error("history_scope_or_order");
  if(report.next_cursor){const next=HistoryCursor.parse(JSON.parse(atob(report.next_cursor)));
    if(next.mode!==query.mode||next.mint!==(query.mint||null)||next.after!==report.rows.at(-1)?.address)throw Error("history_cursor_scope");}
  return report;
}
export function HistoryDirectoryRows({report}:{report:Directory}){
  return <ul className="tenx-history-items">{report.rows.map(row=><li key={row.address}><a href={`/token/solana/${row.address}${report.mode==="fixture"?"?mode=fixture":""}`}>{row.name||"Metadata unavailable"}{row.symbol?` · ${row.symbol}`:""}</a><p className="tenx-address">{row.address}</p><small>{row.metadata_status==="held"?"Metadata held; open saved evidence to investigate.":`Candidate record checked ${new Date(row.checked_at!).toLocaleString()}. This is not evidence freshness or a grade.`}</small></li>)}</ul>;
}
export function HistoryDirectoryPage(){
  const params=new URLSearchParams(window.location.search);
  const [query,setQuery]=useState<Query>(()=>({mode:params.get("mode")==="fixture"?"fixture":"live",mint:Address.safeParse(params.get("mint")).success?params.get("mint")!:""}));
  const [draft,setDraft]=useState(query.mint),[validation,setValidation]=useState("");
  const [state,setState]=useState<{scope:string;report:Directory|null;cursor:string|null;previous:(string|null)[];busy:boolean;error:boolean}>({scope:"",report:null,cursor:null,previous:[],busy:true,error:false});
  const current=useRef<{id:number;controller:AbortController|null}>({id:0,controller:null}),scope=JSON.stringify(query);
  async function load(cursor:string|null,previous:(string|null)[]){
    const id=++current.current.id;current.current.controller?.abort();const controller=new AbortController();current.current.controller=controller;
    setState(s=>s.scope===scope?{...s,busy:true,error:false}:{scope,report:null,cursor:null,previous:[],busy:true,error:false});
    try{const report=await readHistoryPage(query,cursor,controller.signal);
      if(!controller.signal.aborted&&id===current.current.id)setState({scope,report,cursor,previous,busy:false,error:false});
    }catch{if(!controller.signal.aborted&&id===current.current.id)setState(s=>({...s,busy:false,error:true}));}
  }
  useEffect(()=>{void load(null,[]);return()=>{current.current.id++;current.current.controller?.abort();};},[scope]);
  const shown=state.scope===scope?state:null,report=shown?.report,busy=shown?.busy??true;
  const navigation=(label:string)=>report&&<nav aria-label={label} className="tenx-shortlist-actions"><button className="tenx-button" disabled={busy||!shown!.previous.length} onClick={()=>void load(shown!.previous.at(-1)!,shown!.previous.slice(0,-1))}>Previous identities</button><button className="tenx-button" disabled={busy||!report.next_cursor} onClick={()=>void load(report.next_cursor,[...shown!.previous,shown!.cursor])}>Next identities</button><button className="tenx-button tenx-button--quiet" disabled={busy} onClick={()=>void load(null,[])}>Refresh directory · start</button></nav>;
  return <><header className="tenx-heading"><p className="tenx-eyebrow">SAVED / HISTORY</p><h1>Retained token directory.</h1><p>Every retained identity, including expired and unknown-date observations. This directory is unranked; use <a href="/discover">Discover</a> for current scores.</p></header>
    <form className="tenx-workspace-controls" onSubmit={event=>{event.preventDefault();const mint=draft.trim();if(mint&&!Address.safeParse(mint).success){setValidation("Enter an exact Solana mint or clear the field to browse all retained identities.");return;}setValidation("");if(mint===query.mint)void load(null,[]);else setQuery({...query,mint});}}>
      <label>Find retained mint<input type="search" maxLength={44} value={draft} onChange={e=>setDraft(e.target.value)}/></label><div className="tenx-shortlist-actions"><button className="tenx-button" type="submit">Find mint</button><button className="tenx-button tenx-button--quiet" type="button" onClick={()=>{setDraft("");setValidation("");if(query.mint)setQuery({...query,mint:""});else void load(null,[]);}}>Browse from start</button></div>
      <label>Data source<select value={query.mode} onChange={e=>setQuery({...query,mode:e.target.value as Query["mode"]})}><option value="live">Retained live observations</option><option value="fixture">Simulation examples</option></select></label>
    </form>
    {query.mode==="fixture"&&<p className="tenx-notice">SIMULATION — these are synthetic identities.</p>}
    {validation&&<p role="alert">{validation}</p>}
    <p>Up to 100 identities per page in mint-address order. Pages are live directory reads, not a frozen scoring snapshot. Names and checked dates can change; new identities before your current position appear when you return to the start. No provider lookup, source refresh, score credit or action eligibility is granted here.</p>
    {busy&&<p role="status">Loading retained identities…</p>}
    {shown?.error&&<p role="alert">The directory could not refresh. {report?"The last successful page remains visible.":"No page has been loaded."} <button className="tenx-button" onClick={()=>void load(shown.cursor,shown.previous)}>Retry page</button></p>}
    {report&&<><p>{report.total_retained} identities retained in this mode · page {shown!.previous.length+1} · read {new Date(report.read_at).toLocaleString()}.</p>
      {navigation("Retained directory pages")}
      <HistoryDirectoryRows report={report}/>{!report.rows.length&&<p>No retained identity matches this mint.</p>}
      {navigation("Retained directory pages bottom")}</>}
  </>;
}
