import {futureTimeline,OriginalMemes} from './timeline';
import {products} from '../public-content.mjs';
import {FirstMeme} from './brand';
import {CategoryCompetition} from './performance';
import {QaTokenName,QaTokenDetails} from './qa-identity';
import {Diagnostics,TokenArt,useExperience} from './experience';
import { useRuntimeQuery } from './capabilities';
import { useEffect, useState } from 'react';
import { Link,useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FeePoint } from '../../contracts/client.mjs';
import { sdk } from './sdk';
import {RevealMore, Empty, Facts, Hero, Loaded, Panel, percent, usePageMeta, utc } from './common';
import { rootRoute } from './routes';
import type { Policy } from './models';
import { QuotePanel,quoteServices } from './quote-panel';

export function FeeChart({points}:{points:FeePoint[]}){
  const [index,setIndex]=useState(0);
  if(points.length<2)return <Panel title="Opening fee schedule"><p>The fee series is unavailable.</p></Panel>;
  const first=points[0],last=points[points.length-1],point=points[index]??first;
  const max=Math.max(...points.map(p=>p.feeBps),1);
  const xy=(p:FeePoint)=>[30+440*(p.elapsedSeconds-first.elapsedSeconds)/(last.elapsedSeconds-first.elapsedSeconds),
    122-100*p.feeBps/max];
  const path=points.map(p=>xy(p).join(',')).join(' ');
  const [x,y]=xy(point);
  return <section className="chart-panel">
    <div className="chart-head"><div><h2>Opening fee schedule</h2><p>Elapsed time from market activation</p></div>
      <strong id="curve-value">{percent(point.feeBps)}</strong></div>
    <svg viewBox="0 0 500 151" role="img" aria-label={'Opening fee falls from '+percent(first.feeBps)+' to '+percent(last.feeBps)}>
      <path d="M30 22H470M30 72H470M30 122H470" className="grid-line"/>
      <polygon points={'30,122 '+path+' 470,122'} className="chart-fill"/><polyline points={path} className="chart-line"/>
      <circle cx={x} cy={y} r="5.5" className="chart-pin"/><text x="30" y="145">{first.elapsedSeconds}s</text>
      <text x="470" y="145" textAnchor="end">{last.elapsedSeconds}s</text>
    </svg>
    <label htmlFor="curve-seconds" className="range-label">Explore the schedule <output>{point.elapsedSeconds} seconds</output></label>
    <input type="range" id="curve-seconds" value={index} min="0" max={points.length-1}
      aria-valuetext={point.elapsedSeconds+' seconds, '+percent(point.feeBps)+' fee'} onChange={e=>setIndex(Number(e.target.value))}/>
  </section>;
}
const categories=[
  ['liquidity','Pool liquidity','#b6d94b'],['earn','Earn rewards','#72996c'],['stake','Staking rewards','#355444'],
  ['genesisVault',products.genesis.name+' Vault','#5c8394'],['seasonVault',products.season.name+' Vault','#777bab'],
] as const;
function Allocation({policy}:{policy:Policy}){
  let offset=0;
  const segments=categories.map(([key,label,color])=>{
    const bps=policy.launch.allocationBps[key],start=offset;offset+=bps;
    return {key,label,color,bps,start};
  });
  return <Panel title="Daily Attention Token allocation">
    <svg viewBox="0 0 10000 100" preserveAspectRatio="none" className="allocation-bar" aria-hidden="true">
      {segments.map(s=><rect key={s.key} x={s.start} width={s.bps} height="100" fill={s.color}/>)}
    </svg>
    <dl className="facts allocations">{segments.map(s=><div key={s.key}><dt><svg width="10" height="10" aria-hidden="true">
      <rect width="10" height="10" rx="2" fill={s.color}/></svg>{s.label}</dt><dd>{percent(s.bps)}</dd></div>)}</dl><p>These allocations apply to daily Attention Tokens. If the seasonal vault is inactive, its share goes to the permanent NFT vault. The $10X allocation remains open.</p>
  </Panel>;
}
export function MarketDetail({id}:{id:string}){
  const market=useRuntimeQuery('/api/v1/markets/{id}',{queryKey:['market',id],queryFn:({signal})=>sdk.market(id,signal)});
  return <><Panel title="Market details"><Loaded query={market}>{m=><>
    <div className="entry-head"><h3>{m.symbol} / {m.ogSymbol}</h3></div><QaTokenDetails id={m.id}/>
    <Facts items={[['Product',products.attention.name],['Chain','Solana'],['Status',m.status],['Activated',utc(m.activatedAt)],['Current fee',percent(m.feeBps)],
      ['ATT mint',m.attMint],['Selected meme mint',m.ogMint],['Pool',m.poolAddress]]}/>
    <Link to="/stake" search={{farm:m.id}}>Stake this token →</Link>
  </>}</Loaded></Panel>{market.data&&<QuotePanel marketId={id} symbol={market.data.symbol} ogSymbol={market.data.ogSymbol} services={quoteServices}/>}</>;
}
export function Markets(){
  const {market,cursor,tokenQuery,tokenStatus}=rootRoute.useSearch(),navigate=useNavigate();
  const status=tokenStatus==='active'||tokenStatus==='campaign-ended'||tokenStatus==='scheduled'?tokenStatus:'all';
  const q=(tokenQuery??'').slice(0,64);
  const [queryText,setQueryText]=useState(q);
  useEffect(()=>setQueryText(q),[q]);
  const {technical}=useExperience(),[visible,setVisible]=useState(6);
  useEffect(()=>setVisible(6),[cursor,q,status]);
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal),staleTime:120_000});
  const schedule=useRuntimeQuery('/api/v1/launch/fee-schedule',{queryKey:['fee-schedule'],queryFn:({signal})=>sdk.curve(signal),staleTime:120_000});
  const markets=useRuntimeQuery('/api/v1/markets',{queryKey:['markets',cursor,q,status],queryFn:({signal})=>sdk.markets(cursor,signal,{q:q||undefined,status:status==='all'?undefined:status})});
  usePageMeta('Tokens','Explore 10X Memes first, then separate Attention Tokens and their selected meme pairs.',market?'/markets/'+encodeURIComponent(market):'/tokens',true);
  return <>
    <Hero title="Tokens">Original memecoins. New discoveries.</Hero>
    {futureTimeline?<OriginalMemes/>:<FirstMeme/>}
    <div className="catalog-header" id="attention-tokens"><h2>{products.attention.plural}</h2><p>Separate tokens. Campaigns around selected memes.</p></div>
    <Diagnostics><div className="market-grid"><Loaded query={schedule}>{points=><FeeChart points={points}/>}</Loaded>
      <Loaded query={policy}>{p=><Allocation policy={p}/>}</Loaded></div></Diagnostics>
    {(!!markets.data?.items.length||!!cursor||!!q||status!=='all')&&<form className="token-filters" onSubmit={e=>{e.preventDefault();void navigate({to:'/tokens',search:{tokenQuery:queryText.trim()||undefined,tokenStatus:status==='all'?undefined:status},hash:'attention-tokens'});}}>
      <label>Find a token<input type="search" value={queryText} maxLength={64} onChange={e=>setQueryText(e.target.value)} placeholder="Search token or meme"/></label>
      <label>Campaign<select value={status} onChange={e=>void navigate({to:'/tokens',search:{tokenQuery:queryText.trim()||undefined,tokenStatus:e.target.value==='all'?undefined:e.target.value},hash:'attention-tokens'})}><option value="all">All campaigns</option><option value="active">Active campaigns</option><option value="campaign-ended">Ended campaigns</option><option value="scheduled">Upcoming campaigns</option></select></label>
      <button type="submit">Search</button>{(q||status!=='all')&&<Link to="/tokens" hash="attention-tokens">Clear filters</Link>}
    </form>}
    {market && <MarketDetail id={market}/>}
    <Panel className={!markets.data&&!markets.isError&&(markets.availability.pending||markets.availability.allowed)?'catalog-loading':''}><Loaded query={markets}>{page=><>
      {page.items.length?<ul className="rows">{page.items.slice(0,technical?page.items.length:visible).map(m=><li className="token-list-item" key={m.id}><Link to="/markets/$marketId" params={{marketId:m.id}}>
        <TokenArt name={m.id}/><strong><QaTokenName id={m.id} fallback={<>{m.symbol} <small>/ {m.ogSymbol}</small></>}/></strong><span className="token-status">{m.status==='active'?'Active':m.status==='campaign-ended'?'Ended':m.status}</span>
      </Link>{m.status==='active'&&<Link className="stake-link" to="/stake" search={{farm:m.id}}>Stake <QaTokenName id={m.id} fallback={m.symbol} compact/></Link>}</li>)}</ul>:<Empty title={q||status!=='all'?'No matching tokens':'No tokens yet'}>{q||status!=='all'?'Try another token or clear the filters.':'Separate Attention Token / selected meme pairs appear here when campaign data is available.'}</Empty>}
      {!technical&&visible<page.items.length&&<RevealMore items=".token-list-item" shown={visible} onReveal={()=>setVisible(n=>n+10)}>Show more tokens on this page ({visible} of {page.items.length})</RevealMore>}
      <div className="catalog-pagination">{cursor&&<Link to="/tokens" search={{tokenQuery:q||undefined,tokenStatus:status==='all'?undefined:status}} hash="attention-tokens">First page</Link>}{page.nextCursor && <Link to="/tokens" search={{cursor:page.nextCursor,tokenQuery:q||undefined,tokenStatus:status==='all'?undefined:status}} hash="attention-tokens">Next campaigns →</Link>}</div>
    </>}</Loaded></Panel>
    <CategoryCompetition category="tokens"/>
  </>;
}
