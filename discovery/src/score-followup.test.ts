import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {saveCandidate,candidates} from "./store";
import {expireCandidates} from "./candidate-expiry";
import {defaultScoreInput,freezeDiscoveryScore} from "./discovery-score";
import {freezeScoreCohort} from "./score-research-analysis";
import {publishScoreCohort,runScoreResearch,scoreResearchDetail} from "./score-research";
import {scoreFollowupPlan} from "./score-followup";
import {runMarketCycle} from "./market-cycle";
import {assess,DEFAULT_POLICY,type Candidate,type Market} from "./model";
import {hashJson,toBase58} from "./solana";
import {WSOL} from "./pump";
import {handle,type LocalEnv} from "./worker";

const captured=new Date("2026-10-21T00:00:00.000Z"),target=new Date(captured.getTime()+86400000),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
const key=(i:number)=>{const bytes=new Uint8Array(32);new DataView(bytes.buffer).setUint32(0,i);return toBase58(bytes);};
const later=(ms:number)=>new Date(target.getTime()+ms);
// Isolated SQL publication fixtures, not certification of on-chain identities.
function identity(c:Candidate,id:number):Candidate{const sig=(n:number)=>{const bytes=new Uint8Array(64);new DataView(bytes.buffer).setUint32(0,n);return toBase58(bytes);};return {...c,...(id?{address:key(id),pool:key(id+10000)}:{}),creation:c.creation?{...c.creation,signature:sig(id*2+1)}:null,graduation:c.graduation?{...c.graduation,signature:sig(id*2+2)}:null};}
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
async function seed(db:D1Database,id=0,at=captured,market?:Partial<Market>){
  const base=(await fixtureCandidates(at))[0]!,c:Candidate={...identity(base,id),mode:"live",market:{...base.market!,source:"dexscreener",...market}};
  await saveCandidate(db,c);await db.prepare("UPDATE tenx_score_control SET lease_owner='seed',lease_until=?1").bind(new Date(at.getTime()+120000).toISOString()).run();
  const record=await freezeScoreCohort(await freezeDiscoveryScore(defaultScoreInput(c,at)));expect(await publishScoreCohort(db,record,"seed",at)).toBe(true);
  await db.prepare("UPDATE tenx_score_control SET lease_owner=NULL,lease_until=NULL").run();return c;
}
const pair=(c:Candidate,price=".002",liq=60000)=>({chainId:"solana",pairAddress:c.pool,baseToken:{address:c.address},quoteToken:{address:WSOL},priceUsd:price,marketCap:200000,liquidity:{usd:liq},volume:{h24:10000}});
const settings=(db:D1Database,transport:typeof fetch)=>({db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:true,marketProvider:"dexscreener" as const,transport});
const plan=(db:D1Database,at=target,excluded?:Set<string>)=>scoreFollowupPlan(db,"dexscreener",true,at,excluded);
async function history(db:D1Database,c:Candidate,at:Date,extra:Partial<Market>={}){await db.prepare("INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(c.address,at.toISOString(),JSON.stringify({...c.market!,fetched_at:at.toISOString(),...extra})).run();}
async function payload(db:D1Database,address:string){return (await db.prepare("SELECT payload FROM tenx_candidates WHERE address=?1 AND mode='live'").bind(address).first<{payload:string}>())!.payload;}

describe("cached bounded score endpoint planning",()=>{
  it("opens exactly at 23.5h and closes after the complete two-hour post-target grace",async()=>{
    const {db}=setup();await seed(db);expect((await plan(db,later(-1800001))).counts.awaiting_window).toBe(1);expect((await plan(db,later(-1800000))).ready[0]?.phase).toBe("pre_target");expect((await plan(db,later(7200000))).ready[0]?.phase).toBe("post_target");expect((await plan(db,later(7200001))).counts.window_closed).toBe(1);
  });
  it("pauses pre-target follow-ups after a usable sample, resumes at target and stops after a usable zero endpoint",async()=>{
    const {db}=setup(),c=await seed(db);await history(db,c,later(-1200000));expect((await plan(db,later(-600000))).counts.awaiting_target).toBe(1);expect((await plan(db)).counts.ready).toBe(1);await history(db,c,target,{price_usd:0,liquidity_usd:0});expect((await plan(db)).counts.endpoint_saved).toBe(1);expect((await plan(db)).ready).toEqual([]);
  });
  it.each(["different_source","future_observation","unknown_liquidity"])("does not mistake %s history for a usable endpoint",async kind=>{
    const {db}=setup(),c=await seed(db);await history(db,c,target,kind==="different_source"?{source:"geckoterminal"}:kind==="future_observation"?{observed_at:later(1).toISOString()}:{liquidity_usd:null});expect((await plan(db)).counts.ready).toBe(1);
  });
  it("keeps collecting when duplicate timestamp representations would be excluded by outcome replay",async()=>{
    const {db}=setup(),c=await seed(db);await history(db,c,target);const alias=target.toISOString().replace(".000Z","Z");await db.prepare("INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(c.address,alias,JSON.stringify({...c.market!,fetched_at:alias})).run();expect((await plan(db,later(1))).counts.ready).toBe(1);await history(db,c,later(1));expect((await plan(db,later(1))).counts.endpoint_saved).toBe(1);
  });
  it("requires a usable matching baseline and exact retained identity",async()=>{
    const {db,sqlite}=setup();await seed(db,1,captured,{liquidity_usd:0});await seed(db,2,captured,{source:"geckoterminal"});await seed(db,3);sqlite.prepare("UPDATE tenx_candidates SET pool=? WHERE address=?").run(key(990),key(3));
    const p=await plan(db);expect(p.counts).toMatchObject({pending:3,baseline_unavailable:1,provider_mismatch:1,identity_unavailable:1,ready:0});
  });
  it("honors the shared attempt cooldown and exposes source backoff and pause without requests or writes",async()=>{
    const {db,sqlite}=setup(),c=await seed(db);await db.prepare("INSERT INTO tenx_market_attempts VALUES(?1,?2)").bind(c.address,later(-899999).toISOString()).run();
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("cached only"));expect((await plan(db)).counts.cooling_down).toBe(1);expect((await plan(db,later(1))).counts.ready).toBe(1);
    sqlite.prepare("UPDATE tenx_market_control SET next_refresh_at=?,last_error='market_rate_limited'").run(later(300000).toISOString());expect(await plan(db,later(1))).toMatchObject({state:"waiting",market_error:"market_rate_limited"});sqlite.exec("UPDATE tenx_control SET paused=1");expect((await plan(db,later(1))).state).toBe("paused");expect((await scoreFollowupPlan(db,"dexscreener",false,later(1))).state).toBe("disabled");expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT count(*) n FROM tenx_usage").get()).toEqual({n:0});
  });
  it("limits to five distinct targets, excludes already scheduled mints and prioritizes closing post-target windows",async()=>{
    const {db}=setup();for(let i=1;i<=8;i++)await seed(db,i);await seed(db,9,new Date(captured.getTime()+600000));
    const p=await plan(db,later(0),new Set([key(1),key(2)]));expect(p.ready).toHaveLength(5);expect(new Set(p.ready.map(r=>r.address)).size).toBe(5);expect(p.ready.every(r=>![key(1),key(2),key(9)].includes(r.address))).toBe(true);expect(p.counts.ready).toBe(9);
  });
  it("returns a capped compact view without materializing full candidate archives",async()=>{
    const {db}=setup(),c=await seed(db),base=(await scoreResearchDetail(db,c.address,"discovery-score-v1"))!.cohort;await db.prepare("DELETE FROM tenx_score_cohorts").run();
    for(let i=1;i<=501;i++){const header={...base.summary,address:key(i)};const {cohort_hash:_,...body}=header;header.cohort_hash=await hashJson(body);await db.prepare("INSERT INTO tenx_score_cohorts VALUES(?1,'discovery-score-v1',?2,'2026-10-21',?3,1,?4)").bind(key(i),captured.toISOString(),header.cohort_hash,JSON.stringify({summary:header,scorecard:{inputs:{candidate:{address:key(i),pool:key(i+10000),mode:"live"}}}})).run();}
    const p=await plan(db,captured);expect(p.capped).toBe(true);expect(p.counts.pending).toBe(500);expect(p.ready).toEqual([]);
  });
});
describe("expired score cohorts share owned market batches",()=>{
  it.each(["dexscreener","geckoterminal"] as const)("collects an expired %s endpoint and finalizes without refreshing or resurrecting the candidate",async provider=>{
    const {db}=setup(),c=await seed(db,0,captured,{source:provider});await expireCandidates(db,target);expect(await candidates(db)).toEqual([]);const before=await payload(db,c.address),frozen=(await scoreResearchDetail(db,c.address,"discovery-score-v1"))!.cohort;
    const transport=vi.fn(async()=>Response.json(provider==="dexscreener"?[pair(c)]:{data:[{attributes:{address:c.pool,base_token_price_usd:".002",market_cap_usd:200000,fdv_usd:250000,reserve_in_usd:60000,volume_usd:{h24:10000}},relationships:{base_token:{data:{id:`solana_${c.address}`}}}}]}));expect(await runMarketCycle({...settings(db,transport),marketProvider:provider==="dexscreener"?provider:undefined},target)).toMatchObject({state:"succeeded",requested:1,research_requested:1,research_updated:1});expect(transport).toHaveBeenCalledOnce();expect(await payload(db,c.address)).toBe(before);expect(await candidates(db)).toEqual([]);
    expect(assess(JSON.parse(before),DEFAULT_POLICY,target).eligibility).toBe("excluded");expect((await scoreResearchDetail(db,c.address,"discovery-score-v1"))!.cohort).toEqual(frozen);expect(await db.prepare("SELECT count(*) n FROM tenx_cohorts").first()).toEqual({n:1});expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='market'").first()).toEqual({used:1});
    await runScoreResearch(db,later(7200000));const detail=(await scoreResearchDetail(db,c.address,"discovery-score-v1"))!;expect(detail.outcome!.result.status).toBe("measured");expect(detail.outcome!.result.price_return_pct).toBe(100);expect(detail.outcome!.result.endpoint!.fetched_at).toBe(target.toISOString());expect((await plan(db,later(7200000))).counts.pending).toBe(0);
  });
  it("keeps ten contenders and ten migration screens inside one 30-target batch with at most five follow-ups",async()=>{
    const {db}=setup(),old:Candidate[]=[];for(let i=1;i<=7;i++)old.push(await seed(db,i));await expireCandidates(db,target);
    const base=(await fixtureCandidates(target))[0]!;for(let i=100;i<120;i++)await saveCandidate(db,{...identity(base,i),mode:"live"});
    for(let i=200;i<210;i++)await db.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES(?1,?2,?3,?4,?5)").bind(key(i),key(i+10000),JSON.stringify({blockTime:target.getTime()/1000}),`synthetic-${i}`,target.toISOString()).run();
    let addresses:string[]=[];
    // Quotes are intentionally absent: this checks bounded allocation, not source success.
    const result=await runMarketCycle(settings(db,async input=>{addresses=String(input).split("/").at(-1)!.split(",");return Response.json([]);}),target);
    expect(result).toMatchObject({requested:30,research_requested:5});expect(addresses.filter(a=>old.some(c=>c.address===a))).toHaveLength(5);expect(addresses.filter(a=>Array.from({length:10},(_,i)=>key(i+200)).includes(a))).toHaveLength(10);expect(addresses.slice(0,10).every(a=>Array.from({length:20},(_,i)=>key(i+100)).includes(a))).toBe(true);expect(new Set(addresses).size).toBe(30);expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='market'").first()).toEqual({used:1});
  });
  it.each(["paused","expired","replaced"])("discards follow-up history after lease/control becomes %s",async change=>{
    const {db,sqlite}=setup(),c=await seed(db);await expireCandidates(db,target);const before=await payload(db,c.address);
    const transport=vi.fn(async()=>{if(change==="paused")sqlite.exec("UPDATE tenx_control SET paused=1");if(change==="expired")sqlite.prepare("UPDATE tenx_market_control SET lease_until=?").run(target.toISOString());if(change==="replaced")sqlite.exec("UPDATE tenx_market_control SET lease_owner='replacement'");return Response.json([pair(c)]);});
    expect(await runMarketCycle(settings(db,transport),target)).toMatchObject({state:"discarded",updated:0});expect(await payload(db,c.address)).toBe(before);expect(await db.prepare("SELECT count(*) n FROM tenx_market_history WHERE fetched_at=?1").bind(target.toISOString()).first()).toEqual({n:0});
  });
  it("backs off failed research quotes, reserves the normal budget and never forces a retry",async()=>{
    const {db}=setup();await seed(db);await expireCandidates(db,target);const transport=vi.fn(async()=>new Response("",{status:429}));expect(await runMarketCycle(settings(db,transport),target)).toMatchObject({state:"failed",error_code:"market_rate_limited"});expect(await runMarketCycle(settings(db,transport),later(60000))).toMatchObject({state:"waiting"});expect(await runMarketCycle(settings(db,transport),later(300000))).toMatchObject({state:"empty"});expect(transport).toHaveBeenCalledOnce();expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='market'").first()).toEqual({used:1});expect((await plan(db,later(300000))).counts.cooling_down).toBe(1);
  });
  it("isolates invalid frozen research inputs while allowing a current contender to refresh",async()=>{
    const {db,sqlite}=setup();await seed(db);await expireCandidates(db,target);sqlite.exec("UPDATE tenx_score_cohorts SET payload=json_set(payload,'$.scorecard.inputs.candidate.name','corrupt')");
    const current={...(await fixtureCandidates(target))[0]!,address:key(222),pool:key(10222),mode:"live" as const};await saveCandidate(db,identity(current,222));const transport=vi.fn(async()=>Response.json([pair(current)]));
    expect(await runMarketCycle(settings(db,transport),target)).toMatchObject({state:"partial",requested:1,updated:1,research_requested:0,research_withheld:1,error_code:"score_followup_evidence_invalid"});expect(transport).toHaveBeenCalledOnce();expect(JSON.parse(await payload(db,current.address)).market.price_usd).toBe(.002);
  });
  it("rolls back research history on publication failure while retaining its spent request reservation",async()=>{
    const {db,sqlite}=setup(),c=await seed(db);await expireCandidates(db,target);const before=await payload(db,c.address);sqlite.exec(`CREATE TRIGGER reject_endpoint BEFORE INSERT ON tenx_market_history WHEN NEW.fetched_at='${target.toISOString()}' BEGIN SELECT RAISE(ABORT,'endpoint_write_failed'); END`);
    expect(await runMarketCycle(settings(db,async()=>Response.json([pair(c)])),target)).toMatchObject({state:"failed",error_code:"market_persistence_unavailable"});expect(await payload(db,c.address)).toBe(before);expect(await db.prepare("SELECT count(*) n FROM tenx_market_history WHERE fetched_at=?1").bind(target.toISOString()).first()).toEqual({n:0});expect(await db.prepare("SELECT attempted_at FROM tenx_market_attempts WHERE address=?1").bind(c.address).first()).toEqual({attempted_at:target.toISOString()});expect(await db.prepare("SELECT last_commit_owner,last_success FROM tenx_market_control").first()).toEqual({last_commit_owner:null,last_success:null});
  });
  it("withholds source work after quota exhaustion or frozen input corruption",async()=>{
    const {db,sqlite}=setup();await seed(db);await expireCandidates(db,target);const transport=vi.fn();await db.prepare("INSERT INTO tenx_usage VALUES('market','2026-10-22',600)").run();expect(await runMarketCycle(settings(db,transport),target)).toMatchObject({error_code:"market_daily_budget_exhausted"});expect(transport).not.toHaveBeenCalled();
    sqlite.exec("UPDATE tenx_market_control SET next_refresh_at=NULL;UPDATE tenx_score_cohorts SET payload=json_set(payload,'$.scorecard.inputs.candidate.name','corrupted')");expect(await runMarketCycle(settings(db,transport),target)).toMatchObject({state:"failed"});expect(transport).not.toHaveBeenCalled();
  });
  it("serves cached follow-up state through the local read API",async()=>{
    const {db}=setup();await seed(db);const env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_MARKET_PROVIDER:"dexscreener",TENX_MARKET_ENABLED:"true"} as LocalEnv;
    const response=await handle(new Request("http://127.0.0.1:8794/api/10x/research/scores/followup"),env);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect((await response.json() as {data:{provider_requests:number}}).data.provider_requests).toBe(0);
  });
});
