import {useEffect,useState} from "react";
import type {CandidateCard} from "../../../discovery/src/candidate-card";
import type {ActivityObservation} from "../../../discovery/src/activity-observation";
import {ComparisonAddresses,DiscoveryComparison,verifyDiscoveryComparison} from "../../../discovery/src/discovery-comparison-model";
import {getJson,readableReason,marketSource} from "./client";
import {TokenImage,useTokenArtwork} from "./TokenMarket";
import {tokenMoney,creationAge} from "./TokenOverview";
import {RecentActivityCell} from "./RecentActivity";
import {HolderParticipationCell} from "./HolderParticipation";
import {TradeSampleCell} from "./TradeSample";

export function comparisonSelection(raw:string|null){if(!raw)return[];const parsed=ComparisonAddresses.safeParse(raw.split(","));return parsed.success?parsed.data:[];}
export function toggleComparison(selected:string[],address:string){if(selected.includes(address))return selected.filter(a=>a!==address);const next=ComparisonAddresses.safeParse([...selected,address]);return next.success?next.data:selected;}
export function ComparisonToggle({address,selected,onToggle}:{address:string;selected:string[];onToggle:(address:string)=>void}){
  const included=selected.includes(address);
  return <button type="button" className="tenx-button tenx-button--quiet tenx-compare-toggle" aria-label={`${included?"Remove from comparison":"Compare mint"} ${address}`} aria-pressed={included} disabled={!included&&selected.length>=3} onClick={()=>onToggle(address)}>{included?"Selected for comparison":"Compare"}</button>;
}
const labels:Record<ActivityObservation["metric"],string>={pool_reported_volume_24h:"Reported pool volume · 24h",token_reported_volume_24h:"GMGN reported token volume · 24h",token_reported_volume_1h:"GMGN reported token volume · 1h",token_reported_holders:"GMGN raw holder count",candle_window_volume:"Reported candle-window volume",candle_max_adjacent_move:"Largest adjacent candle move",candle_longest_rising_run:"Longest rising candle run",raw_owner_net_change:"Raw owner change · observed interval",wallet_reported_buy_usd:"Selected-wallet reported buys",wallet_reported_sell_usd:"Selected-wallet reported sells",organic_volume_24h:"Qualified organic volume · 24h",meaningful_holder_growth_24h:"Qualified holder growth · 24h",attention_momentum:"Qualified attention momentum"};
const source=(s:ActivityObservation["source"])=>s==="gmgn"?"GMGN":s==="solana-finalized-rpc"?"Saved finalized RPC":s==="unavailable"?"Not qualified":s==="simulation"?"Simulation":marketSource(s);
const date=(s:string|null)=>s?new Date(s).toLocaleString(undefined,{timeZoneName:"short"}):"Unknown";
export function ComparisonActivityCell({record}:{record:ActivityObservation|undefined}){
  if(!record)return <p>Unknown · no observation</p>;
  const value=record.value===null?"Unknown":record.unit==="USD"?tokenMoney(record.value):record.unit==="percent"?`${record.value.toFixed(2)}%`:record.value.toLocaleString();
  const window=record.window;
  return <><strong>{value}</strong><small>{source(record.source)} · {record.qualification.replaceAll("_"," ")}{record.freshness==="stale"?" · stale":""}</small>
    <small>{window.kind==="reported_rolling"?`${(window.duration_seconds??0)/3600}h provider window · endpoint ${date(window.end_at)}`:window.start_at||window.end_at?`${date(window.start_at)} → ${date(window.end_at)}`:"Measurement window unknown"}</small>
    <small>Scope: {record.scope.kind} · {record.coverage.status.replaceAll("_"," ")}</small>
    <details><summary>Window & evidence</summary><p>Fetched {date(record.fetched_at)}. Provider measurement time: {date(record.provider_observed_at)}.</p><p>Observed / expected: {record.coverage.observed??"unknown"} / {record.coverage.expected??"unknown"}. Denominator: {record.coverage.denominator.replaceAll("_"," ")} ({record.coverage.denominator_value??"unknown"}).</p>{record.scope.kind==="wallet"&&<p className="tenx-address">Selected wallet: {record.scope.address}</p>}
      <ul>{record.gaps.map(g=><li key={g}>{readableReason(g)}</li>)}</ul>{record.references.length?<ul>{record.references.map(r=><li key={r.kind+":"+r.id}>{r.kind.replaceAll("_"," ")} · {r.integrity.replaceAll("_"," ")}<p className="tenx-address">{r.id}<br/>{r.hash}</p></li>)}</ul>:<p>No usable source reference.</p>}<p>Organic demand is unverified. This observation adds no score credit.</p></details></>;
}
export function ComparisonValues({report,artwork={}}:{report:DiscoveryComparison;artwork?:Record<string,{image_url?:string|null}|null|undefined>}){
  const metrics=Object.keys(labels) as ActivityObservation["metric"][];
  return <><p className="tenx-notice">Common review cutoff: <strong>{date(report.cutoff_at)}</strong>. Source windows and population coverage differ. Reported volume, raw owners and candle patterns do not establish organic demand or safety.</p>{report.mode==="fixture"&&<p className="tenx-notice">SIMULATION — synthetic examples; no live source evidence.</p>}
    <div className="tenx-table-scroll tenx-comparison-table" tabIndex={0} role="region" aria-label="Selected token comparison"><table><caption>Current v4 grades; activity measurements remain descriptive. Scroll horizontally to compare tokens.</caption><thead><tr><th scope="col">Measurement</th>{report.rows.map(row=><th key={row.address} scope="col"><TokenImage url={row.candidate?.market?.image_url} metadataUrl={artwork[row.address]?.image_url} metadataLoading={report.mode==="live"&&artwork[row.address]===undefined} name={row.candidate?.name??"Unresolved token"} symbol={row.candidate?.symbol??"?"}/><a href={`/token/solana/${row.address}${report.mode==="fixture"?"?mode=fixture":""}`}>{row.candidate?.name??row.address}</a><small>{row.candidate?.symbol??row.state}</small><details><summary>Full mint</summary><p className="tenx-address">{row.address}</p></details></th>)}</tr></thead><tbody>
      <tr><th scope="row">Discovery score / coverage</th>{report.rows.map(row=><td key={row.address}>{row.candidate?.discovery_score?<><strong>{row.candidate.discovery_score.value} / 100</strong><small>{row.candidate.discovery_score.evidence_coverage}% evidence coverage · v4</small></>:"Unknown"}{row.gaps.map(g=><small key={g}>{readableReason(g)}</small>)}</td>)}</tr>
      <tr><th scope="row">Action checks / concerns</th>{report.rows.map(row=><td key={row.address}>{row.candidate?.eligibility??row.state}<small>{row.candidate?.discovery_score&&row.candidate.discovery_score.version!=="discovery-score-v1"?row.candidate.discovery_score.risk_flags.map(r=>readableReason(r.code)).join(" · "):""}</small>{row.candidate&&<small>{row.candidate.reasons.slice(0,2).map(readableReason).join(" · ")||"No supported failure in these checks; safety not assured"}</small>}</td>)}</tr>
      <tr><th scope="row">Verified creation age</th>{report.rows.map(row=><td key={row.address}>{creationAge(row.candidate?.creation?.block_time,Date.parse(report.cutoff_at))}</td>)}</tr>
      <tr><th scope="row">Reported cap / liquidity</th>{report.rows.map(row=><td key={row.address}>{tokenMoney(row.candidate?.market?.market_cap_usd)}<small>{tokenMoney(row.candidate?.market?.liquidity_usd)} liquidity</small><small>Fetched {date(row.candidate?.market?.fetched_at??null)}</small></td>)}</tr>
      {([5,60,360] as const).map(minutes=><tr key={"recent"+minutes}><th scope="row">Recent activity · {minutes===5?"5m":minutes===60?"1h":"6h"}<small>Relative to saved candle endpoint</small></th>{report.rows.map(row=><td key={row.address}><RecentActivityCell report={row.recent_activity} minutes={minutes}/></td>)}</tr>)}
      {(["since_first","recent"] as const).map(window=><tr key={"holders"+window}><th scope="row">Acquired & retained holders<small>{window==="since_first"?"First / latest saved interval":"Most recent saved interval"}</small></th>{report.rows.map(row=><td key={row.address}><HolderParticipationCell report={row.holder_participation} window={window}/></td>)}</tr>)}
      {([5,60,360] as const).map(minutes=><tr key={"trades"+minutes}><th scope="row">Signed trading sample · up to {minutes===5?"5m":minutes===60?"1h":"6h"}<small>Relative to saved wallet observation</small></th>{report.rows.map(row=><td key={row.address}><TradeSampleCell report={row.trade_sample} minutes={minutes}/></td>)}</tr>)}
      {metrics.map(metric=><tr key={metric}><th scope="row">{labels[metric]}</th>{report.rows.map(row=><td key={row.address}><ComparisonActivityCell record={row.observations.find(o=>o.metric===metric)}/></td>)}</tr>)}
    </tbody></table></div><details><summary>Comparison identity</summary><p>Saved display checksum, not provider authenticity or a paired-model validation study. Every grade uses the displayed cutoff; source dates remain separate. Refresh explicitly to inspect newer observations.</p><p className="tenx-address">{report.report_hash}</p></details></>;
}
function ComparisonResults({addresses,mode}:{addresses:string[];mode:"live"|"fixture"}){
  const [report,setReport]=useState<DiscoveryComparison|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const key=addresses.join(","),artwork=useTokenArtwork(mode==="live"?addresses:[]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError("");
    void getJson(`/api/10x/discovery/compare?addresses=${encodeURIComponent(key)}&mode=${mode}`,DiscoveryComparison,controller.signal).then(verifyDiscoveryComparison).then(value=>{if(controller.signal.aborted)return;if(value.addresses.join(",")!==key||value.mode!==mode)throw Error("comparison_identity");setReport(value);}).catch(()=>{if(!controller.signal.aborted)setError("Comparison could not refresh. "+(report?"The previous cutoff remains visible.":"No comparison has been verified yet."));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
    // One saved comparison per explicit request; never poll or collect providers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,mode,refresh]);
  return <><button type="button" className="tenx-button tenx-button--quiet" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>{loading?"Reading saved observations…":"Refresh comparison cutoff"}</button>{error&&<p className="tenx-notice" role="alert">{error}</p>}{report&&<ComparisonValues report={report} artwork={artwork}/>}</>;
}
export function TokenComparison({selected,candidates,mode,onRemove}:{selected:string[];candidates:CandidateCard[];mode:"live"|"fixture";onRemove:(address:string)=>void}){
  const identity=mode+":"+selected.join(","),[opened,setOpened]=useState("");
  if(!selected.length)return <p className="tenx-footnote">Choose Compare on a card or table row to compare up to three tokens.</p>;
  return <section className="tenx-panel tenx-comparison" aria-label="Compare selected tokens"><h2>Compare tokens · {selected.length} / 3</h2><p>Select up to three tokens from cards or the table. Selections stay in this page's shareable URL.</p>{selected.length?<ul className="tenx-compare-selection">{selected.map(address=><li key={address}><span>{candidates.find(c=>c.address===address)?.symbol??address.slice(0,6)+"…"+address.slice(-4)}</span><button type="button" className="tenx-button tenx-button--quiet" aria-label={`Remove ${address} from comparison`} onClick={()=>onRemove(address)}>Remove</button></li>)}</ul>:<p>No tokens selected.</p>}
    <button type="button" className="tenx-button" disabled={selected.length<2} onClick={()=>setOpened(identity)}>Compare saved observations</button>{opened===identity&&selected.length>=2&&<ComparisonResults key={identity} addresses={selected} mode={mode}/>}</section>;
}
