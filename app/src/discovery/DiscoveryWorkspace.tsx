import {useState} from "react";
import type {CandidateCard} from "../../../discovery/src/candidate-card";
import {DEFAULT_POLICY} from "../../../discovery/src/model";
import {TokenImage} from "./TokenMarket";
import {creationAge,shortBlocker,tokenMoney} from "./TokenOverview";
import {marketSource,readableReason} from "./client";
import {ComparisonToggle,comparisonSelection} from "./TokenComparison";
import {ShortlistToggle,type useShortlist} from "./Shortlist";

export type DiscoveryView={mode:"live"|"fixture";status:"all"|"eligible"|"provisional"|"excluded";age:"24h"|"all";sort:"score"|"liquidity";layout:"cards"|"table";q:string;freshness:"all"|"fresh"|"stale"|"missing";min_liquidity:number;min_coverage:number;compare:string[]};
const defaults:DiscoveryView={mode:"live",status:"all",age:"24h",sort:"score",layout:"cards",q:"",freshness:"all",min_liquidity:0,min_coverage:0,compare:[]};
export function discoveryView(search:string):DiscoveryView{
  const p=new URLSearchParams(search), choice=<K extends keyof DiscoveryView>(key:K,values:readonly DiscoveryView[K][])=>values.includes(p.get(key) as DiscoveryView[K])?p.get(key) as DiscoveryView[K]:defaults[key];
  const number=(key:"min_liquidity"|"min_coverage",max:number)=>{const n=Number(p.get(key));return Number.isFinite(n)&&n>=0&&n<=max?n:0;};
  return {mode:choice("mode",["live","fixture"]),status:choice("status",["all","eligible","provisional","excluded"]),age:choice("age",["24h","all"]),sort:choice("sort",["score","liquidity"]),layout:choice("layout",["cards","table"]),q:(p.get("q")??"").trim().slice(0,100),freshness:choice("freshness",["all","fresh","stale","missing"]),min_liquidity:number("min_liquidity",1e12),min_coverage:number("min_coverage",100),compare:comparisonSelection(p.get("compare"))};
}
export function discoveryViewParams(view:DiscoveryView){return new URLSearchParams(Object.entries(view).map(([k,v])=>[k,String(v)]));}
export function discoveryCandidatesUrl(view:DiscoveryView){const p=discoveryViewParams(view);p.delete("layout");p.delete("compare");p.set("age",view.mode==="fixture"?"all":view.age);p.set("limit","100");p.set("view","cards");p.set("browse","inventory");p.set("inventory","current");return `/api/10x/candidates?${p}`;}
export function DiscoveryWorkspaceControls({view,onChange}:{view:DiscoveryView;onChange:(view:DiscoveryView)=>void}){
  const [search,setSearch]=useState(view.q),[liquidity,setLiquidity]=useState(String(view.min_liquidity)),[coverage,setCoverage]=useState(String(view.min_coverage));
  const change=(patch:Partial<DiscoveryView>)=>onChange({...view,...patch});
  return <form className="tenx-workspace-controls" onSubmit={e=>{e.preventDefault();const min_liquidity=Number(liquidity),min_coverage=Number(coverage);if(!Number.isFinite(min_liquidity)||min_liquidity<0||min_liquidity>1e12||!Number.isFinite(min_coverage)||min_coverage<0||min_coverage>100)return;change({q:search.trim(),min_liquidity,min_coverage});}}>
    <div className="tenx-workspace-search"><label>Find a token<input type="search" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, symbol or exact mint" /></label><button className="tenx-button" type="submit">Apply search & filters</button><button className="tenx-button tenx-button--quiet" type="button" onClick={()=>onChange({...defaults,mode:view.mode,layout:view.layout,age:view.age,compare:view.compare})}>Clear filters</button></div>
    <div className="tenx-toolbar">
      <label>Sort by<select value={view.sort} onChange={e=>change({sort:e.target.value as DiscoveryView["sort"]})}><option value="score">Discovery score · highest first</option><option value="liquidity">Fresh reported liquidity</option></select></label>
      {view.mode==="live"&&<label>Inventory window<select value={view.age} onChange={e=>change({age:e.target.value as DiscoveryView["age"]})}><option value="24h">Past 24 hours · verified</option><option value="all">Current evaluation inventory</option></select></label>}
      <label>Market snapshot<select value={view.freshness} onChange={e=>change({freshness:e.target.value as DiscoveryView["freshness"]})}><option value="all">Any freshness</option><option value="fresh">Fresh · within 3 minutes</option><option value="stale">Stale or future dated</option><option value="missing">Missing snapshot</option></select></label>
      <label>Min. reported liquidity ($)<input type="number" min={0} max={1e12} value={liquidity} onChange={e=>setLiquidity(e.target.value)} /></label>
      <label>Min. evidence coverage (%)<input type="number" min={0} max={100} value={coverage} onChange={e=>setCoverage(e.target.value)} /></label>
      <label>View<select value={view.layout} onChange={e=>change({layout:e.target.value as DiscoveryView["layout"]})}><option value="cards">Cards</option><option value="table">Compact table</option></select></label>
    </div>
  </form>;
}
const money=(n:number|null|undefined)=>n==null?"Unknown":tokenMoney(n);
export function DiscoveryTable({candidates,artwork,scoredAt,selected=[],onToggle=()=>{},shortlist}:{candidates:CandidateCard[];artwork:Record<string,{image_url?:string|null}|null|undefined>;scoredAt:string|null;selected?:string[];onToggle?:(address:string)=>void;shortlist?:Pick<ReturnType<typeof useShortlist>,"state"|"save">}){
  const [copied,setCopied]=useState("");
  const cutoff=scoredAt?Date.parse(scoredAt):NaN;
  return <div className="tenx-table-scroll tenx-discovery-table" tabIndex={0} role="region" aria-label="Token comparison table"><table><caption>Saved observations at {scoredAt?new Date(scoredAt).toLocaleString():"an unknown cutoff"}. Reported volume is not verified organic demand. Qualified holder growth and recent momentum are not yet available in this table.</caption><thead><tr><th scope="col">Rank / token</th><th scope="col">Created</th><th scope="col">v4 score / coverage</th><th scope="col">Reported cap / liquidity</th><th scope="col">Reported 24h volume</th><th scope="col">Source / freshness</th><th scope="col">Main concern</th></tr></thead><tbody>{candidates.map(c=>{
    const fixture=c.mode==="fixture",link=`/token/solana/${c.address}${fixture?"?mode=fixture":""}`,m=c.market,elapsed=m?cutoff-Date.parse(m.fetched_at):null;
    const fresh=elapsed!==null&&elapsed>=0&&elapsed<=DEFAULT_POLICY.max_market_age_seconds*1000&&(!m?.observed_at||Date.parse(m.observed_at)<=cutoff);
    const score=c.discovery_score,flag=score&&score.version!=="discovery-score-v1"?score.risk_flags[0]:null;
    return <tr key={c.address}><td><div className="tenx-table-token"><TokenImage url={m?.image_url} metadataUrl={artwork[c.address]?.image_url} metadataLoading={!fixture&&artwork[c.address]===undefined} name={c.name} symbol={c.symbol}/><div><a href={link}>{c.discovery_rank?`#${c.discovery_rank}`:"Rank unknown"} · {c.name}</a><small>{c.symbol}</small></div></div><details><summary>Mint & copy</summary><p className="tenx-address">{c.address}</p><button type="button" className="tenx-button tenx-button--quiet" onClick={()=>void navigator.clipboard.writeText(c.address).then(()=>setCopied(c.address)).catch(()=>setCopied(""))}>{copied===c.address?"Copied":"Copy mint"}</button></details><ComparisonToggle address={c.address} selected={selected} onToggle={onToggle}/>{shortlist&&<ShortlistToggle token={c} state={shortlist.state} onToggle={shortlist.save}/>}</td>
      <td>{creationAge(c.creation?.block_time,cutoff)}{c.creation&&<small>{new Date(c.creation.block_time).toLocaleString()}</small>}</td><td>{score?`${score.value} / 100`:"Unknown"}<small>{score?`${score.evidence_coverage}% evidence coverage`:"Coverage unknown"}</small></td>
      <td>{money(m?.market_cap_usd)}<small>{money(m?.liquidity_usd)} liquidity</small></td><td>{money(m?.volume_24h_usd)}<small>Provider window endpoint unknown</small><small>Organic share unknown</small></td>
      <td>{m?marketSource(m.source):"Missing snapshot"}<small>{m&&Number.isFinite(cutoff)?(fresh?"Fresh":"Stale or future dated"):"Unknown"}</small>{m&&<small>Fetched {new Date(m.fetched_at).toLocaleString()}</small>}</td><td>{flag?readableReason(flag.code):c.reasons[0]?shortBlocker(c.reasons[0]):"No supported concern in saved checks; safety not assured"}<small>{c.eligibility} action checks</small></td></tr>;
  })}</tbody></table></div>;
}
