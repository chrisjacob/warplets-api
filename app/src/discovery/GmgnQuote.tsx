import{useEffect,useState}from"react";
import{GmgnQuoteReportSchema,type GmgnQuoteReport}from"../../../discovery/src/gmgn-quote-model";
import{getJson}from"./client";
// Format lamports exactly; do not round large integers through Number.
export function quoteSol(raw:string|null){if(raw===null)return"Unknown";const n=BigInt(raw),fraction=(n%1_000_000_000n).toString().padStart(9,"0").replace(/0+$/,"");return(n/1_000_000_000n).toString()+(fraction?"."+fraction:"")+" SOL";}
export function GmgnQuoteValues({data}:{data:GmgnQuoteReport}){return<>
 <p>Saved comparison at {new Date(data.cutoff_at).toLocaleString()}. Pool quote transfers support {data.supported_events} / {data.reported_trade_events} reported trade events. {data.status==="held"&&"Review held by its bounds."}</p>
 <p>Buy-side pool transfers: {quoteSol(data.buy_pool_quote_transfer_raw)}. Sell-side pool transfers: {quoteSol(data.sell_pool_quote_transfer_raw)}. Sides are separate; absent or incomplete totals stay unknown.</p>
 {data.groups.map((group,i)=><section key={i} aria-label={`${group.side} quote group ${i+1}`}>
  <h4>{group.side==="buy"?"Buy":"Sell"} group · {group.events} reported events</h4>
  <dl className="tenx-stats"><div><dt>Pool quote transfer</dt><dd>{quoteSol(group.pool_quote_transfer_raw)}</dd></div><div><dt>Event quote before known fees</dt><dd>{quoteSol(group.event_quote_raw)}</dd></div><div><dt>Known fee components</dt><dd>{quoteSol(group.known_fee_raw)}</dd></div><div><dt>Wallet swap cash flow</dt><dd>{quoteSol(group.wallet_swap_cashflow_raw)}</dd></div></dl>
  <p>Token evidence: {group.token_match.replaceAll("_"," ")}. Fee evidence: {group.fee_status.replaceAll("_"," ")} · {group.fee_rows} reconciled rows. Provider-reported USD: {group.reported_usd===null?"Unknown":group.reported_usd.toLocaleString(undefined,{maximumFractionDigits:6})}.</p>
  <p>Provider-implied USD/SOL using pool transfer: {group.implied_usd_per_sol===null?"Unknown":group.implied_usd_per_sol.toLocaleString(undefined,{maximumFractionDigits:6})}. This ratio is not an independently verified historical SOL price.</p>
  {!!group.gaps.length&&<ul>{group.gaps.map(gap=><li key={gap}>{gap.replaceAll("_"," ")}</li>)}</ul>}
 </section>)}
 <p>Pool transfers and emitted quote amounts use different fee bases. Unknown event extensions or incomplete fees withhold wallet swap cash flow. Swap amounts exclude network fees, rent, tips and unrelated instructions. These are sampled transfers, not organic or 24h volume. No USD verification, wash verdict, scoring or action credit.</p>
 <details><summary>Quote review gaps and replay</summary><ul>{data.gaps.map(gap=><li key={gap}>{gap.replaceAll("_"," ")}</li>)}</ul><p className="tenx-address">Report hash: {data.report_hash}</p></details>
 </>;}
export function GmgnQuote({activityId,address}:{activityId:string;address:string}){
 const[open,setOpen]=useState(false),[loaded,setLoaded]=useState<GmgnQuoteReport|null>(null),[error,setError]=useState("");
 useEffect(()=>{if(!open)return;const controller=new AbortController();setError("");void getJson(`/api/10x/gmgn/quote/${activityId}`,GmgnQuoteReportSchema,controller.signal).then(data=>{if(data.activity_id!==activityId||data.address!==address)throw Error("quote_binding_mismatch");if(!controller.signal.aborted)setLoaded(data);}).catch(()=>{if(!controller.signal.aborted)setError("Saved quote review is unavailable. No collection was triggered.");});return()=>controller.abort();},[open,activityId,address]);
 const data=loaded?.activity_id===activityId&&loaded.address===address?loaded:null;
 return<details onToggle={event=>{if(event.currentTarget===event.target)setOpen(event.currentTarget.open);}}><summary>Review SOL transfers & fee basis</summary>{error&&<p role="alert">{error}{data?" The last matching review remains visible.":""}</p>}{data?<GmgnQuoteValues data={data}/>:open&&!error?<p role="status">Reviewing saved quote transfers…</p>:null}</details>;
}
