import { newsHistoryCutoff } from "../../shared/stonkletsNewsDates";
import sourceMap from "./stonkletNewsSourceMap.json";
import verifiedFeeds from "./stonkletNewsVerifiedFeeds.json";
import { STONKLETS_CATALOG } from "../../shared/stonkletsCatalog";
import { SPOTLIGHT_RESEARCH, parseResearchFeed } from "./stonkletSpotlightResearch";
import { qualifyingNarrative } from "../../shared/stonkletsNewsEligibility";
export { qualifyingNarrative } from "../../shared/stonkletsNewsEligibility";
import { canonicalNewsUrl, newsHash, normalizedHeadline, sourceDomain, type NewsItem } from "../../shared/stonkletsNews";
import type { ThesisSource } from "../../shared/stonkletsSpotlight";
export interface NewsFeed { id: string; publisher: string; url: string; hosts: string[]; pairIds: string[]; enabled: boolean; priority: number; method: "public-rss" | "marketaux-api"; owner: string; requireIdentity?:boolean }
const aliases: Record<string,string[]> = {
 "spacex":["SpaceX","Starlink"],
 "alphabet":["Google","Alphabet","Gemini"],"amazon":["Amazon","AWS"],"nvidia":["NVIDIA","GeForce"],"microsoft":["Microsoft","Copilot"],"meta":["Meta","Meta Platforms","Facebook","Instagram"],"bitmine":["BitMine","BitMine Immersion Technologies"],"circle":["Circle Internet","Circle (CRCL)","Circle's"],"coherent":["Coherent Corp","Coherent Corporation","Coherent's"],"amd":["AMD","Advanced Micro Devices"],"strategy":["MicroStrategy","Strategy (MSTR)"],"trump-media":["Trump Media","Truth Social"],"tether-gold":["Tether Gold","XAUT"],"spy":["SPDR S&P 500"],"invesco-qqq":["Invesco QQQ"],"direxion-soxs":["SOXS","Direxion Daily Semiconductor Bear"],"direxion-soxl":["SOXL","Direxion Daily Semiconductor Bull"],"proshares-sqqq":["SQQQ","ProShares UltraPro Short QQQ"],"ishares-korea":["iShares MSCI South Korea"],"usa-rare-earth":["USA Rare Earth"],"super-micro":["Super Micro","Supermicro"],"ast-spacemobile":["AST SpaceMobile"]
};
export const NEWS_IDENTITIES = STONKLETS_CATALOG.map(entry => ({ pairId: entry.id, aliases: aliases[entry.id] ?? [entry.stock.name], homepage: sourceMap.identities.find(source => source.pairId === entry.id)?.officialArchive ?? SPOTLIGHT_RESEARCH[entry.id]?.homepage ?? null }));
// Public, stock-specific RSS discovery. Tickers are fixed catalog mappings, never user input.
// Yahoo supplies syndicated headlines; retain its title/link and display source attribution.
export const STOCK_NEWS_SYMBOLS: Readonly<Record<string,string>> = {
 spacex:"SPCX","sk-hynix":"000660.KS",spy:"SPY","invesco-qqq":"QQQ",nvidia:"NVDA",apple:"AAPL",tesla:"TSLA",microsoft:"MSFT",alphabet:"GOOGL",robinhood:"HOOD",alibaba:"BABA",gamestop:"GME",netflix:"NFLX",strategy:"MSTR","trump-media":"DJT",bitmine:"BMNR","super-micro":"SMCI",iren:"IREN",asml:"ASML","ast-spacemobile":"ASTS",coherent:"COHR",credo:"CRDO","usa-rare-earth":"USAR","astera-labs":"ALAB",circle:"CRCL",micron:"MU",sandisk:"SNDK",amd:"AMD","ishares-korea":"EWY",intel:"INTC",lumentum:"LITE",meta:"META",palantir:"PLTR","bloom-energy":"BE",amazon:"AMZN","direxion-soxs":"SOXS",dell:"DELL",fluence:"FLNC","applied-materials":"AMAT","direxion-soxl":"SOXL",moderna:"MRNA",paypal:"PYPL","proshares-sqqq":"SQQQ"
};
const feeds = new Map<string,NewsFeed>();
for (const [pairId,identity] of Object.entries(SPOTLIGHT_RESEARCH)) {
  if (!identity.feed || identity.publisher === "Federal Reserve") continue;
  const existing = feeds.get(identity.feed);
  if (existing) existing.pairIds.push(pairId);
  else feeds.set(identity.feed,{id:`official-${pairId}`,publisher:identity.publisher,url:identity.feed,hosts:identity.feedHosts!,pairIds:[pairId],enabled:pairId!=="robinhood",priority:0,method:"public-rss",owner:identity.publisher});
}
// Robinhood IR feed is disabled after repeated failed access checks; trusted press still covers the identity.
// Public publisher feeds only. Domain/ownership is explicit; article URLs never become arbitrary fetch targets.
feeds.set("bbc",{id:"bbc-business",publisher:"BBC News",owner:"BBC",url:"https://feeds.bbci.co.uk/news/business/rss.xml",hosts:["www.bbc.com","www.bbc.co.uk","bbc.com","bbc.co.uk"],pairIds:NEWS_IDENTITIES.map(item=>item.pairId),enabled:true,priority:1,method:"public-rss"});
feeds.set("cnbc",{id:"cnbc-business",publisher:"CNBC",owner:"CNBC",url:"https://www.cnbc.com/id/10001147/device/rss/rss.html",hosts:["www.cnbc.com"],pairIds:NEWS_IDENTITIES.map(item=>item.pairId),enabled:true,priority:1,method:"public-rss"});
for(const [pairId,symbol] of Object.entries(STOCK_NEWS_SYMBOLS)) feeds.set(`stock-${pairId}`,{
 id:`stock-${pairId}`,publisher:"Yahoo Finance",owner:"Yahoo",url:`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,
 hosts:["finance.yahoo.com","www.reuters.com","www.cnbc.com","apnews.com","www.axios.com","www.businesswire.com","www.globenewswire.com","www.prnewswire.com"],pairIds:[pairId],enabled:true,priority:2,method:"public-rss"
});
for (const feed of verifiedFeeds) feeds.set(feed.url, feed as NewsFeed);
export const NEWS_FEEDS = [...feeds.values()];
export const MAX_NEWS_FEEDS = 100, MAX_NEWS_ITEMS = 50;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
export function newsAssociations(feed: NewsFeed, source: ThesisSource): {pairId:string;relation:"direct"|"sector";evidence:string}[] {
  if (feed.priority === 0 && !feed.requireIdentity) return feed.pairIds.map(pairId=>({pairId,relation:"direct",evidence:`Official ${feed.publisher} announcement`}));
  const text = `${source.title} ${source.excerpt ?? ""}`;
  const direct = NEWS_IDENTITIES.filter(item=>feed.pairIds.includes(item.pairId) && item.aliases.some(alias=>new RegExp(`\\b${escape(alias)}(?:\\b|$)`,"i").test(source.title)))
    .map(item=>({pairId:item.pairId,relation:"direct" as const,evidence:source.excerpt ?? source.title}));
  // Narrow reviewed macro mapping: US online retail demand -> Amazon, never company-specific revenue.
  if (!direct.length && /(?:\bUS\b|\bU\.S\.|\bUnited States\b)/i.test(text) && /\b(?:e-commerce|online retail|online shopping)\b/i.test(text)
      && /\b(?:grew|grows?|growth|increased?|rose|rises?)\b/i.test(text) && feed.pairIds.includes("amazon"))
    return [{pairId:"amazon",relation:"sector",evidence:"US online retail demand is a potential Amazon tailwind; the report does not establish Amazon-specific growth."}];
  return direct;
}
export function parseNewsFeed(xml: string,feed: NewsFeed,now: string): ThesisSource[] {
  if(!/<(?:rss|feed)\b/i.test(xml)) throw new Error("Not an RSS/Atom feed");
  return parseResearchFeed(xml,{publisher:feed.publisher,homepage:feed.url,feedHosts:feed.hosts},now,Math.ceil((Date.parse(now)-newsHistoryCutoff(Date.parse(now)))/86400_000),MAX_NEWS_ITEMS,false);
}
export interface NewsReview { source:ThesisSource; associations:ReturnType<typeof newsAssociations>; reason:"accepted"|"needs-evidence-review"|"editorial-filter"|"unmapped" }
export async function collectNewsItems(xml:string,feed:NewsFeed,now:string):Promise<{items:NewsItem[];rejected:number;reviews:NewsReview[]}> {
  return collectNewsSources(parseNewsFeed(xml,feed,now),feed,now);
}
export async function collectNewsSources(sources:ThesisSource[],feed:NewsFeed,now:string):Promise<{items:NewsItem[];rejected:number;reviews:NewsReview[]}> {
  const items:NewsItem[]=[],reviews:NewsReview[]=[];let rejected=0;
  for(const source of sources) {
    const associations=newsAssociations(feed,source);
    if(!associations.length){reviews.push({source,associations,reason:"unmapped"});rejected++;continue;}
    if(!qualifyingNarrative(source,Date.parse(now))){reviews.push({source,associations,reason:/\b(?:earnings|financial results|revenue|sales|adoption|milestone|contract|agreement)\b/i.test(source.title)?"needs-evidence-review":"editorial-filter"});rejected++;continue;}
    reviews.push({source,associations,reason:"accepted"});
    const url=canonicalNewsUrl(source.url), articleId=await newsHash(url);
    for(const association of associations) items.push({id:`news-${await newsHash(`${association.pairId}:${articleId}`)}`,articleId,narrativeKey:normalizedHeadline(source.title),pairId:association.pairId,
      strategy:"narrative-news-v4",headline:source.title,selectedAt:now,sourceDomain:sourceDomain(url),relation:association.relation,evidence:association.evidence,
      sources:[{...source,id:url,url}],leadSourceId:url,sourcePriority:feed.priority});
  }
  return {items,rejected,reviews};
}
export async function fetchNewsFeed(feed:NewsFeed,headers:Record<string,string>={}):Promise<{status:number;xml:string;etag:string|null;modified:string|null}> {
  const response=await fetch(feed.url,{redirect:"error",signal:AbortSignal.timeout(8000),headers:{accept:"application/rss+xml, application/atom+xml, text/xml","user-agent":"10X Stonklets News contact@10x.meme",...headers}});
  if(response.status===304)return {status:304,xml:"",etag:response.headers.get("etag"),modified:response.headers.get("last-modified")};
  if(!response.ok){await response.body?.cancel();throw new Error(`Source HTTP ${response.status}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error("Empty feed");
  let size=0,xml="";const decoder=new TextDecoder();
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>2_000_000)throw new Error("Feed too large");xml+=decoder.decode(chunk.value,{stream:true});}xml+=decoder.decode();}
  finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  return {status:response.status,xml,etag:response.headers.get("etag"),modified:response.headers.get("last-modified")};
}
