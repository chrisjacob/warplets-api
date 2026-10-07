import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {activateNews,readNews,storeNews,scheduleStonkletNews,processNewsJob} from "./stonkletNews";
import {legacyNews} from "../../shared/stonkletsNews";
import saved from "../../shared/stonkletsNewsPreview.json";
import {NEWS_FEEDS,fetchNewsFeed} from "./stonkletNewsResearch";
vi.mock("./stonkletNewsResearch",async original=>({...await original<typeof import("./stonkletNewsResearch")>(),fetchNewsFeed:vi.fn()}));
let sqlite:DatabaseSync;
function database(){sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");for(const migration of ["0073_stonklet_spotlight.sql","0074_stonklet_daily_spotlight.sql","0077_stonklet_narrative_news.sql","0078_stonklet_news_review.sql","0079_stonklet_marketaux.sql"])sqlite.exec(readFileSync(new URL(`../../../migrations/${migration}`,import.meta.url),"utf8"));sqlite.exec("CREATE TABLE notification_job_state(job_key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);INSERT INTO stonklet_spotlight_control(id,mode,trial_started_at,updated_at,strategy_version) VALUES(1,'shadow','2026-10-01','2026-10-01','narrative-news-v4')");const prepare=(sql:string)=>{let args:unknown[]=[];return{bind(...values:unknown[]){args=values;return this},async first(){return sqlite.prepare(sql).get(...args as never[])??null},async all(){return{results:sqlite.prepare(sql).all(...args as never[])}},async run(){return sqlite.prepare(sql).run(...args as never[])}}};return{prepare,async batch(queries:{run:()=>Promise<unknown>}[]){sqlite.exec("BEGIN");try{const result=[];for(const query of queries)result.push(await query.run());sqlite.exec("COMMIT");return result}catch(error){sqlite.exec("ROLLBACK");throw error}}} as unknown as D1Database;}
beforeEach(()=>vi.clearAllMocks());
afterEach(()=>{sqlite?.close();vi.restoreAllMocks()});
describe("news persistence and isolation",()=>{
 it("activates immediately with no observed days, preserves withdrawals, and publishes later arrivals",async()=>{
  const db=database(),first=legacyNews(saved[0] as never),withdrawn=legacyNews(saved[1] as never);
  await storeNews(db,first);await storeNews(db,withdrawn);
  sqlite.prepare("UPDATE stonklet_news_links SET withdrawn_at='2026-10-07' WHERE id=?").run(withdrawn.id);
  expect(await activateNews(db,'2026-10-01T01:00:00Z')).toBe(true);
  expect(sqlite.prepare("SELECT mode FROM stonklet_spotlight_control").get()?.mode).toBe('live');
  expect(sqlite.prepare("SELECT published FROM stonklet_news_links WHERE id=?").get(first.id)?.published).toBe(1);
  expect(sqlite.prepare("SELECT published FROM stonklet_news_links WHERE id=?").get(withdrawn.id)?.published).toBe(0);
  const later=legacyNews(saved[2] as never);await storeNews(db,later);
  expect(sqlite.prepare("SELECT published FROM stonklet_news_links WHERE id=?").get(later.id)?.published).toBe(1);
  expect((await readNews(db,{},new Date('2026-10-07'))).entries.length).toBeGreaterThan(0);
 });
 it("dispatches Marketaux only when enabled and acknowledges quota stops without RSS fallback",async()=>{
  const db=database(),send=vi.fn(async(_job:unknown)=>{}),clock=new Date('2026-10-07T00:05:00Z');
  const env={WARPLETS:db,STONKLETS_SPOTLIGHT_ENABLED:'true',STONKLET_NEWS_QUEUE:{send} as never,MARKETAUX_NEWS_ENABLED:'true',MARKETAUX_API_TOKEN:'test'};
  await scheduleStonkletNews(env,clock);const job=send.mock.calls.map(c=>c[0] as unknown as {kind:'stonklet-news';hour:string;sourceId:string}).find(j=>j.sourceId.startsWith('marketaux-'))!;
  expect(job).toBeDefined();sqlite.exec("UPDATE stonklet_marketaux_control SET blocked_until='2099-01-01'");
  await processNewsJob(env,job);await processNewsJob(env,job);
  expect(sqlite.prepare('SELECT status,attempts FROM stonklet_news_jobs WHERE source_id=?').get(job.sourceId)).toMatchObject({status:'failed',attempts:1});expect(fetchNewsFeed).not.toHaveBeenCalled();
 });
 it("saves mapped earnings for review without publishing them",async()=>{
  const db=database(),hour=new Date().toISOString().slice(0,13),sourceId="stock-tesla";
  sqlite.prepare("INSERT INTO stonklet_news_jobs(hour,source_id,updated_at) VALUES(?,?,?)").run(hour,sourceId,new Date().toISOString());
  vi.mocked(fetchNewsFeed).mockResolvedValue({status:200,xml:`<rss><item><title>Tesla reports quarterly financial results</title><link>https://finance.yahoo.com/news/tesla-results</link><pubDate>${new Date().toISOString()}</pubDate><description>Revenue grew but profit declined.</description></item></rss>`,etag:null,modified:null});
  await processNewsJob({WARPLETS:db},{kind:"stonklet-news",hour,sourceId});
  expect(sqlite.prepare("SELECT reason FROM stonklet_news_review").get()?.reason).toBe("needs-evidence-review");
  expect(sqlite.prepare("SELECT COUNT(*) n FROM stonklet_news_links").get()?.n).toBe(0);
 });
 it("persists without quotes, respects shadow/off, and resolves withdrawn/expired archives",async()=>{const db=database(),item=legacyNews(saved[0] as never);await storeNews(db,item);await storeNews(db,item);expect(sqlite.prepare("SELECT COUNT(*) n FROM stonklet_news_links").get()?.n).toBe(1);expect((await readNews(db)).entries).toEqual([]);expect((await readNews(db,{preview:true},new Date("2026-10-07"))).entries).toHaveLength(1);sqlite.exec("UPDATE stonklet_spotlight_control SET mode='live';UPDATE stonklet_news_links SET published=1,withdrawn_at='2026-10-07'");expect((await readNews(db,{id:item.id},new Date("2027-01-01"))).status).toBe("withdrawn");expect((await readNews(db)).entries).toEqual([]);sqlite.exec("UPDATE stonklet_spotlight_control SET mode='off'");await storeNews(db,{...legacyNews(saved[1] as never)});expect(sqlite.prepare("SELECT COUNT(*) n FROM stonklet_news_links").get()?.n).toBe(1);});
 it("returns distinct hero stocks and multiple stock narratives with source priority",async()=>{const db=database();for(const old of saved)await storeNews(db,legacyNews(old as never));const result=await readNews(db,{preview:true},new Date("2026-10-07"));expect(result.entries).toHaveLength(5);expect((await readNews(db,{preview:true,pairs:["apple","amazon"]},new Date("2026-10-07"))).byPair?.apple).toHaveLength(2);expect((await readNews(db,{preview:true,id:saved[1]!.id})).news?.id).toBe(saved[1]!.id);});
 it("dispatches each source once and handles duplicate deliveries without duplicate articles",async()=>{const db=database(),send=vi.fn(async()=>{}),env={WARPLETS:db,STONKLETS_SPOTLIGHT_ENABLED:"true",STONKLET_NEWS_QUEUE:{send} as never};const clock=new Date("2026-10-07T00:05:00Z");await scheduleStonkletNews(env,clock);await scheduleStonkletNews(env,clock);expect(send).toHaveBeenCalledTimes(NEWS_FEEDS.filter(e=>e.enabled).length);const job={kind:"stonklet-news" as const,hour:clock.toISOString().slice(0,13),sourceId:"official-apple"};vi.mocked(fetchNewsFeed).mockResolvedValue({status:200,xml:`<rss><item><title>Apple launches new product</title><link>https://www.apple.com/newsroom/product</link><pubDate>${new Date().toISOString()}</pubDate></item></rss>`,etag:'"one"',modified:null});await processNewsJob(env,job);await processNewsJob(env,job);expect(fetchNewsFeed).toHaveBeenCalledTimes(1);expect(sqlite.prepare("SELECT COUNT(*) n FROM stonklet_news_links").get()?.n).toBe(1);});
 it("bounds failures at three attempts while unrelated sources continue",async()=>{const db=database(),env={WARPLETS:db};const hour=new Date().toISOString().slice(0,13);for(const id of ["official-apple","official-microsoft"])sqlite.prepare("INSERT INTO stonklet_news_jobs(hour,source_id,updated_at) VALUES(?,?,?)").run(hour,id,new Date().toISOString());vi.mocked(fetchNewsFeed).mockRejectedValue(new Error("offline"));const job={kind:"stonklet-news" as const,hour,sourceId:"official-apple"};for(let i=0;i<3;i++)await expect(processNewsJob(env,job)).rejects.toThrow("offline");await processNewsJob(env,job);expect(fetchNewsFeed).toHaveBeenCalledTimes(3);expect(sqlite.prepare("SELECT status FROM stonklet_news_jobs WHERE source_id='official-apple'").get()?.status).toBe("failed");vi.mocked(fetchNewsFeed).mockResolvedValue({status:304,xml:"",etag:null,modified:null});await processNewsJob(env,{...job,sourceId:"official-microsoft"});expect(sqlite.prepare("SELECT status FROM stonklet_news_jobs WHERE source_id='official-microsoft'").get()?.status).toBe("done");});
});
