import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {defaultScoreInput,freezeDiscoveryScore} from "./discovery-score";
import {defaultScoreInputV2,freezeDiscoveryScoreV2} from "./discovery-score-v2";
import {defaultScoreInputV3,freezeDiscoveryScoreV3} from "./discovery-score-v3";
import {freezeScoreCohort,freezeScoreOutcome,replayScoreCohort,replayScoreOutcome,SCORE_OUTCOME_DELAY} from "./score-research-analysis";
import {publishScoreCohort,runScoreResearch,scoreResearch,scoreResearchDetail} from "./score-research";
import {scoreFollowupPlan,verifyScoreFollowup} from "./score-followup";
import {ScoreResearchSchema,type ScoreCohort,type ScoreModel} from "./score-research-model";
import {CandidateSchema,type Candidate} from "./model";
import {key} from "./wallet-fixtures.test-helper";
import worker,{type LocalEnv} from "./worker";

const at=new Date("2026-10-21T01:00:00.000Z"),mature=new Date(at.getTime()+SCORE_OUTCOME_DELAY),opened:DatabaseSync[]=[];
const migration=readFileSync(new URL("../migrations/0038_score_model_versions.sql",import.meta.url),"utf8");
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
function setup(before=false){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);sqlite.exec("PRAGMA foreign_keys=on");for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")&&(!before||f<"0038")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
async function candidate(){return {...(await fixtureCandidates(at))[0]!,mode:"live" as const};}
async function cohort(c:Candidate,model:ScoreModel="discovery-score-v2",time=at){return freezeScoreCohort(model==="discovery-score-v3"?await freezeDiscoveryScoreV3(defaultScoreInputV3(c,time)):model==="discovery-score-v1"?await freezeDiscoveryScore(defaultScoreInput(c,time)):await freezeDiscoveryScoreV2(defaultScoreInputV2(c,time)));}
async function lease(db:D1Database,time=at){await db.prepare("UPDATE tenx_score_control SET lease_owner='owner',lease_until=?1 WHERE id=1").bind(new Date(time.getTime()+120000).toISOString()).run();}
async function put(db:D1Database,c:Candidate){await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?1,?2,?3,?4,?5)").bind(c.mode,c.address,c.pool,JSON.stringify(c),c.checked_at).run();}
async function endpoint(db:D1Database,c:Candidate){await db.prepare("INSERT INTO tenx_market_history VALUES(?1,?2,?3)").bind(c.address,new Date(at.getTime()+86400000).toISOString(),JSON.stringify({...c.market!,fetched_at:new Date(at.getTime()+86400000).toISOString()})).run();}

describe("model-separated score research",()=>{
  it("migrates existing cohort/outcome bytes and attempt times with foreign keys enforced",async()=>{
    const {db,sqlite}=setup(true),c=await cohort(await candidate(),"discovery-score-v1");await lease(db);await publishScoreCohort(db,c,"owner",at);
    const o=await freezeScoreOutcome({version:"score-outcome-input-v1",cohort:c.summary,finalized_at:mature.toISOString(),points:[],history_limited:false});
    sqlite.prepare("INSERT INTO tenx_score_outcomes VALUES(?,'discovery-score-v1',?,?,?)").run(c.summary.address,c.summary.cohort_hash,mature.toISOString(),JSON.stringify(o));
    sqlite.prepare("INSERT INTO tenx_score_attempts VALUES(?,?,?)").run(c.summary.address,at.toISOString(),"original_gap");
    const cohorts=sqlite.prepare("SELECT * FROM tenx_score_cohorts").all(),outcomes=sqlite.prepare("SELECT * FROM tenx_score_outcomes").all();
    sqlite.exec("BEGIN");sqlite.exec(migration);sqlite.exec("COMMIT");
    expect(sqlite.prepare("SELECT * FROM tenx_score_cohorts").all()).toEqual(cohorts);expect(sqlite.prepare("SELECT * FROM tenx_score_outcomes").all()).toEqual(outcomes);expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM tenx_score_attempts").get()).toEqual({address:c.summary.address,model:"discovery-score-v1",attempted_at:at.toISOString(),gap:"original_gap"});
    expect((await scoreResearchDetail(db,c.summary.address,"discovery-score-v1"))!.cohort).toEqual(c);expect(await replayScoreOutcome(o,c.summary)).toEqual(o);
    expect(await publishScoreCohort(db,await cohort(await candidate()),"owner",at)).toBe(true);
  });
  it("rolls back a failed migration without losing retained evidence",async()=>{
    const {db,sqlite}=setup(true),c=await cohort(await candidate(),"discovery-score-v1");await lease(db);await publishScoreCohort(db,c,"owner",at);
    const before=sqlite.prepare("SELECT * FROM tenx_score_cohorts").all();sqlite.exec("BEGIN");expect(()=>sqlite.exec(migration+"\nSELECT * FROM deliberately_missing_migration_table;")).toThrow();sqlite.exec("ROLLBACK");
    expect(sqlite.prepare("SELECT * FROM tenx_score_cohorts").all()).toEqual(before);expect(sqlite.prepare("PRAGMA table_info(tenx_score_attempts)").all()).toHaveLength(3);
  });
  it("retains distinct first records for one mint and rejects cross-model corruption",async()=>{
    const {db,sqlite}=setup(),c=await candidate(),v1=await cohort(c,"discovery-score-v1"),v2=await cohort(c);await lease(db);
    expect(await publishScoreCohort(db,v1,"owner",at)).toBe(true);expect(await publishScoreCohort(db,v2,"owner",at)).toBe(true);expect(await publishScoreCohort(db,v2,"owner",at)).toBe(false);
    expect((await scoreResearch(db,at,"discovery-score-v1")).counts.captured).toBe(1);expect((await scoreResearch(db,at,"discovery-score-v2")).counts.captured).toBe(1);expect(v1.summary.cohort_hash).not.toBe(v2.summary.cohort_hash);
    expect(await replayScoreCohort(v1)).toEqual(v1);expect(await replayScoreCohort(v2)).toEqual(v2);
    sqlite.prepare("UPDATE tenx_score_cohorts SET payload=?,cohort_hash=? WHERE model='discovery-score-v2'").run(JSON.stringify(v1),v1.summary.cohort_hash);
    await expect(scoreResearchDetail(db,c.address,"discovery-score-v2")).rejects.toThrow("identity_mismatch");await expect(scoreResearch(db,at,"discovery-score-v2")).rejects.toThrow("identity_mismatch");
  });
  it("captures v3 at the current time without replacing an earlier v1 or making provider requests",async()=>{
    const {db,sqlite}=setup(),c=await candidate(),v1=await cohort(c,"discovery-score-v1"),time=new Date(at.getTime()+60000);await lease(db);await publishScoreCohort(db,v1,"owner",at);await put(db,c);sqlite.exec("UPDATE tenx_score_control SET lease_owner=NULL,lease_until=NULL");
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No provider"));expect(await runScoreResearch(db,time)).toMatchObject({captured:1,attempted:1,provider_requests:0});
    const v3=(await scoreResearchDetail(db,c.address,"discovery-score-v3"))!.cohort;expect(v3.summary.captured_at).toBe(time.toISOString());expect(v3.scorecard.inputs.policy.version).toBe("discovery-score-v3");expect((await scoreResearchDetail(db,c.address,"discovery-score-v1"))!.cohort).toEqual(v1);
    expect(sqlite.prepare("SELECT model FROM tenx_score_attempts").all()).toEqual([{model:"discovery-score-v3"}]);expect(sqlite.prepare("SELECT count(*) n FROM tenx_usage").get()).toEqual({n:0});expect(network).not.toHaveBeenCalled();
  });
  it("shares the daily record bound across models rather than doubling admission",async()=>{
    const {db,sqlite}=setup(),c=await candidate();await lease(db);for(let i=0;i<99;i++)sqlite.prepare("INSERT INTO tenx_score_cohorts VALUES(?,'discovery-score-v1',?,'2026-10-21','hash',1,'{}')").run(`filler-${i}`,at.toISOString());
    expect(await publishScoreCohort(db,await cohort(c),"owner",at)).toBe(true);expect(await publishScoreCohort(db,await cohort({...c,address:key(211)}),"owner",at)).toBe(false);expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:100});
  });
  it("finalizes at most five across all models using independently frozen inputs",async()=>{
    const {db,sqlite}=setup(),base=await candidate();await lease(db);
    for(let i=0;i<3;i++){const c={...base,address:key(220+i)};for(const model of ["discovery-score-v1","discovery-score-v2","discovery-score-v3"] as const)await publishScoreCohort(db,await cohort(c,model),"owner",at);await endpoint(db,c);}
    sqlite.exec("UPDATE tenx_score_control SET lease_owner=NULL,lease_until=NULL");expect(await runScoreResearch(db,mature)).toMatchObject({finalized:5});expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_outcomes").get()).toEqual({n:5});
    expect(await runScoreResearch(db,new Date(mature.getTime()+60000))).toMatchObject({finalized:4});for(const model of ["discovery-score-v1","discovery-score-v2","discovery-score-v3"] as const){const s=await scoreResearch(db,new Date(mature.getTime()+60000),model);expect(s.counts).toEqual({captured:3,pending:0,measured:3,insufficient:0});expect(s.recent.every(r=>r.cohort.score.version===model)).toBe(true);}
  });
  it("deduplicates shared follow-up mints and honors one shared cooldown across versions",async()=>{
    const {db,sqlite}=setup(),base=await candidate();await lease(db);
    for(let i=0;i<6;i++){const c=CandidateSchema.parse({...base,address:key(230+i),market:{...base.market!,source:"dexscreener"}});await put(db,c);for(const model of ["discovery-score-v1","discovery-score-v2","discovery-score-v3"] as const)await publishScoreCohort(db,await cohort(c,model),"owner",at);}
    const target=new Date(at.getTime()+86400000),plan=await scoreFollowupPlan(db,"dexscreener",true,target);expect(plan.counts.pending).toBe(18);expect(plan.ready).toHaveLength(5);expect(new Set(plan.ready.map(r=>r.address)).size).toBe(5);
    await verifyScoreFollowup(db,plan.ready[0]!,"dexscreener");sqlite.prepare("INSERT INTO tenx_market_attempts VALUES(?,?)").run(plan.ready[0]!.address,target.toISOString());expect((await scoreFollowupPlan(db,"dexscreener",true,target)).counts.cooling_down).toBe(3);
  });
  it("verifies a v2 follow-up against its own provider and rejects a substituted v1 reference",async()=>{
    const {db}=setup(),base=await candidate(),v1=await cohort({...base,market:{...base.market!,source:"geckoterminal"}},"discovery-score-v1"),c={...base,market:{...base.market!,source:"dexscreener" as const}},v2=await cohort(c);await lease(db);await put(db,c);await publishScoreCohort(db,v1,"owner",at);await publishScoreCohort(db,v2,"owner",at);
    const plan=await scoreFollowupPlan(db,"dexscreener",true,new Date(at.getTime()+86400000));expect(plan.counts).toMatchObject({provider_mismatch:1,ready:1});expect(plan.ready[0]!.model).toBe("discovery-score-v2");await expect(verifyScoreFollowup(db,plan.ready[0]!,"dexscreener")).resolves.toBeUndefined();
    await expect(verifyScoreFollowup(db,{...plan.ready[0]!,model:"discovery-score-v1"},"dexscreener")).rejects.toThrow("snapshot_changed");
    const summary=await scoreResearch(db,at,"discovery-score-v2");summary.recent=[{cohort:v1.summary,outcome:null}];expect(ScoreResearchSchema.safeParse(summary).success).toBe(false);
  });
  it("keeps old HTTP reads pinned to v1 and rejects unknown model names",async()=>{
    const {db}=setup(),c=await candidate();await lease(db);for(const model of ["discovery-score-v1","discovery-score-v2","discovery-score-v3"] as const)await publishScoreCohort(db,await cohort(c,model),"owner",at);
    const env={TENX_DB:db,TENX_LOCAL_ONLY:"true"} as LocalEnv,base="http://127.0.0.1:8794/api/10x/research/scores";
    for(const model of ["discovery-score-v1","discovery-score-v2","discovery-score-v3"] as const){const r=await worker.fetch(new Request(`${base}?model=${model}`),env);expect(r.status).toBe(200);expect(ScoreResearchSchema.parse((await r.json() as {data:unknown}).data).model).toBe(model);const detail=await worker.fetch(new Request(`${base}/solana/${c.address}?model=${model}`),env);expect((await detail.json() as {cohort:ScoreCohort}).cohort.summary.score.version).toBe(model);}
    const legacy=await worker.fetch(new Request(`${base}/solana/${c.address}`),env);expect((await legacy.json() as {cohort:ScoreCohort}).cohort.summary.score.version).toBe("discovery-score-v1");expect((await worker.fetch(new Request(`${base}?model=unknown`),env)).status).toBe(400);
  });
});
