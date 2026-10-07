import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import reviewedBackfill from "./shared/stonkletsNarrativeBackfill.json";
import savedPreview from "./shared/stonkletsNewsPreview.json";
import { legacyNews, reconcileNarrative, selectNews, validNewsItem, type NewsItem, type ShareNews } from "./shared/stonkletsNews";
import { STONKLETS_BY_ID } from "./shared/stonkletsCatalog";
import { validNewsId } from "./shared/stonkletsSpotlight";
import { NEWS_FEEDS, fetchNewsFeed, collectNewsItems } from "./functions/_lib/stonkletNewsResearch";
/** Dev-only news service. Never changes production publication state. */
export function localSpotlightPreview():Plugin {
 const history=new Map<string,NewsItem>();
 const cachePath=fileURLToPath(new URL("./node_modules/.cache/stonklets-news-preview.json",import.meta.url));
 const restore=(records:unknown)=>{if(!Array.isArray(records))return;for(const raw of records){try{const item=legacyNews(raw as ShareNews);if(validNewsItem(item))history.set(item.id,reconcileNarrative(item,history.values()));}catch{/* Ignore corrupt entries. */}}};
 restore(savedPreview);try{restore(JSON.parse(readFileSync(cachePath,"utf8")));}catch{/* Verified startup snapshot. */}
 // Checked-in editorial reviews override older cached copies of the same story.
 restore(reviewedBackfill.entries);
 let pending:Promise<void>|null=null,attemptAt=0,lastEvaluatedAt:string|null=null;
 const refresh=async()=>{
  attemptAt=Date.now();const now=new Date().toISOString(),queue=NEWS_FEEDS.filter(feed=>feed.enabled);let successes=0;
  await Promise.all(Array.from({length:4},async()=>{while(queue.length){const feed=queue.shift()!;try{const response=await fetchNewsFeed(feed);const result=await collectNewsItems(response.xml,feed,now);for(const item of result.items)if(!history.has(item.id))history.set(item.id,reconcileNarrative(item,history.values()));successes++;}catch{/* One unavailable feed does not hide saved news or other issuers. */}}}));
  if(successes)lastEvaluatedAt=now;
  try{mkdirSync(dirname(cachePath),{recursive:true});writeFileSync(`${cachePath}.tmp`,JSON.stringify([...history.values()]));renameSync(`${cachePath}.tmp`,cachePath);}catch{/* Read-only environments retain startup and memory snapshots. */}
 };
 const warm=()=>{if(!pending&&Date.now()-attemptAt>3600_000)pending=refresh().catch(()=>undefined).finally(()=>{pending=null;});};
 return {name:"stonklet-local-spotlight-preview",apply:"serve",configureServer(server){warm();server.middlewares.use((request,response,next)=>{
  const url=new URL(request.url??"/","http://localhost");if(!["/api/stonklets/news","/api/stonklets/spotlight"].includes(url.pathname)||request.method!=="GET")return next();
  const id=url.searchParams.get("news")??url.searchParams.get("thesis"),raw=url.searchParams.get("pairs"),pairs=raw?.split(",");
  response.setHeader("content-type","application/json");response.setHeader("cache-control","no-store");
  if((id&&!validNewsId(id))||(id&&pairs)||(pairs&&(!pairs.length||pairs.length>20||pairs.some(pair=>!STONKLETS_BY_ID.has(pair))))){response.statusCode=400;response.end(JSON.stringify({error:"invalid_news_query"}));return;}
  warm();const records=[...history.values()],news=id?history.get(id)??null:null,entries=selectNews(records);
  const byPair=pairs?Object.fromEntries([...new Set(pairs)].map(pair=>[pair,selectNews(records,pair)])):undefined;
  response.end(JSON.stringify({entries:pairs?[]:entries,...(byPair?{byPair}:{}),news,...(url.pathname.endsWith("spotlight")?{thesis:news??entries[0]??null}:{}),lastEvaluatedAt,status:news?(news.withdrawnAt?"withdrawn":"archived"):entries.length?"retained":"unavailable",preview:true}));
 });}};
}
