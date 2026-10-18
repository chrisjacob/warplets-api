import { STOCK_NEWS_SYMBOLS, NEWS_FEEDS, collectNewsSources, type NewsFeed } from './stonkletNewsResearch';
import sourceMap from './stonkletNewsSourceMap.json';
import { canonicalNewsUrl, sourceDomain } from '../../shared/stonkletsNews';
import type { ThesisSource } from '../../shared/stonkletsSpotlight';
export interface MarketauxEnv { WARPLETS:D1Database; MARKETAUX_API_TOKEN?:string; MARKETAUX_NEWS_ENABLED?:string }
export const MARKETAUX_REQUEST_LIMIT=90;
// Provider-specific mapping: do not guess SpaceX, Korean exchange or gold identifiers.
export const MARKETAUX_SYMBOLS=Object.fromEntries(Object.entries(STOCK_NEWS_SYMBOLS).filter(([pair,symbol])=>pair!=='spacex'&&/^[A-Z]+$/.test(symbol)));
export const marketauxEnabled=(env:MarketauxEnv)=>env.MARKETAUX_NEWS_ENABLED==='true'&&!!env.MARKETAUX_API_TOKEN?.trim();
export function marketauxFeed(pairId:string):NewsFeed|undefined {
 if(!Object.hasOwn(MARKETAUX_SYMBOLS,pairId))return;
 return {id:`marketaux-${pairId}`,publisher:'Marketaux',owner:'Marketaux',url:'https://api.marketaux.com/v1/news/all',hosts:[],pairIds:[pairId],enabled:true,priority:1,method:'marketaux-api'};
}
/** Every mapped stock twice per UTC day, distributed through the hourly queue. */
export function marketauxFeedsForHour(now:Date):NewsFeed[]{
 const pairs=Object.keys(MARKETAUX_SYMBOLS),total=pairs.length*2,hour=now.getUTCHours();
 return Array.from({length:Math.floor(total*(hour+1)/24)-Math.floor(total*hour/24)},(_,offset)=>marketauxFeed(pairs[(Math.floor(total*hour/24)+offset)%pairs.length]!)!);
}
const trustedDomains=new Set([...NEWS_FEEDS.flatMap(f=>f.hosts.map(h=>sourceDomain(`https://${h}`))),...sourceMap.identities.map(i=>sourceDomain(i.officialArchive)), 'reuters.com','apnews.com','axios.com','investing.com','marketwatch.com','barrons.com','wsj.com','ft.com','finance.yahoo.com','yahoo.com','benzinga.com','pv-magazine.de','renewablesnow.com']);
export class MarketauxStopped extends Error { constructor(message:string){super(message);this.name='MarketauxStopped';} }
export async function reserveMarketauxRequest(db:D1Database,id:string,pairId:string,now:Date):Promise<boolean>{
 if(!Object.hasOwn(MARKETAUX_SYMBOLS,pairId))throw new MarketauxStopped('Marketaux unsupported symbol');
 // One atomic conditional INSERT serializes the budget across workers and retries.
 const row=await db.prepare(`INSERT OR IGNORE INTO stonklet_marketaux_requests(id,requested_at,pair_id)
 SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM stonklet_marketaux_control WHERE blocked_until>?)
 AND (SELECT COUNT(*) FROM stonklet_marketaux_requests WHERE requested_at>=?)<? RETURNING id`).bind(id,now.toISOString(),pairId,now.toISOString(),new Date(now.getTime()-86400000).toISOString(),MARKETAUX_REQUEST_LIMIT).first<{id:string}>();
 return !!row;
}
export function parseMarketauxResponse(payload:unknown,pairId:string,now:Date):ThesisSource[]{
 const data=(payload as {data?:unknown})?.data;if(!Array.isArray(data))throw new Error('Marketaux invalid response');
 const sources:ThesisSource[]=[];
 for(const raw of data.slice(0,3)){
  if(!raw||typeof raw!=='object')continue;
  const a=raw as Record<string,unknown>;
  if(typeof a.title!=='string'||!a.title.trim()||a.title.length>500||typeof a.url!=='string'||a.url.length>1000||typeof a.published_at!=='string')continue;
  const date=Date.parse(a.published_at);if(!Number.isFinite(date)||date>now.getTime()||date<now.getTime()-7*86400000)continue;
  if(!Array.isArray(a.entities)||!a.entities.slice(0,50).some((e:any)=>e&&e.symbol===MARKETAUX_SYMBOLS[pairId]&&(!e.country||e.country==='us')))continue;
  let url:string;try{url=canonicalNewsUrl(a.url);}catch{continue;}
  const domain=sourceDomain(url);if(!trustedDomains.has(domain))continue;
  const clean=(v:unknown)=>typeof v==='string'?v.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim():'';
  sources.push({id:url,url,title:clean(a.title),publisher:domain,publishedAt:new Date(date).toISOString(),fetchedAt:now.toISOString(),excerpt:[clean(a.description),clean(a.snippet)].filter(Boolean).join(' ').slice(0,1600)});
 }
 return sources;
}
export async function fetchMarketauxNews(env:MarketauxEnv,pairId:string,requestId:string,now=new Date(),jobKey=requestId){
 if(!marketauxEnabled(env))throw new MarketauxStopped('Marketaux disabled');
 const prior=await env.WARPLETS.prepare("SELECT response_json FROM stonklet_marketaux_requests WHERE job_key=? AND pair_id=? AND response_json IS NOT NULL ORDER BY requested_at DESC LIMIT 1").bind(jobKey,pairId).first<{response_json:string|null}>();
 if(prior?.response_json)return collectNewsSources(parseMarketauxResponse(JSON.parse(prior.response_json),pairId,now),marketauxFeed(pairId)!,now.toISOString());
 if(!await reserveMarketauxRequest(env.WARPLETS,requestId,pairId,now))throw new MarketauxStopped('Marketaux request budget or cooldown reached');
 await env.WARPLETS.prepare("UPDATE stonklet_marketaux_requests SET job_key=? WHERE id=?").bind(jobKey,requestId).run();
 await env.WARPLETS.prepare("DELETE FROM stonklet_marketaux_requests WHERE requested_at<?").bind(new Date(now.getTime()-7*86400000).toISOString()).run();
 const token=env.MARKETAUX_API_TOKEN!.trim();
 const url=new URL('https://api.marketaux.com/v1/news/all');
 url.search=new URLSearchParams({api_token:token,symbols:MARKETAUX_SYMBOLS[pairId]!,filter_entities:'true',must_have_entities:'true',group_similar:'true',language:'en',limit:'3',min_match_score:'10',countries:'us',domains:[...trustedDomains].filter(Boolean).join(','),published_after:new Date(now.getTime()-7*86400000).toISOString().slice(0,19)}).toString();
 try{
  let response:Response;try{response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});}catch{throw new Error('Marketaux request failed');}
  if(!response.ok){await response.body?.cancel();if([401,402,403,429].includes(response.status)){
    const until=new Date(now.getTime()+86400000).toISOString();await env.WARPLETS.prepare("UPDATE stonklet_marketaux_control SET blocked_until=?,reason=? WHERE id=1").bind(until,`HTTP ${response.status}`).run();throw new MarketauxStopped(`Marketaux HTTP ${response.status}; paused for 24 hours`);
   }throw new Error(`Marketaux HTTP ${response.status}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('Marketaux empty response');let text='',size=0;const decoder=new TextDecoder();
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>2000000)throw new Error('Marketaux response too large');text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  let payload:unknown;try{payload=JSON.parse(text.split(token).join('[redacted]'));}catch{throw new Error('Marketaux invalid JSON');}
  const sources=parseMarketauxResponse(payload,pairId,now);
  // Cache normalized article metadata only; never the request URL/token or full response.
  const cached={data:sources.map(s=>({title:s.title,url:s.url,published_at:s.publishedAt,description:s.excerpt,entities:[{symbol:MARKETAUX_SYMBOLS[pairId],country:'us'}]}))};
  await env.WARPLETS.prepare("UPDATE stonklet_marketaux_requests SET status='complete',response_json=? WHERE id=?").bind(JSON.stringify(cached),requestId).run();
  return collectNewsSources(sources,marketauxFeed(pairId)!,now.toISOString());
 }catch(error){const message=error instanceof MarketauxStopped?error.message:error instanceof Error&&/^Marketaux (?:HTTP \d+|invalid JSON|invalid response|empty response|response too large|request failed)$/.test(error.message)?error.message:'Marketaux processing failed';await env.WARPLETS.prepare("UPDATE stonklet_marketaux_requests SET status='failed',error=? WHERE id=?").bind(message,requestId).run();if(error instanceof MarketauxStopped)throw new MarketauxStopped(message);throw new Error(message);}
}
