import {useState,type ReactNode} from "react";
import type {CandidateCard} from "../../../discovery/src/candidate-card";
import {DEFAULT_POLICY} from "../../../discovery/src/model";
import {TokenImage} from "./TokenMarket";
import {creationAge,shortBlocker,tokenMoney} from "./TokenOverview";
import {marketSource,readableReason} from "./client";
import {ComparisonToggle} from "./TokenComparison";
import {ShortlistToggle,type useShortlist} from "./Shortlist";
import {defaults,discoveryViewParams,type DiscoveryView} from "./discovery-view";
import {tokenInspectHref} from "./discovery-return";
export {discoveryView,discoveryViewParams,type DiscoveryView} from "./discovery-view";

export function discoveryCandidatesUrl(view:DiscoveryView){const p=discoveryViewParams(view);p.delete("layout");p.delete("compare");p.set("age",view.mode==="fixture"?"all":view.age);p.set("limit","100");p.set("view","cards");p.set("browse","inventory");p.set("inventory","current");return `/api/10x/candidates?${p}`;}
export function advancedFilterCount(view:DiscoveryView){return Number(view.freshness!=="all")+Number(view.min_liquidity>0)+Number(view.min_coverage>0);}
export function DiscoveryWorkspaceControls({view,onChange,children}:{view:DiscoveryView;onChange:(view:DiscoveryView)=>void;children?:ReactNode}){
  const [search,setSearch]=useState(view.q),[liquidity,setLiquidity]=useState(String(view.min_liquidity)),[coverage,setCoverage]=useState(String(view.min_coverage));
  const change=(patch:Partial<DiscoveryView>)=>onChange({...view,...patch});
  return <form className="tenx-workspace-controls" onInvalidCapture={e=>{const details=(e.target as HTMLElement).closest("details");if(details)details.open=true;}} onSubmit={e=>{e.preventDefault();const min_liquidity=Number(liquidity),min_coverage=Number(coverage);if(!Number.isFinite(min_liquidity)||min_liquidity<0||min_liquidity>1e12||!Number.isFinite(min_coverage)||min_coverage<0||min_coverage>100)return;change({q:search.trim(),min_liquidity,min_coverage});}}>
    <div className="tenx-workspace-search"><label>Find a token<input type="search" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, symbol or exact mint" /></label><button className="tenx-button" type="submit">Search</button><button className="tenx-button tenx-button--quiet" type="button" onClick={()=>{setSearch("");setLiquidity("0");setCoverage("0");onChange({...defaults,mode:view.mode,layout:view.layout,age:view.age,compare:view.compare});}}>Reset filters</button></div>
    <div className="tenx-toolbar tenx-workspace-primary">
      <label>Sort by<select value={view.sort} onChange={e=>change({sort:e.target.value as DiscoveryView["sort"]})}><option value="score">Discovery score · highest first</option><option value="liquidity">Fresh reported liquidity</option></select></label>
      {view.mode==="live"&&<label>Inventory window<select value={view.age} onChange={e=>change({age:e.target.value as DiscoveryView["age"]})}><option value="24h">Past 24 hours · verified</option><option value="all">Current evaluation inventory</option></select></label>}
      <label>View<select value={view.layout} onChange={e=>change({layout:e.target.value as DiscoveryView["layout"]})}><option value="cards">Cards</option><option value="table">Compact table</option></select></label>
    </div>
    <details className="tenx-advanced-filters"><summary>Advanced filters · {advancedFilterCount(view)} active</summary><div className="tenx-toolbar">
      <label>Market snapshot<select value={view.freshness} onChange={e=>change({freshness:e.target.value as DiscoveryView["freshness"]})}><option value="all">Any freshness</option><option value="fresh">Fresh · within 3 minutes</option><option value="stale">Stale or future dated</option><option value="missing">Missing snapshot</option></select></label>
      <label>Min. reported liquidity ($)<input type="number" min={0} max={1e12} value={liquidity} onChange={e=>setLiquidity(e.target.value)} /></label>
      <label>Min. evidence coverage (%)<input type="number" min={0} max={100} value={coverage} onChange={e=>setCoverage(e.target.value)} /></label>
    </div><button className="tenx-button" type="submit">Apply advanced filters</button><p>Reported liquidity and evidence coverage do not establish organic demand or safety.</p></details>
    {children&&<div className="tenx-workspace-tools">{children}</div>}
  </form>;
}
const money=(n:number|null|undefined)=>n==null?"Unknown":tokenMoney(n);
export function DiscoveryTable({candidates,artwork,scoredAt,selected=[],onToggle=()=>{},shortlist,returnTo}:{candidates:CandidateCard[];artwork:Record<string,{image_url?:string|null}|null|undefined>;scoredAt:string|null;selected?:string[];onToggle?:(address:string)=>void;shortlist?:Pick<ReturnType<typeof useShortlist>,"state"|"save">;returnTo?:string}){
  const [copied,setCopied]=useState("");
  const cutoff=scoredAt?Date.parse(scoredAt):NaN;
  return <div className="tenx-table-scroll tenx-discovery-table" tabIndex={0} role="region" aria-label="Token comparison table"><table><caption>Saved observations at {scoredAt?new Date(scoredAt).toLocaleString():"an unknown cutoff"}. Reported volume is not verified organic demand. Qualified holder growth and recent momentum are not yet available in this table.</caption><thead><tr><th scope="col">Rank / token</th><th scope="col">Created</th><th scope="col">v4 score / coverage</th><th scope="col">Reported cap / liquidity</th><th scope="col">Reported 24h volume</th><th scope="col">Source / freshness</th><th scope="col">Main concern</th></tr></thead><tbody>{candidates.map(c=>{
    const fixture=c.mode==="fixture",link=tokenInspectHref(c.address,c.mode,returnTo),m=c.market,elapsed=m?cutoff-Date.parse(m.fetched_at):null;
    const fresh=elapsed!==null&&elapsed>=0&&elapsed<=DEFAULT_POLICY.max_market_age_seconds*1000&&(!m?.observed_at||Date.parse(m.observed_at)<=cutoff);
    const score=c.discovery_score,flag=score&&score.version!=="discovery-score-v1"?score.risk_flags[0]:null;
    return <tr key={c.address}><td><div className="tenx-table-token"><TokenImage url={m?.image_url} metadataUrl={artwork[c.address]?.image_url} metadataLoading={!fixture&&artwork[c.address]===undefined} name={c.name} symbol={c.symbol}/><div><a href={link}>{c.discovery_rank?`#${c.discovery_rank}`:"Rank unknown"} · {c.name}</a><small>{c.symbol}</small></div></div><details><summary>Mint & copy</summary><p className="tenx-address">{c.address}</p><button type="button" className="tenx-button tenx-button--quiet" onClick={()=>void navigator.clipboard.writeText(c.address).then(()=>setCopied(c.address)).catch(()=>setCopied(""))}>{copied===c.address?"Copied":"Copy mint"}</button></details><ComparisonToggle address={c.address} selected={selected} onToggle={onToggle}/>{shortlist&&<ShortlistToggle token={c} state={shortlist.state} onToggle={shortlist.save}/>}</td>
      <td>{creationAge(c.creation?.block_time,cutoff)}{c.creation&&<small>{new Date(c.creation.block_time).toLocaleString()}</small>}</td><td>{score?`${score.value} / 100`:"Unknown"}<small>{score?`${score.evidence_coverage}% evidence coverage`:"Coverage unknown"}</small></td>
      <td>{money(m?.market_cap_usd)}<small>{money(m?.liquidity_usd)} liquidity</small></td><td>{money(m?.volume_24h_usd)}<small>Provider window endpoint unknown</small><small>Organic share unknown</small></td>
      <td>{m?marketSource(m.source):"Missing snapshot"}<small>{m&&Number.isFinite(cutoff)?(fresh?"Fresh":"Stale or future dated"):"Unknown"}</small>{m&&<small>Fetched {new Date(m.fetched_at).toLocaleString()}</small>}</td><td>{flag?readableReason(flag.code):c.reasons[0]?shortBlocker(c.reasons[0]):"No supported concern in saved checks; safety not assured"}<small>{c.eligibility} action checks</small></td></tr>;
  })}</tbody></table></div>;
}
