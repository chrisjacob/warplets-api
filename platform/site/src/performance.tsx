import {PerformanceGrowth} from './performance-growth';
import {useCapability} from './capabilities';
import {useEffect,useState} from 'react';
import {Link,useParams} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {compact,Hero,Panel,ShareLink,usePageMeta,utc} from './common';
import {TokenArt} from './experience';
import {dollarsMicros,tokenUnits} from './amounts';
import {useSession} from './session';

export const categories=['tokens','nfts','airdrops','stake','earn'] as const;
export type Category=typeof categories[number];
export type ValuationMode='peak'|'market';
const units=z.string().regex(/^\d+$/).max(100),amount=units.nullable();
const category=z.enum(categories);
const token=z.object({tokenId:z.string(),symbol:z.string(),decimals:z.number().int().min(0).max(18),awardedUnits:units,claimableUnits:units});
export const performanceRow=z.object({rank:z.number().int().positive(),participantId:z.string(),wallet:z.string().nullable(),label:z.string(),peakUsdMicros:amount,marketUsdMicros:amount,tokenCount:z.number().int().nonnegative(),allocationCount:z.number().int().nonnegative(),awardedTokens:z.array(token).max(3),multiple:z.string().regex(/^\d+(\.\d+)?$/).nullable()});
export const performanceBoard=z.object({mode:z.literal('synthetic-local'),asOf:z.iso.datetime(),category,valuationMode:z.enum(['peak','market']),totalParticipants:z.number().int().nonnegative(),unrankedCount:z.number().int().nonnegative(),items:z.array(performanceRow).max(100),myRank:performanceRow.nullable()});
export const performanceProfile=z.object({mode:z.literal('synthetic-local'),asOf:z.iso.datetime(),wallet:z.string(),label:z.string(),tokenCount:z.number().int().nonnegative(),allocationCount:z.number().int().nonnegative(),activeDays:z.number().int().nonnegative(),firstAwardAt:z.iso.datetime().nullable(),history:z.array(z.object({id:z.string(),category:z.enum(['nfts','stake','earn']),tokenId:z.string(),symbol:z.string(),decimals:z.number().int().min(0).max(18),awardedUnits:units,awardedAt:z.iso.datetime()})).max(5),peakUsdMicros:amount,marketUsdMicros:amount,valuationComplete:z.boolean(),historyIncomplete:z.boolean(),categories:z.array(z.object({category:z.enum(['nfts','stake','earn']),peakUsdMicros:amount,marketUsdMicros:amount,allocationCount:z.number().int().nonnegative()})),ranks:z.object({airdrops:z.number().int().positive().nullable(),nfts:z.number().int().positive().nullable(),stake:z.number().int().positive().nullable(),earn:z.number().int().positive().nullable()}),items:z.array(token.extend({peakUsdMicros:amount,marketUsdMicros:amount})).max(20),nextCursor:z.string().nullable()});
export const categoryLabels:Record<Category,string>={tokens:'Tokens',nfts:'NFTs',airdrops:'Airdrops',stake:'Stake',earn:'Earn'};
export function usd(raw:string|null){return raw===null?'Unavailable':BigInt(raw)>0n&&BigInt(raw)<10000n?'< US$0.01':dollarsMicros(raw);}
async function read<T extends z.ZodType>(path:string,model:T,signal:AbortSignal):Promise<z.output<T>>{
 const response=await fetch('/api/v1/performance/'+path,{signal,credentials:'same-origin'});
 if(!response.ok)throw Error(response.status===404||response.status===503?'Performance data is not available in this preview yet.':'Performance data could not be loaded. Please try again.');
 const value=await response.json();return model.parse(value.data??value);
}
function usePerformanceQuery<T extends z.ZodType>(path:string,model:T,queryKey:readonly unknown[],staleTime=30000){
 const capability=useCapability('GET','/api/v1/performance/'+path.split('?')[0]);
 const query=useQuery({queryKey,queryFn:({signal})=>read(path,model,signal),enabled:capability.allowed,retry:false,staleTime});
 return {...query,isError:query.isError||(!capability.pending&&!capability.allowed),refetch:()=>capability.allowed?query.refetch():capability.refresh()};
}
function Failure({retry}:{retry:()=>void}){return <div className="performance-unavailable" role="status"><p>Performance data is unavailable. Missing prices are never shown as zero.</p><button onClick={retry}>Try again</button></div>;}
export function ValuationDisclosure(){return <p className="valuation-disclosure">Peak uses each token’s historical high, even before the reward was awarded. Market uses the snapshot price. Both value lifetime awarded tokens—not cash proceeds or the amount you still hold. Liquidity and fees affect what can be sold.</p>;}
function ModeSwitch({mode,change}:{mode:ValuationMode;change:(mode:ValuationMode)=>void}){return <div className="valuation-switch" role="group" aria-label="Performance valuation"><button aria-pressed={mode==='peak'} onClick={()=>change('peak')}>Peak</button><button aria-pressed={mode==='market'} onClick={()=>change('market')}>Market</button></div>;}
function RankingRow({row,mode,category:kind,own=false}:{row:z.infer<typeof performanceRow>;mode:ValuationMode;category:Category;own?:boolean}){
 const metric=mode==='peak'?row.peakUsdMicros:row.marketUsdMicros;
 const link=kind==='tokens'?<Link to="/markets/$marketId" params={{marketId:row.participantId}}>{row.label}</Link>:row.wallet?<Link to="/participants/$wallet" params={{wallet:row.wallet}}>{row.label}</Link>:row.label;
 return <li className={'performance-row'+(own?' is-you':'')}><span className="rank-number">#{row.rank}</span><TokenArt name={row.participantId}/><div className="rank-identity"><strong>{link}{own&&<span className="you-badge">You</span>}</strong>
  {kind==='tokens'?<small>{mode==='peak'?'Peak':'Market'} FDV · {usd(metric)}</small>:<small>{row.awardedTokens[0]?tokenUnits(row.awardedTokens[0].awardedUnits,row.awardedTokens[0].decimals)+' '+row.awardedTokens[0].symbol:'No awarded quantity'}{row.tokenCount>1?' + '+(row.tokenCount-1)+' other tokens':''}</small>}</div>
  <strong className="rank-value">{kind==='tokens'?(row.multiple===null?'Unavailable':row.multiple.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')+'X'):usd(metric)}</strong></li>;
}
export function PerformanceBoard({category:kind,preview=false}:{category:Category;preview?:boolean}){
 const {wallet}=useSession(),[mode,setMode]=useState<ValuationMode>('peak'),[page,setPage]=useState(0);
 const query=usePerformanceQuery('boards/'+kind+'?mode='+mode+'&limit='+(preview?3:100),performanceBoard,[wallet?'private':'public',wallet,'performance',kind,mode,preview]);
 const change=(value:ValuationMode)=>{setPage(0);setMode(value);};
 const data=query.data,rows=data?.items.slice(preview?0:page*10,preview?3:(page+1)*10)??[];
 const metric=kind==='tokens'?(mode==='peak'?'ATH / launch multiple':'Market / launch multiple'):(mode==='peak'?'Peak USD rewards':'Market USD rewards');
 return <section className={'performance-board'+(preview?' mini-board':'')} aria-label={categoryLabels[kind]+' performance leaderboard'}>
  <div className="performance-heading"><h3>{preview?'Top 3':'Top 100'} · {kind==='tokens'?'token performance':'reward recipients'}</h3><ModeSwitch mode={mode} change={change}/></div>
  <p className="ranking-label">Ranked by {metric}</p>
  {query.isError?<Failure retry={()=>void query.refetch()}/>:!data?<p role="status">Loading performance…</p>:<>
   <p className="fixture-label">Synthetic QA snapshot · {utc(data.asOf)}</p>
   {rows.length?<ol className="performance-list">{rows.map(row=><RankingRow key={row.participantId} row={row} category={kind} mode={mode} own={row.wallet===wallet}/>)}</ol>:<p>No ranked results with complete pricing in this snapshot.</p>}
   {!preview&&data.items.length>10&&<div className="board-pagination"><button onClick={()=>setPage(n=>n-1)} disabled={page===0}>Previous ranks</button><span aria-live="polite">{page*10+1}–{Math.min((page+1)*10,data.items.length)} of {data.items.length}</span><button onClick={()=>setPage(n=>n+1)} disabled={(page+1)*10>=data.items.length}>Next ranks</button></div>}
   {!preview&&data.myRank&&data.myRank.rank>100&&<div className="own-rank"><h4>Your position</h4><ol className="performance-list"><RankingRow row={data.myRank} mode={mode} category={kind} own/></ol></div>}
   {preview&&<p className="muted">{data.totalParticipants.toLocaleString()} {kind==='tokens'?'tokens':'participants'} in this snapshot</p>}
   {!preview&&<p className="muted">{data.totalParticipants.toLocaleString()} {kind==='tokens'?'tokens':'participants'} · {data.unrankedCount.toLocaleString()} awaiting complete pricing.{kind!=='tokens'&&' All-time awarded quantities.'}</p>}
  </>}
  {!preview&&(kind==='tokens'?<p className="valuation-disclosure">Peak ranks ATH price divided by launch price; Market ranks snapshot price divided by launch price. FDV values the full token supply. Neither FDV nor a price multiple is personal profit, available liquidity or guaranteed sale proceeds.</p>:<ValuationDisclosure/>)}
 </section>;
}
export function CategoryCompetition({category}:{category:Category}){return <div id={'performance-'+category}><Panel title="Compete" className="competition-panel"><PerformanceBoard category={category}/></Panel></div>;}
export function RewardSummary({wallet}:{wallet:string}){
 const q=usePerformanceQuery('profiles/'+encodeURIComponent(wallet)+'?limit=20',performanceProfile,['private',wallet,'performance-profile',wallet]);
 return <Panel title="Your lifetime rewards">{q.isError?<Failure retry={()=>void q.refetch()}/>:!q.data?<p role="status">Loading your reward history…</p>:<>
 <p className="fixture-label">Synthetic QA snapshot · {utc(q.data.asOf)}</p><div className="valuation-totals"><div><small>Peak valuation</small><strong>{usd(q.data.peakUsdMicros)}</strong></div><div><small>Market valuation</small><strong>{usd(q.data.marketUsdMicros)}</strong></div></div>
 {!q.data.valuationComplete&&<p>Pricing is incomplete. A complete total cannot be shown.</p>}
 <p>This read-only QA history uses a frozen snapshot. Current transaction-rehearsal balances appear below.</p><p>NFT, Stake and Earn awards are counted once. Claimable amounts are separate from these lifetime valuations.</p><Link to="/participants/$wallet" params={{wallet}}>View your reward breakdown →</Link><ValuationDisclosure/>
 </>}</Panel>;
}
export function Participant(){
 const {wallet}=useParams({from:'/participants/$wallet'}),[cursor,setCursor]=useState<string>(),[prior,setPrior]=useState<(string|undefined)[]>([]),[mode,setMode]=useState<ValuationMode>('peak');
 useEffect(()=>{setCursor(undefined);setPrior([]);},[wallet]);
 const query=usePerformanceQuery('profiles/'+encodeURIComponent(wallet)+'?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''),performanceProfile,['public','performance-profile',wallet,cursor]);
 usePageMeta('Participant rewards','Lifetime token awards and theoretical reward valuations.','/participants/'+encodeURIComponent(wallet));
 const p=query.data;
 return <><Hero title={p?.label??'Participant rewards'}>Public reward history across NFTs, Stake and Earn. Awarded quantities, valuations and claimability stay separate.</Hero>
 {query.isError?<Panel><Failure retry={()=>void query.refetch()}/></Panel>:!p?<p role="status">Loading reward history…</p>:<>
 <Panel title="Lifetime awards"><p className="fixture-label">Synthetic QA participant · {compact(p.wallet)} · {utc(p.asOf)}</p><div className="valuation-totals"><div><small>Peak valuation</small><strong>{usd(p.peakUsdMicros)}</strong></div><div><small>Market valuation</small><strong>{usd(p.marketUsdMicros)}</strong></div></div>{!p.valuationComplete&&<p>Complete pricing is unavailable; totals are withheld.</p>}<ValuationDisclosure/></Panel>
 <Panel title="Where rewards came from"><ModeSwitch mode={mode} change={setMode}/><div className="reward-categories">{p.categories.map(c=><article key={c.category}><h3>{categoryLabels[c.category]}</h3><strong>{usd(mode==='peak'?c.peakUsdMicros:c.marketUsdMicros)}</strong><p>{c.allocationCount.toLocaleString()} awards · Peak rank {p.ranks[c.category]?'#'+p.ranks[c.category]:'unavailable'}</p><Link to={'/'+c.category as '/nfts'}>Explore {categoryLabels[c.category]} →</Link></article>)}</div><p>Consolidated Airdrops Peak rank: {p.ranks.airdrops?'#'+p.ranks.airdrops:'unavailable'}. Category awards are counted once in the total.</p></Panel>
 <PerformanceGrowth {...p}/><Panel title="Token breakdown"><p>Lifetime awards include claimed tokens. Claimable is the remaining unlocked quantity in this synthetic history, separate from the transaction-rehearsal balances elsewhere in the demo.</p><div className="profile-tokens">{p.items.map(t=><article key={t.tokenId}><div className="entry-head"><h3>{t.symbol}</h3><TokenArt name={t.tokenId}/></div><dl className="facts"><div><dt>Awarded</dt><dd>{tokenUnits(t.awardedUnits,t.decimals)} {t.symbol}</dd></div><div><dt>Claimable</dt><dd>{tokenUnits(t.claimableUnits,t.decimals)} {t.symbol}</dd></div><div><dt>{mode==='peak'?'Peak':'Market'} valuation</dt><dd>{usd(mode==='peak'?t.peakUsdMicros:t.marketUsdMicros)}</dd></div></dl></article>)}</div>{!p.items.length&&<p>No published awards for this participant.</p>}<div className="board-pagination"><button disabled={!prior.length} onClick={()=>{setCursor(prior.at(-1));setPrior(old=>old.slice(0,-1));}}>Previous tokens</button><button disabled={p.nextCursor===null} onClick={()=>{setPrior(old=>[...old,cursor]);setCursor(p.nextCursor!);}}>Next tokens</button></div></Panel>
 <ShareLink path={'/participants/'+encodeURIComponent(wallet)} title={p.label+' · 10X rewards'}/>
 </>}</>;
}

const activityModel=z.object({mode:z.literal('synthetic-local'),asOf:z.iso.datetime(),items:z.array(z.object({id:z.string(),wallet:z.string(),label:z.string(),category:z.enum(['nfts','stake','earn']),tokenId:z.string(),symbol:z.string(),decimals:z.number().int().min(0).max(18),awardedUnits:units,awardedAt:z.iso.datetime()})).max(50)});
export function RecentActivity(){
 const q=usePerformanceQuery('activity?limit=5',activityModel,['public','performance-activity']);
 return <Panel title="Recent awards">{q.isError?<Failure retry={()=>void q.refetch()}/>:!q.data?<p role="status">Loading recent awards…</p>:<><p className="fixture-label">Synthetic QA activity · {utc(q.data.asOf)}</p>{q.data.items.length?<ul className="recent-awards">{q.data.items.map(a=><li key={a.id}><TokenArt name={a.tokenId}/><div><Link to="/participants/$wallet" params={{wallet:a.wallet}}>{a.label}</Link><p>{tokenUnits(a.awardedUnits,a.decimals)} {a.symbol} awarded through {categoryLabels[a.category]}</p><small>{utc(a.awardedAt)}</small></div></li>)}</ul>:<p>No published award activity in this snapshot.</p>}</>}</Panel>;
}
