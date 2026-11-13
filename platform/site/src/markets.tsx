import {CategoryCompetition} from './performance';
import {Diagnostics,TokenArt,Journey,useExperience} from './experience';
import { useRuntimeQuery } from './capabilities';
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FeePoint } from '../../contracts/client.mjs';
import { sdk } from './sdk';
import { Empty, Facts, Hero, Loaded, Panel, percent, usePageMeta, utc } from './common';
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
  ['genesisVault','Genesis Vault','#5c8394'],['seasonVault','Season Vault','#777bab'],
] as const;
function Allocation({policy}:{policy:Policy}){
  let offset=0;
  const segments=categories.map(([key,label,color])=>{
    const bps=policy.launch.allocationBps[key],start=offset;offset+=bps;
    return {key,label,color,bps,start};
  });
  return <Panel title="Launch allocation">
    <svg viewBox="0 0 10000 100" preserveAspectRatio="none" className="allocation-bar" aria-hidden="true">
      {segments.map(s=><rect key={s.key} x={s.start} width={s.bps} height="100" fill={s.color}/>)}
    </svg>
    <dl className="facts allocations">{segments.map(s=><div key={s.key}><dt><svg width="10" height="10" aria-hidden="true">
      <rect width="10" height="10" rx="2" fill={s.color}/></svg>{s.label}</dt><dd>{percent(s.bps)}</dd></div>)}</dl>
  </Panel>;
}
export function MarketDetail({id}:{id:string}){
  const market=useRuntimeQuery('/api/v1/markets/{id}',{queryKey:['market',id],queryFn:({signal})=>sdk.market(id,signal)});
  return <><Panel title="Market details"><Loaded query={market}>{m=><>
    <div className="entry-head"><h3>{m.symbol} / {m.ogSymbol}</h3><span>Local fixture</span></div>
    <Facts items={[['Status',m.status],['Activated',utc(m.activatedAt)],['Current fee',percent(m.feeBps)],
      ['ATT mint',m.attMint],['Original token mint',m.ogMint],['Pool',m.poolAddress]]}/>
    <Link to="/stake" search={{farm:m.id}}>Stake this token →</Link>
  </>}</Loaded></Panel>{market.data&&<QuotePanel marketId={id} symbol={market.data.symbol} ogSymbol={market.data.ogSymbol} services={quoteServices}/>}</>;
}
export function Markets(){
  const {market,cursor}=rootRoute.useSearch();
  const {technical}=useExperience(),[visible,setVisible]=useState(10);
  useEffect(()=>setVisible(10),[cursor]);
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal),staleTime:120_000});
  const schedule=useRuntimeQuery('/api/v1/launch/fee-schedule',{queryKey:['fee-schedule'],queryFn:({signal})=>sdk.curve(signal),staleTime:120_000});
  const markets=useRuntimeQuery('/api/v1/markets',{queryKey:['markets',cursor],queryFn:({signal})=>sdk.markets(cursor,signal)});
  usePageMeta('Tokens','Explore curated Solana attention tokens and their original-token pairs.',market?'/markets/'+encodeURIComponent(market):'/tokens',true);
  return <>
    <Hero title="Tokens">Discover attention tokens. Find a community, explore its token, and see what you can earn.</Hero>
    <Journey steps={[['Discover a project','Explore Attention Tokens and the projects behind them.'],['Get to know its token','Review the token pair, fees and campaign details.'],['Take part','Stake the corresponding Attention Token to join its content campaign.']]}/>
    <Diagnostics><div className="market-grid"><Loaded query={schedule}>{points=><FeeChart points={points}/>}</Loaded>
      <Loaded query={policy}>{p=><Allocation policy={p}/>}</Loaded></div></Diagnostics>
    {market && <MarketDetail id={market}/>}
    <Panel title="Explore tokens"><Loaded query={markets}>{page=><>
      {page.items.length?<ul className="rows">{page.items.slice(0,technical?page.items.length:visible).map(m=><li className="token-list-item" key={m.id}><Link to="/markets/$marketId" params={{marketId:m.id}}>
        <TokenArt name={m.symbol}/><strong>{m.symbol} <small>/ {m.ogSymbol}</small></strong><span>{m.status} · Explore →</span>
      </Link><Link className="stake-link" to="/stake" search={{farm:m.id}}>Stake {m.symbol} →</Link></li>)}</ul>:<Empty title="No tokens yet">Curated ATT/OG pairs appear here once a campaign opens.</Empty>}
      {!technical&&visible<page.items.length&&<button onClick={()=>setVisible(n=>n+10)}>Show more tokens on this page ({visible} of {page.items.length})</button>}
      {page.nextCursor && <Link to="/tokens" search={{cursor:page.nextCursor}}>Next campaigns →</Link>}
    </>}</Loaded></Panel>
    <CategoryCompetition category="tokens"/>
  </>;
}
