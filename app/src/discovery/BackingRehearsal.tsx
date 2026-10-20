import { useEffect,useState } from "react";
import { BackingListResponse, BackingRecord, BackingSummary, OpenBackingRequest } from "../../../discovery/src/backing-model";
import type { z } from "zod";

type List=z.infer<typeof BackingListResponse>;
type Summary=z.infer<typeof BackingSummary>;
type Record=z.infer<typeof BackingRecord>;
const date=(value:string)=>new Date(value).toLocaleString();
const words=(value:string)=>value.replaceAll("_"," ");
const projection=(raw:string)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:6}).format(Number(raw)/1000000);
async function api(path:string,token?:string,body?:unknown){
  const response=await fetch(`/api/10x/${path}`,{cache:"no-store",...(body?{method:"POST",body:JSON.stringify(body)}:{}),headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body?{"content-type":"application/json"}:{})}});
  const value:unknown=await response.json();
  if(!response.ok){const code=value && typeof value==="object" && "error" in value?String(value.error):`request_failed_${response.status}`;throw new Error(words(code));}
  return value;
}
function useBacking(){
  const [data,setData]=useState<List|null>(null),[error,setError]=useState("");
  useEffect(()=>{let active=true;
    const refresh=async()=>{try{const value=BackingListResponse.parse(await api("backing"));if(active){setData(value);setError("");}}catch(e){if(active)setError(e instanceof Error?e.message:"Backing data unavailable.");}};
    void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void refresh();},15000);return()=>{active=false;window.clearInterval(timer);};
  },[]);return {data,error};
}
function WindowSummary({run}:{run:Summary}){
  return <article className="tenx-panel tenx-backing-window"><div className="tenx-row"><h2>{run.state==="open"?"Prospective window open":"Frozen backing rehearsal"}</h2><span className="tenx-badge">No votes</span></div>
    <p>Trading window: {date(run.starts_at)} → {date(run.ends_at)}. Source deadline: {date(run.deadline)}.</p>
    <div className="tenx-metrics"><div><span>Frozen contenders</span><strong>{run.candidate_count}</strong></div><div><span>Eligible at opening</span><strong>{run.eligible_at_open}</strong></div><div><span>Linked wallets at opening</span><strong>{run.frozen_wallet_count}</strong></div></div>
    <p>{run.entries} decoded trade instructions · {run.groups} identity/token groups. Up to 20 contenders and 100 cached transactions; collection is incomplete.</p>
    {run.source_evidence_version&&!run.source_coverage&&<p><strong>Wallet-window collection:</strong> After trading ends, local maintenance scans up to 16 frozen signed wallets within the fixed source grace period. It uses a bounded share of the existing wallet/RPC allowance. Missing pages or bodies will hold experimental projections.</p>}
    {run.source_coverage&&<div className="tenx-panel"><h3>Wallet-window evidence</h3><p><strong>{words(run.source_coverage.status)}</strong> · {run.source_coverage.wallets_tracked}/{run.source_coverage.wallets_requested} frozen wallets tracked · {run.source_coverage.wallet_boundaries_reached} older history boundaries reached · {run.source_coverage.bodies_retained}/{run.source_coverage.signatures_in_window} in-window bodies retained.</p><p>{run.source_coverage.finalized_slot===null?"No qualifying finalized-slot observation retained.":`RPC-reported finalized slot ${run.source_coverage.finalized_slot}, estimated block time ${date(new Date(run.source_coverage.finalized_block_time!*1000).toISOString())}.`} Independent finality and exhaustive history remain unverified. {run.source_coverage.reserved_calls} calls reserved from existing allowances.</p><details><summary>Source coverage gaps</summary><ul>{run.source_coverage.gaps.map(g=><li key={g}>{words(g)}</li>)}</ul></details></div>}
    {run.cutoff_evidence_version&&<p><strong>Cutoff evidence:</strong> {run.state==="open"?"Candidate updates are being retained locally through cutoff. Later refreshes cannot replace them.":run.coverage_detail?.cutoff==="history_limited"?"History incomplete: a storage bound or candidate removal was encountered. All closing gates are held.":`${run.coverage_detail?.snapshots_retained??0} updated cutoff snapshots retained; other contenders use their frozen opening snapshot. Freshness and every evidence gate still apply.`}</p>}
    {run.coverage_detail&&<p><strong>Historical price coverage:</strong> {run.coverage_detail.references_available} trade references available · {run.coverage_detail.references_missing} unavailable · {run.coverage_detail.verified_usd_trades} verified USD valuations. References use provider prices recorded before each trade, fetched within 3 minutes. Publication time and exact commit timing remain unverified. They do not change the hypothetical projections below.</p>}
    <p><strong>Experimental assumptions:</strong> ${run.assumptions.assumed_sol_usd}/SOL, ${run.assumptions.minimum_trade_usd} minimum buy/net purchase and ${run.assumptions.per_identity_cap_usd} cap per identity/token. These are hypothetical inputs, not verified historical prices or approved voting rules.</p>
    {run.state==="open"?<p>Local maintenance will freeze available evidence after the source deadline. A sleeping workstation resumes at the next tick; the deadline stays fixed.</p>:<>
      <div className="tenx-table-scroll"><table><thead><tr><th>Token</th><th>Gates open / close</th><th>Linear / √ projection</th><th>Identity groups</th></tr></thead><tbody>{run.projections.map(p=><tr key={p.mint}><td><a href={`/token/solana/${p.mint}`}>{p.symbol}</a><small className="tenx-address">{p.mint}</small></td><td>{p.eligible_at_open?"Pass":"Held"} / {p.eligible_at_close?"Pass":"Held"}</td><td>{projection(p.linear_micros)} / {projection(p.sqrt_micros)}<small>Experimental units</small></td><td>{p.identities_projected} projected · {p.identities_held} held</td></tr>)}</tbody></table></div>
      {Object.keys(run.entry_reasons).length>0 && <details><summary>Why trade instructions were held</summary><ul>{Object.entries(run.entry_reasons).map(([reason,count])=><li key={reason}>{words(reason)}: {count}</li>)}</ul><p>One instruction can have multiple reasons. Signals are review evidence, not a finding of fraud.</p></details>}
      <p>Stored output hashes checked. Full transaction decoding and deterministic replay are available to the local operator.</p>
    </>}
    {run.last_error && <p role="alert" className="tenx-error">Automatic freeze needs attention: {words(run.last_error)}. No evidence checks were bypassed.</p>}
    <details><summary>Frozen hashes, scope and gaps</summary><p className="tenx-address">Opening: {run.opening_hash}</p>{run.record_hash&&<p className="tenx-address">Record: {run.record_hash}</p>}<ul>{run.gaps.map(g=><li key={g}>{words(g)}</li>)}</ul><p>Request: {run.id}</p></details>
  </article>;
}
export function BackingPage(){
  const {data,error}=useBacking();
  return <><header className="tenx-heading"><p className="tenx-eyebrow">LOCAL / BACKING REHEARSALS</p><h1>Inspect the buys.<br/><span>Rehearse the rules.</span></h1><p>Test frozen wallet membership and decoded Pump/PumpSwap purchases and sales. A buy link, wallet connection or old holding never becomes a vote.</p></header>
    <aside className="tenx-notice"><strong>Outcomes are withheld</strong><p>The cache is sampled, historical USD valuation and genuine-buyer checks are incomplete, and voting rules remain unapproved. Linear and square-root comparisons are experiments. No winner, live votes or rewards are produced.</p></aside>
    <div className="tenx-inline-links"><a href="/wallets">Link a Solana wallet →</a><a href="/admin/10x">Local rehearsal controls →</a><a href="/elections">Discovery rehearsals →</a></div>
    {error&&<p role="alert" className="tenx-error">{error}</p>}{!data&&!error&&<p role="status">Loading backing rehearsals…</p>}
    {data&&!data.runs.length&&<section className="tenx-panel"><h2>No prospective window yet</h2><p>A local operator can open a window in Admin. Candidate policy and signed wallet membership are frozen before trading begins; previous trades and later wallet links are excluded.</p></section>}
    {data?.runs.map(run=><WindowSummary key={run.id} run={run}/>)}
    <p className="tenx-footnote">Reads and automatic settlement use stored data only. No new RPC budget or polling per wallet. Public summaries omit wallet and identity addresses; retained membership and transaction evidence require the local operator token.</p>
  </>;
}
export function BackingLab({token}:{token:string}){
  const [minutes,setMinutes]=useState("1"),[usd,setUsd]=useState("100"),[minimum,setMinimum]=useState("1"),[cap,setCap]=useState("100"),[reason,setReason]=useState("");
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID()),[savedId,setSavedId]=useState(""),[run,setRun]=useState<Summary|null>(null),[record,setRecord]=useState<Record|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function action(kind:"open"|"freeze"|"replay"){
    setBusy(true);setMessage("");setRecord(null);
    try{
      if(kind==="open"){
        const body=OpenBackingRequest.parse({request_id:requestId,reason,duration_minutes:Number(minutes),assumptions:{assumed_sol_usd:Number(usd),minimum_trade_usd:Number(minimum),per_identity_cap_usd:Number(cap)}});
        const value=BackingSummary.parse(await api("admin/backing/open",token,body));setRun(value);setSavedId(value.id);setRequestId(crypto.randomUUID());setMessage("Prospective window opened. Local maintenance freezes it after the fixed source deadline.");
      }else if(kind==="freeze"){
        if(reason.trim().length<3)throw new Error("Enter a reason of at least three characters.");
        setRun(BackingSummary.parse(await api("admin/backing/freeze",token,{reason,request_id:savedId.trim()})));setMessage("Available evidence frozen. Outcome remains withheld.");
      }else{
        const value=await api(`admin/backing/${encodeURIComponent(savedId.trim())}`,token) as {record:unknown;replay:unknown};
        if(value.replay!=="verified")throw new Error("Replay did not verify.");setRecord(BackingRecord.parse(value.record));setMessage("Exact stored transactions decoded again; ledger, projections and hashes verified. Zero provider calls.");
      }
    }catch(e){setMessage(e instanceof Error?e.message:"Backing operation failed.");}finally{setBusy(false);}
  }
  function download(){if(!record)return;const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=`backing-${record.opening.id}.json`;a.click();URL.revokeObjectURL(url);}
  return <section className="tenx-panel tenx-backing-lab"><h2>Backing experiment lab</h2><p>Open one prospective local window at a time. Opening freezes up to 20 contenders under every current gate, plus signed wallet membership. Existing holdings and later links give no credit. The one-minute example below uses hypothetical USD assumptions; no rule is activated.</p>
    <div className="tenx-backing-fields"><label>Window minutes<input type="number" min="1" max="1440" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><label>Assumed USD per SOL<input type="number" min="1" max="10000" value={usd} onChange={e=>setUsd(e.target.value)}/></label><label>Minimum buy / net USD<input type="number" min="1" max="1000" value={minimum} onChange={e=>setMinimum(e.target.value)}/></label><label>Identity/token cap USD<input type="number" min="1" max="1000000" value={cap} onChange={e=>setCap(e.target.value)}/></label></div>
    <label>Review reason<input value={reason} maxLength={300} onChange={e=>setReason(e.target.value)} placeholder="Why run this local experiment?"/></label><div className="tenx-admin-actions"><button disabled={busy||!token||reason.trim().length<3} className="tenx-button" onClick={()=>void action("open")}>Open local backing window</button></div>
    <label>Saved rehearsal ID<input value={savedId} onChange={e=>setSavedId(e.target.value)} placeholder="UUID from a saved window"/></label><div className="tenx-admin-actions"><button disabled={busy||!token||!savedId} className="tenx-button tenx-button--quiet" onClick={()=>void action("freeze")}>Freeze if source deadline passed</button><button disabled={busy||!token||!savedId} className="tenx-button tenx-button--quiet" onClick={()=>void action("replay")}>Replay & inspect ledger</button></div>
    <p role="status">{busy?"Working locally…":message}</p>{run&&<WindowSummary run={run}/>}
    {record&&<><h3>Verified replay · private evidence</h3><p>{record.result.entries.length} decoded instructions and {record.result.groups.length} identity/token groups. First 100 instructions shown below. The download contains all retained transactions and private frozen wallet membership.</p><button className="tenx-button tenx-button--quiet" onClick={download}>Download frozen evidence</button><div className="tenx-table-scroll"><table><thead><tr><th>Instruction / token</th><th>Wallet / group</th><th>Trade amounts</th><th>Held reasons</th></tr></thead><tbody>{record.result.entries.slice(0,100).map(e=><tr key={`${e.mint}:${e.signature}:${e.instruction_index}`}><td>{e.instruction} #{e.instruction_index}<small className="tenx-address">{e.mint}</small><a href={`https://solscan.io/tx/${e.signature}`} target="_blank" rel="noopener noreferrer">Transaction ↗</a></td><td className="tenx-address">{e.wallet}<small>{e.identity_id??"No linked identity at opening"}</small></td><td>{e.side}<small>{e.base_amount_raw} base units</small><small>{e.quote_amount_raw??"Unmeasured"} lamports</small></td><td>{e.reasons.map(words).join(" · ")||"Available for diagnostic projection only"}</td></tr>)}</tbody></table></div>
      {record.result.price_references&&<details><summary>Pre-trade provider price references</summary><p>Exact micro-USD arithmetic on recorded provider prices and captured transaction decimals. These are reference estimates, never verified execution prices or vote credit. First 100 shown.</p><div className="tenx-table-scroll"><table><thead><tr><th>Token / instruction</th><th>Reference USD</th><th>Available / fetched</th><th>Coverage gaps</th></tr></thead><tbody>{record.result.price_references.slice(0,100).map(p=><tr key={`${p.mint}:${p.signature}:${p.instruction_index}`}><td className="tenx-address">{p.mint}<small>#{p.instruction_index}</small></td><td>{p.reference_usd_micros===null?"Unavailable":`$${projection(p.reference_usd_micros)}`}<small>{p.source??"No source"} · {p.decimals??"Unknown"} decimals</small></td><td>{p.snapshot_recorded_at?date(p.snapshot_recorded_at):"Unknown"}<small>{p.fetched_at?date(p.fetched_at):"Unknown"}</small></td><td>{p.gaps.map(words).join(" · ")}</td></tr>)}</tbody></table></div></details>}
    </>}
  </section>;
}
