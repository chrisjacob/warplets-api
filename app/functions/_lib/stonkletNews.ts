import { newsHistoryCutoff } from "../../shared/stonkletsNewsDates";
import { STONKLETS_CATALOG } from "../../shared/stonkletsCatalog";
import { legacyNews, newsSource, sourceDomain, sameNarrative, selectNews, type NewsItem, type NewsResponse } from "../../shared/stonkletsNews";
import { claimStonkletWork, releaseStonkletWork } from "./stonkletWorkLease";
import { NEWS_FEEDS, MAX_NEWS_FEEDS, fetchNewsFeed, collectNewsItems } from "./stonkletNewsResearch";
import type { SpotlightThesis } from "../../shared/stonkletsSpotlight";
import { marketauxEnabled, marketauxFeed, marketauxFeedsForHour, fetchMarketauxNews, MarketauxStopped, type MarketauxEnv } from "./stonkletMarketaux";
export interface NewsJob { kind:"stonklet-news"; hour:string; sourceId:string }
export interface NewsEnv extends MarketauxEnv { STONKLET_NEWS_QUEUE?:Queue<NewsJob>; STONKLETS_SPOTLIGHT_ENABLED?:string }
const fields=`l.id,l.pair_id,l.relation,l.evidence,l.selected_at,l.published,l.withdrawn_at,l.withdrawal_reason,a.id article_id,a.narrative_key,a.headline,a.domain,a.priority,a.source_json,a.published_at`;
/** Explicit admin activation; no elapsed-time or observation-count requirement. */
export async function activateNews(db:D1Database,now=new Date().toISOString()):Promise<boolean>{
 await db.batch([
  db.prepare("UPDATE stonklet_spotlight_control SET mode='live',updated_at=? WHERE id=1 AND strategy_version='narrative-news-v4'").bind(now),
  db.prepare("UPDATE stonklet_news_links SET published=1 WHERE withdrawn_at IS NULL AND EXISTS(SELECT 1 FROM stonklet_spotlight_control WHERE id=1 AND mode='live' AND strategy_version='narrative-news-v4' AND updated_at=?)").bind(now),
 ]);
 return !!await db.prepare("SELECT id FROM stonklet_spotlight_control WHERE id=1 AND mode='live' AND strategy_version='narrative-news-v4' AND updated_at=?").bind(now).first();
}
function fromRow(row:Record<string,unknown>):NewsItem {
 const source=JSON.parse(String(row.source_json));return {id:String(row.id),articleId:String(row.article_id),narrativeKey:String(row.narrative_key),pairId:String(row.pair_id),strategy:"narrative-news-v4",headline:String(row.headline),selectedAt:String(row.selected_at),sourceDomain:String(row.domain)||sourceDomain(source.url),relation:row.relation as "direct"|"sector",evidence:String(row.evidence),sources:[source],leadSourceId:source.id,sourcePriority:Number(row.priority),published:!!row.published,withdrawnAt:row.withdrawn_at as string|null,withdrawalReason:row.withdrawal_reason as string|null};
}
export async function readNews(db:D1Database,options:{id?:string;pairs?:string[];preview?:boolean}={},now=new Date()):Promise<NewsResponse>{
 const empty:NewsResponse={entries:[],news:null,lastEvaluatedAt:null,status:"unavailable"};
 const control=await db.prepare("SELECT mode FROM stonklet_spotlight_control WHERE id=1").first<{mode:string}>();
 if(!control||control.mode==="off"||(!options.preview&&control.mode!=="live"))return empty;
 const visible=options.preview?"":" AND l.published=1";
 if(options.id){
  const row=await db.prepare(`SELECT ${fields} FROM stonklet_news_links l JOIN stonklet_news_articles a ON a.id=l.article_id WHERE l.id=?${visible}`).bind(options.id).first<Record<string,unknown>>();
  if(row){const news=fromRow(row);return {...empty,news,status:news.withdrawnAt?"withdrawn":"archived"};}
  const legacy=await db.prepare(`SELECT thesis_json,withdrawn_at,withdrawal_reason FROM stonklet_spotlight_theses WHERE id=?${options.preview?"":" AND published=1"}`).bind(options.id).first<{thesis_json:string;withdrawn_at:string|null;withdrawal_reason:string|null}>();
  if(!legacy)return empty;
  const old={...JSON.parse(legacy.thesis_json),withdrawnAt:legacy.withdrawn_at,withdrawalReason:legacy.withdrawal_reason} as SpotlightThesis;
  if(!old.sources?.length)return empty;
  return {...empty,news:legacyNews(old),status:old.withdrawnAt?"withdrawn":"archived"};
 }
 const pairs=options.pairs??STONKLETS_CATALOG.filter(item=>item.launchStatus==="launched").map(item=>item.id);
 const result=await db.prepare(`WITH originals AS (
 SELECT ${fields},ROW_NUMBER() OVER(PARTITION BY l.pair_id,a.narrative_key ORDER BY a.priority ASC,a.published_at DESC,l.id ASC) narrative_rank
 FROM stonklet_news_links l JOIN stonklet_news_articles a ON a.id=l.article_id
 WHERE l.withdrawn_at IS NULL${visible} AND a.published_at>=? AND a.published_at<=? AND l.pair_id IN (${pairs.map(()=>"?").join(",")})
 ), stocks AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY pair_id ORDER BY published_at DESC,id ASC) stock_rank FROM originals WHERE narrative_rank=1)
 SELECT * FROM stocks WHERE stock_rank<=? ORDER BY published_at DESC,id ASC LIMIT ?`).bind(new Date(newsHistoryCutoff(now.getTime())).toISOString(),now.toISOString(),...pairs,50,1000).all<Record<string,unknown>>();
 const candidates=(result.results??[]).map(fromRow);
 const entries=options.pairs?pairs.flatMap(pair=>selectNews(candidates,pair,now.getTime())):selectNews(candidates,undefined,now.getTime());
 const last=await db.prepare("SELECT evaluated_at FROM stonklet_news_runs WHERE status='complete' ORDER BY evaluated_at DESC LIMIT 1").first<{evaluated_at:string}>();
 return {entries:options.pairs?[]:entries,...(options.pairs?{byPair:Object.fromEntries(pairs.map(pair=>[pair,entries.filter(item=>item.pairId===pair)]))}:{}),lastEvaluatedAt:last?.evaluated_at??null,status:entries.length?(last&&now.getTime()-Date.parse(last.evaluated_at)<7200000?"current":"retained"):"unavailable"};
}
export async function storeNews(db:D1Database,item:NewsItem):Promise<void>{
 const source=newsSource(item)!;
 const existingArticle=await db.prepare("SELECT id FROM stonklet_news_articles WHERE canonical_url=?").bind(source.url).first<{id:string}>();
 const articleId=existingArticle?.id??item.articleId;
 // Near-identical syndicated headlines within three days share an event key; numerical changes remain distinct.
 const nearby=await db.prepare(`SELECT a.narrative_key,a.headline FROM stonklet_news_articles a JOIN stonklet_news_links l ON l.article_id=a.id WHERE l.pair_id=? AND a.published_at BETWEEN ? AND ? ORDER BY a.published_at DESC LIMIT 200`).bind(item.pairId,new Date(Date.parse(source.publishedAt)-3*86400_000).toISOString(),new Date(Date.parse(source.publishedAt)+3*86400_000).toISOString()).all<{narrative_key:string;headline:string}>();
 let key=item.narrativeKey;
 for(const prior of nearby.results??[]) if(sameNarrative(item.headline,prior.headline)){key=prior.narrative_key;break;}
 await db.batch([
 db.prepare(`INSERT OR IGNORE INTO stonklet_news_articles(id,narrative_key,headline,canonical_url,domain,publisher,published_at,discovered_at,priority,source_json) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(item.articleId,key,item.headline,source.url,item.sourceDomain,source.publisher,source.publishedAt,item.selectedAt,item.sourcePriority,JSON.stringify(source)),
 db.prepare(`INSERT OR IGNORE INTO stonklet_news_links(id,article_id,pair_id,relation,evidence,selected_at,published) SELECT ?,?,?,?,?,?,CASE WHEN mode='live' THEN 1 ELSE 0 END FROM stonklet_spotlight_control WHERE id=1 AND mode!='off'`).bind(item.id,articleId,item.pairId,item.relation,item.evidence,item.selectedAt)
 ]);
}
export async function scheduleStonkletNews(env:NewsEnv,clock=new Date()):Promise<string>{
 if(env.STONKLETS_SPOTLIGHT_ENABLED!=="true"||!env.STONKLET_NEWS_QUEUE)return "disabled";
 const control=await env.WARPLETS.prepare("SELECT mode FROM stonklet_spotlight_control WHERE id=1").first<{mode:string}>();if(!control||control.mode==="off")return "disabled";
 const minute=clock.getUTCMinutes();if(![5,10,15].includes(minute))return "not-due";
 const hour=clock.toISOString().slice(0,13),now=clock.toISOString();
 await env.WARPLETS.prepare("UPDATE stonklet_news_jobs SET status='failed',error='Delivery expired; inspect dead-letter queue' WHERE status IN ('running','queued') AND updated_at<?").bind(new Date(clock.getTime()-30*60000).toISOString()).run();
 const unfinished=await env.WARPLETS.prepare("SELECT hour FROM stonklet_news_runs WHERE status='running' ORDER BY hour LIMIT 24").all<{hour:string}>();
 for(const run of unfinished.results??[])await finishRun(env.WARPLETS,run.hour,now);
 const owner=await claimStonkletWork(env.WARPLETS,"news-dispatch",120);if(!owner)return "busy";
 try{
 const feeds=[...NEWS_FEEDS.filter(feed=>feed.enabled).slice(0,MAX_NEWS_FEEDS),...(marketauxEnabled(env)?marketauxFeedsForHour(clock):[])];
 await env.WARPLETS.prepare("INSERT OR IGNORE INTO stonklet_news_runs(hour,expected,evaluated_at) VALUES(?,?,?)").bind(hour,feeds.length,now).run();
 for(const feed of feeds){
  const exists=await env.WARPLETS.prepare("SELECT status FROM stonklet_news_jobs WHERE hour=? AND source_id=?").bind(hour,feed.id).first<{status:string}>();
  if(exists&&exists.status!=="pending")continue;
  await env.WARPLETS.prepare("INSERT OR IGNORE INTO stonklet_news_jobs(hour,source_id,updated_at) VALUES(?,?,?)").bind(hour,feed.id,now).run();
  await env.STONKLET_NEWS_QUEUE.send({kind:"stonklet-news",hour,sourceId:feed.id});
  // Delivery can start immediately; do not overwrite a consumer's running/done state.
  await env.WARPLETS.prepare("UPDATE stonklet_news_jobs SET status='queued',updated_at=? WHERE hour=? AND source_id=? AND status='pending'").bind(now,hour,feed.id).run();
 }
 return "queued";
 }finally{await releaseStonkletWork(env.WARPLETS,"news-dispatch",owner);}
}
async function finishRun(db:D1Database,hour:string,now:string){
 await db.prepare(`UPDATE stonklet_news_runs SET status=CASE WHEN (SELECT COUNT(*) FROM stonklet_news_jobs WHERE hour=? AND status='done')>=expected*.8 THEN 'complete' ELSE 'degraded' END,evaluated_at=?
 WHERE hour=? AND (SELECT COUNT(*) FROM stonklet_news_jobs WHERE hour=? AND status IN ('done','failed'))>=expected`).bind(hour,now,hour,hour).run();
}
export async function processNewsJob(env:NewsEnv,job:NewsJob):Promise<void>{
 const feed=NEWS_FEEDS.find(feed=>feed.id===job.sourceId&&feed.enabled)??(job.sourceId.startsWith('marketaux-')?marketauxFeed(job.sourceId.slice(10)):undefined);if(job.kind!=="stonklet-news"||!feed||!/^\d{4}-\d\d-\d\dT\d\d$/.test(job.hour))throw new Error("Invalid news job");
 const db=env.WARPLETS,now=new Date().toISOString();
 const mode=await db.prepare("SELECT mode FROM stonklet_spotlight_control WHERE id=1").first<{mode:string}>();if(mode?.mode==="off")return;
 const owner=await claimStonkletWork(db,`news:${job.sourceId}:${job.hour}`,120);if(!owner)throw new Error("News job busy");
 try{
 const attempt=await db.prepare(`UPDATE stonklet_news_jobs SET attempts=attempts+1,status='running',updated_at=? WHERE hour=? AND source_id=? AND status NOT IN ('done','failed') AND attempts<3 RETURNING attempts`).bind(now,job.hour,feed.id).first<{attempts:number}>();if(!attempt)return;
 try{
 const state=await db.prepare("SELECT etag,modified FROM stonklet_news_sources WHERE id=?").bind(feed.id).first<{etag:string|null;modified:string|null}>();
 const provider=feed.method==='marketaux-api';
 const response=provider?{status:200,xml:'',etag:null,modified:null}:await fetchNewsFeed(feed,{...(state?.etag?{"if-none-match":state.etag}:{}),...(state?.modified?{"if-modified-since":state.modified}:{})});
 const jobKey=`${job.hour}:${feed.id}`;
 const collected=provider?await fetchMarketauxNews(env,feed.pairIds[0]!,`${jobKey}:${attempt.attempts}`,new Date(now),jobKey):response.status===304?{items:[],rejected:0,reviews:[]}:await collectNewsItems(response.xml,feed,now);
 // Keep rejected evidence discoverable without weakening publication filters.
 for(const review of collected.reviews??[])await db.prepare(`INSERT INTO stonklet_news_review(source_id,canonical_url,headline,published_at,checked_at,reason,source_json,associations_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id,canonical_url) DO UPDATE SET headline=excluded.headline,published_at=excluded.published_at,checked_at=excluded.checked_at,reason=excluded.reason,source_json=excluded.source_json,associations_json=excluded.associations_json`).bind(feed.id,review.source.url,review.source.title,review.source.publishedAt,now,review.reason,JSON.stringify(review.source),JSON.stringify(review.associations)).run();
 await db.prepare("DELETE FROM stonklet_news_review WHERE published_at<?").bind(new Date(newsHistoryCutoff(Date.parse(now))).toISOString()).run();
 await db.prepare("DELETE FROM stonklet_news_review WHERE source_id=? AND canonical_url NOT IN (SELECT canonical_url FROM stonklet_news_review WHERE source_id=? ORDER BY published_at DESC,canonical_url LIMIT 500)").bind(feed.id,feed.id).run();
 for(const item of collected.items)await storeNews(db,item);
 await db.batch([
 db.prepare(`INSERT INTO stonklet_news_sources(id,etag,modified,checked_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET etag=COALESCE(excluded.etag,etag),modified=COALESCE(excluded.modified,modified),checked_at=excluded.checked_at,error=NULL,failures=0`).bind(feed.id,response.etag,response.modified,now),
 db.prepare("UPDATE stonklet_news_jobs SET status='done',accepted=?,rejected=?,error=NULL,updated_at=? WHERE hour=? AND source_id=?").bind(collected.items.length,collected.rejected,now,job.hour,feed.id)
 ]);
 }catch(error){
 const message=String(error).slice(0,250);
 await db.prepare("UPDATE stonklet_news_jobs SET status=?,error=?,updated_at=? WHERE hour=? AND source_id=?").bind(attempt.attempts>=3||error instanceof MarketauxStopped?"failed":"queued",message,now,job.hour,feed.id).run();
 await db.prepare("INSERT INTO stonklet_news_sources(id,error,checked_at,failures) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET error=excluded.error,checked_at=excluded.checked_at,failures=failures+1").bind(feed.id,message,now).run();
 await finishRun(db,job.hour,now);if(error instanceof MarketauxStopped)return;throw error;
 }
 await finishRun(db,job.hour,now);
 }finally{await releaseStonkletWork(db,`news:${job.sourceId}:${job.hour}`,owner);}
}
