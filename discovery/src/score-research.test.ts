import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {defaultScoreInput,freezeDiscoveryScore} from "./discovery-score";
import {freezeScoreCohort,freezeScoreOutcome,replayScoreCohort,replayScoreOutcome,verifyScoreCohortSummary,SCORE_OUTCOME_DELAY} from "./score-research-analysis";
import {publishScoreCohort,runScoreResearch,scoreResearch,scoreResearchDetail} from "./score-research";
import {SCORE_RESEARCH_LIMITS as L,type ScoreCohort,type ScoreEndpoint} from "./score-research-model";
import {DEFAULT_POLICY,type Candidate} from "./model";
import {key} from "./wallet-fixtures.test-helper";
import {handle,type LocalEnv} from "./worker";

const at=new Date("2026-10-21T01:00:00.000Z"),mature=new Date(at.getTime()+SCORE_OUTCOME_DELAY),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
async function candidate(){return {...(await fixtureCandidates(at))[0]!,mode:"live" as const};}
async function cohort(c?:Candidate){return freezeScoreCohort(await freezeDiscoveryScore(defaultScoreInput(c??await candidate(),at)));}
function endpoint(c:ScoreCohort,offset=0):ScoreEndpoint{return {...c.summary.baseline!,fetched_at:new Date(at.getTime()+86_400_000+offset).toISOString(),observed_at:null};}
function input(c:ScoreCohort,points=[endpoint(c)]){return {version:"score-outcome-input-v1" as const,cohort:c.summary,finalized_at:mature.toISOString(),points,history_limited:false};}
async function lease(db:D1Database,owner="owner",time=at){await db.prepare("UPDATE tenx_score_control SET lease_owner=?1,lease_until=?2 WHERE id=1").bind(owner,new Date(time.getTime()+120000).toISOString()).run();}
async function put(db:D1Database,c:Candidate){await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?1,?2,?3,?4,?5)").bind(c.mode,c.address,c.pool,JSON.stringify(c),c.checked_at).run();}

describe("prospective score evidence and comparable outcomes",()=>{
  it("retains exactly the scored inputs and independent action status, with offline replay",async()=>{
    const r=await cohort();expect(r.summary.captured_at).toBe(at.toISOString());expect(r.summary.action_status).toBe("provisional");expect(await replayScoreCohort(r)).toEqual(r);expect(await verifyScoreCohortSummary(r.summary)).toEqual(r.summary);
    const tampered=structuredClone(r);tampered.summary.score.value++;await expect(replayScoreCohort(tampered)).rejects.toThrow();await expect(verifyScoreCohortSummary(tampered.summary)).rejects.toThrow();
  });
  it("pins action-label policy independently of future defaults and preserves early captures without an explicit field",async()=>{
    const r=await cohort();expect(r.action_policy).toEqual(DEFAULT_POLICY);
    const early=structuredClone(r);delete early.action_policy;expect(await replayScoreCohort(early)).toEqual(early);
    const changed=structuredClone(r);changed.action_policy!.min_liquidity_usd=1000000;await expect(replayScoreCohort(changed)).rejects.toThrow("replay_mismatch");
    const original=DEFAULT_POLICY.min_liquidity_usd;try{DEFAULT_POLICY.min_liquidity_usd=1000000;expect(await replayScoreCohort(r)).toEqual(r);}finally{DEFAULT_POLICY.min_liquidity_usd=original;}
  });
  it("captures excluded and missing-market observations without pretending they have a usable baseline",async()=>{
    const c=await candidate();c.verification="rejected";c.market=null;const r=await cohort(c);expect(r.summary.score.value).toBe(0);expect(r.summary.action_status).toBe("excluded");expect(r.summary.baseline).toBeNull();
    const result=await freezeScoreOutcome(input(r,[]));expect(result.result.status).toBe("insufficient_data");expect(result.result.severe_decline).toBeNull();
  });
  it("rejects fixtures, old creations and future snapshot evidence",async()=>{
    const c=await candidate();await expect(cohort({...c,mode:"fixture"})).rejects.toThrow("recent_live");await expect(cohort({...c,creation:{...c.creation!,block_time:new Date(at.getTime()-86400001).toISOString()}})).rejects.toThrow("recent_live");await expect(cohort({...c,checked_at:new Date(at.getTime()+1).toISOString()})).rejects.toThrow("future_score");
  });
  it("withholds a stale or contradictory provider baseline",async()=>{
    const c=await candidate();c.market!.fetched_at=new Date(at.getTime()-180001).toISOString();expect((await cohort(c)).summary.baseline).toBeNull();
    c.market!.fetched_at=new Date(at.getTime()-1000).toISOString();c.market!.observed_at=at.toISOString();expect((await cohort(c)).summary.baseline).toBeNull();
  });
  it("waits for the complete grace window and deterministically prefers the earlier equidistant endpoint",async()=>{
    const c=await cohort(),data=input(c,[endpoint(c,60000),endpoint(c,-60000)]);await expect(freezeScoreOutcome({...data,finalized_at:new Date(mature.getTime()-1).toISOString()})).rejects.toThrow("not_mature");
    const r=await freezeScoreOutcome(data);expect(r.result.status).toBe("measured");expect(r.result.endpoint!.fetched_at).toBe(endpoint(c,-60000).fetched_at);expect(await replayScoreOutcome(r,c.summary)).toEqual(r);
  });
  it("measures reported zero endpoints as a severe decline, not missing data or a proven rug",async()=>{
    const c=await cohort(),r=await freezeScoreOutcome(input(c,[{...endpoint(c),price_usd:0,liquidity_usd:0}]));expect(r.result.price_return_pct).toBe(-100);expect(r.result.liquidity_change_pct).toBe(-100);expect(r.result.severe_decline).toBe(true);expect(r.result.gaps).toContain("decline_not_proof_of_fraud");
  });
  it.each(["different-source","future-observation","outside-window","duplicate-instant"])("withholds unsuitable endpoints: %s",async kind=>{
    const c=await cohort(),p=endpoint(c);let points=[p];
    if(kind==="different-source")points=[{...p,source:p.source==="geckoterminal"?"dexscreener":"geckoterminal"}];
    if(kind==="future-observation")points=[{...p,observed_at:new Date(Date.parse(p.fetched_at)+1).toISOString()}];
    if(kind==="outside-window")points=[endpoint(c,7200001)];
    if(kind==="duplicate-instant")points=[p,{...p,fetched_at:p.fetched_at.replace(".000Z","Z")}];
    const r=await freezeScoreOutcome(input(c,points));expect(r.result.status).toBe("insufficient_data");expect(r.result.endpoint).toBeNull();expect(r.result.severe_decline).toBeNull();
  });
  it("withholds oversized histories, unknown denominators and overflow comparisons",async()=>{
    const c=await cohort(),r=await freezeScoreOutcome({...input(c),history_limited:true});expect(r.result.endpoint).toBeNull();expect(r.result.gaps).toContain("endpoint_sample_limit");
    const zero=await candidate();zero.market!.liquidity_usd=0;const z=await cohort(zero);expect((await freezeScoreOutcome(input(z))).result.liquidity_change_pct).toBeNull();
    const tiny=await candidate();tiny.market!.price_usd=Number.MIN_VALUE;const t=await cohort(tiny);expect((await freezeScoreOutcome(input(t,[{...endpoint(t),price_usd:Number.MAX_VALUE}]))).result.price_return_pct).toBeNull();
    await expect(freezeScoreOutcome({...input(c),points:Array.from({length:257},()=>endpoint(c))})).rejects.toThrow();
  });
  it("rejects changed outcomes, inputs and mismatched cohorts on replay",async()=>{
    const c=await cohort(),r=await freezeScoreOutcome(input(c)),changed=structuredClone(r);changed.result.price_return_pct=123;await expect(replayScoreOutcome(changed,c.summary)).rejects.toThrow();
    const swapped=await cohort({...await candidate(),address:key(110)});await expect(replayScoreOutcome(r,swapped.summary)).rejects.toThrow();
    const inputs=structuredClone(r);inputs.inputs.points[0]!.price_usd=1;await expect(replayScoreOutcome(inputs,c.summary)).rejects.toThrow();
  });
});
describe("bounded score retention on existing local maintenance",()=>{
  it("publishes once with a single atomic audit and never substitutes a later grade",async()=>{
    const {db,sqlite}=setup(),c=await cohort();await lease(db);expect(await publishScoreCohort(db,c,"owner",at)).toBe(true);
    const updated=await candidate();updated.market!.liquidity_usd=0;expect(await publishScoreCohort(db,await cohort(updated),"owner",at)).toBe(false);
    expect((await scoreResearchDetail(db,c.summary.address,"discovery-score-v1"))!.cohort).toEqual(c);expect(sqlite.prepare("SELECT count(*) n FROM tenx_audit WHERE action='score_cohort'").get()).toEqual({n:1});
  });
  it.each(["paused","expired","replaced"])("prevents publication after %s",async state=>{
    const {db,sqlite}=setup(),c=await cohort();await lease(db);
    if(state==="paused")sqlite.exec("UPDATE tenx_control SET paused=1 WHERE id=1");if(state==="expired")sqlite.prepare("UPDATE tenx_score_control SET lease_until=? WHERE id=1").run(at.toISOString());if(state==="replaced")sqlite.exec("UPDATE tenx_score_control SET lease_owner='replacement' WHERE id=1");
    expect(await publishScoreCohort(db,c,"owner",at)).toBe(false);expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:0});expect(sqlite.prepare("SELECT count(*) n FROM tenx_audit WHERE action='score_cohort'").get()).toEqual({n:0});
  });
  it("rolls back the cohort if its audit fails",async()=>{
    const {db,sqlite}=setup(),c=await cohort();await lease(db);sqlite.exec("CREATE TRIGGER reject_score_audit BEFORE INSERT ON tenx_audit WHEN NEW.action='score_cohort' BEGIN SELECT RAISE(ABORT,'audit_failed'); END");await expect(publishScoreCohort(db,c,"owner",at)).rejects.toThrow("audit_failed");expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:0});
  });
  it.each(["records","bytes"])("enforces the atomic daily %s bound",async bound=>{
    const {db,sqlite}=setup(),c=await cohort();await lease(db);
    const n=bound==="records"?100:6,b=bound==="records"?1:1_666_650;for(let i=0;i<n;i++)sqlite.prepare("INSERT INTO tenx_score_cohorts VALUES(?,'discovery-score-v1',?,'2026-10-21','hash',?,'{}')").run(`filler-${i}`,at.toISOString(),b);
    expect(await publishScoreCohort(db,c,"owner",at)).toBe(false);expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n});
  });
  it("rejects backdated publication and inherits the existing score-input size bound",async()=>{
    const {db}=setup(),c=await cohort();await lease(db);await expect(publishScoreCohort(db,c,"owner",new Date(at.getTime()+L.lease_ms+1))).rejects.toThrow("capture_time");
    const big=await candidate();big.risk.token_program="x".repeat(L.record_bytes);await expect(cohort(big)).rejects.toThrow("discovery_score_input_size_limit");
  });
  it("captures at most three all-status tokens without provider work and reports bounded first-seen research",async()=>{
    const {db}=setup(),c=await candidate(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No providers"));
    for(let i=0;i<5;i++)await put(db,{...c,address:key(i+90),verification:i===0?"rejected":"verified"});
    expect(await runScoreResearch(db,at)).toMatchObject({state:"succeeded",captured:3,attempted:3,provider_requests:0});expect((await scoreResearch(db,at)).counts).toEqual({captured:3,pending:3,measured:0,insufficient:0});
    expect((await scoreResearch(db,at)).recent.some(r=>r.cohort.action_status==="excluded")).toBe(true);expect(await runScoreResearch(db,at)).toMatchObject({state:"waiting"});expect(network).not.toHaveBeenCalled();
    await runScoreResearch(db,new Date(at.getTime()+60000));expect((await scoreResearch(db,new Date(at.getTime()+60000))).counts.captured).toBe(5);
  });
  it("finalizes once from exact saved endpoints and rejects stored summary/outcome corruption",async()=>{
    const {db,sqlite}=setup(),c=await candidate();await put(db,c);await runScoreResearch(db,at);const saved=(await scoreResearchDetail(db,c.address))!,p=endpoint(saved.cohort);
    await db.prepare("INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(c.address,p.fetched_at,JSON.stringify({...c.market!,...p})).run();
    expect(await runScoreResearch(db,mature)).toMatchObject({state:"succeeded",finalized:1});const detail=(await scoreResearchDetail(db,c.address))!;expect(detail.outcome!.result.status).toBe("measured");expect((await scoreResearch(db,mature)).bands.reduce((n,b)=>n+b.measured,0)).toBe(1);
    await runScoreResearch(db,new Date(mature.getTime()+60000));expect((await scoreResearchDetail(db,c.address))!.outcome).toEqual(detail.outcome);
    sqlite.exec("UPDATE tenx_score_outcomes SET payload=json_set(payload,'$.result.price_return_pct',500)");await expect(scoreResearch(db,mature)).rejects.toThrow();
  });
  it("does no work while paused or when a different lease is held",async()=>{
    const {db,sqlite}=setup();await put(db,await candidate());sqlite.exec("UPDATE tenx_control SET paused=1");expect(await runScoreResearch(db,at)).toMatchObject({state:"paused"});sqlite.exec("UPDATE tenx_control SET paused=0");await lease(db);expect(await runScoreResearch(db,at)).toMatchObject({state:"waiting"});expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:0});
  });
  it("finalizes at most five matured cohorts in a turn and retains insufficient endpoints",async()=>{
    const {db}=setup(),base=await candidate();await lease(db);
    for(let i=0;i<6;i++)expect(await publishScoreCohort(db,await cohort({...base,address:key(120+i)}),"owner",at)).toBe(true);
    await db.prepare("UPDATE tenx_score_control SET lease_owner=NULL,lease_until=NULL").run();
    expect(await runScoreResearch(db,mature)).toMatchObject({finalized:5});expect((await scoreResearch(db,mature,"discovery-score-v1")).counts).toEqual({captured:6,pending:1,measured:0,insufficient:5});
    expect(await runScoreResearch(db,new Date(mature.getTime()+60000))).toMatchObject({finalized:1});
  });
  it("holds an oversized cached endpoint series instead of measuring its truncated prefix",async()=>{
    const {db}=setup(),c=await candidate();await put(db,c);await runScoreResearch(db,at);const saved=(await scoreResearchDetail(db,c.address))!;
    for(let i=0;i<257;i++){const p=endpoint(saved.cohort,i*1000);await db.prepare("INSERT INTO tenx_market_history VALUES(?1,?2,?3)").bind(c.address,p.fetched_at,JSON.stringify({...c.market!,...p})).run();}
    await runScoreResearch(db,mature);const result=(await scoreResearchDetail(db,c.address))!.outcome!;expect(result.inputs.points).toHaveLength(256);expect(result.inputs.history_limited).toBe(true);expect(result.result.endpoint).toBeNull();expect(result.result.status).toBe("insufficient_data");
  });
  it.each(["paused","replaced","expired"])("rechecks %s state at outcome publication without clearing a replacement lease",async state=>{
    const {db,sqlite}=setup(),c=await candidate();await put(db,c);await runScoreResearch(db,at);
    const original=db.prepare.bind(db);vi.spyOn(db,"prepare").mockImplementation(sql=>{const stmt=original(sql);if(sql.startsWith("INSERT OR IGNORE INTO tenx_score_outcomes")){const run=stmt.run.bind(stmt);vi.spyOn(stmt,"run").mockImplementation(async()=>{if(state==="paused")sqlite.exec("UPDATE tenx_control SET paused=1");if(state==="replaced")sqlite.exec("UPDATE tenx_score_control SET lease_owner='replacement'");if(state==="expired")sqlite.prepare("UPDATE tenx_score_control SET lease_until=?").run(mature.toISOString());return run();});}return stmt;});
    expect(await runScoreResearch(db,mature)).toMatchObject({state:"held",finalized:0});expect((await scoreResearchDetail(db,c.address))!.outcome).toBeNull();
    if(state==="replaced")expect(sqlite.prepare("SELECT lease_owner FROM tenx_score_control").get()).toEqual({lease_owner:"replacement"});
  });
  it("serves cached strict research and replay endpoints without enabling capabilities",async()=>{
    const {db}=setup(),c=await candidate();await put(db,c);await runScoreResearch(db,at);const env={TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64),TENX_LOCAL_ONLY:"true"} as LocalEnv;
    const response=await handle(new Request("http://127.0.0.1:8794/api/10x/research/scores"),env);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    const detail=await handle(new Request(`http://127.0.0.1:8794/api/10x/research/scores/solana/${c.address}?model=discovery-score-v3`),env);expect(detail.status).toBe(200);expect((await detail.json() as {replay:string}).replay).toBe("verified");
  });
});
