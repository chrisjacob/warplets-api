import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FeePoint } from '../../contracts/client.mjs';
import { sdk } from './sdk';
import { Empty, Facts, Hero, Loaded, Panel, percent, usePageMeta, utc } from './common';
import { rootRoute } from './routes';
import type { Policy } from './models';

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
  const market=useQuery({queryKey:['market',id],queryFn:({signal})=>sdk.market(id,signal)});
  return <Panel title="Market details"><Loaded query={market}>{m=><>
    <div className="entry-head"><h3>{m.symbol} / {m.ogSymbol}</h3><span>Local fixture</span></div>
    <Facts items={[['Status',m.status],['Activated',utc(m.activatedAt)],['Current fee',percent(m.feeBps)],
      ['ATT mint',m.attMint],['Original token mint',m.ogMint],['Pool',m.poolAddress]]}/>
    <Link to="/stake" search={{farm:m.id}}>Inspect farm ↗</Link>
  </>}</Loaded></Panel>;
}
export function Markets(){
  const {market,cursor}=rootRoute.useSearch();
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal),staleTime:120_000});
  const schedule=useQuery({queryKey:['fee-schedule'],queryFn:({signal})=>sdk.curve(signal),staleTime:120_000});
  const markets=useQuery({queryKey:['markets',cursor],queryFn:({signal})=>sdk.markets(cursor,signal)});
  usePageMeta('Markets','Explore curated Solana attention tokens and their original-token pairs.',market?'/markets/'+encodeURIComponent(market):'/markets',true);
  return <>
    <Hero title="Markets">Explore curated Solana attention tokens and the original tokens they pair with.</Hero>
    <div className="market-grid"><Loaded query={schedule}>{points=><FeeChart points={points}/>}</Loaded>
      <Loaded query={policy}>{p=><Allocation policy={p}/>}</Loaded></div>
    {market && <MarketDetail id={market}/>}
    <Panel title="Campaigns"><Loaded query={markets}>{page=><>
      {page.items.length?<ul className="rows">{page.items.map(m=><li key={m.id}><Link to="/markets/$marketId" params={{marketId:m.id}}>
        <strong>{m.symbol} <small>/ {m.ogSymbol}</small></strong><span>{m.status} · local fixture ↗</span>
      </Link></li>)}</ul>:<Empty title="No markets yet">Curated ATT/OG pairs appear here once a campaign opens.</Empty>}
      {page.nextCursor && <Link to="/markets" search={{cursor:page.nextCursor}}>Next campaigns →</Link>}
    </>}</Loaded></Panel>
  </>;
}
