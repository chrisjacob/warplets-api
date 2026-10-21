import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import review from "../fixtures/score-usdf-review.json";
import {ScoreRecordV2Schema} from "./discovery-score-v2-model";
import {fixtureCandidates} from "./fixtures";
import {defaultScoreInput,freezeDiscoveryScore} from "./discovery-score";
import {defaultScoreInputV2,freezeDiscoveryScoreV2} from "./discovery-score-v2";
import {scoreFirstMarkets,candidateScorecard} from "./discovery-score-store";
import {defaultScoreInputV3,freezeDiscoveryScoreV3} from "./discovery-score-v3";
import {freezeScoreCohort,freezeScoreOutcome,replayScoreCohort,SCORE_OUTCOME_DELAY} from "./score-research-analysis";

const opened:DatabaseSync[]=[],original=ScoreRecordV2Schema.parse(review.original),at=new Date(original.inputs.as_of);
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
function setup(before=false){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);sqlite.exec("PRAGMA foreign_keys=on");for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")&&(!before||f<"0039")).sort())sqlite.exec(readFileSync(new URL("../migrations/"+f,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
it("projects the earliest retained report even outside 24h, never the current or most valuable quote",async()=>{
  const {sqlite,db}=setup(),c=original.inputs.candidate,first={...review.first_market,fetched_at:new Date(at.getTime()-25*3600000).toISOString(),market_cap_usd:null},later={...c.market!,fetched_at:new Date(at.getTime()-60000).toISOString()};
  for(const p of [later,first])sqlite.prepare("INSERT INTO tenx_market_history VALUES(?,?,?)").run(c.address,p.fetched_at,JSON.stringify(p));
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No provider"));expect((await scoreFirstMarkets(db,[c.address],at)).get(c.address)).toEqual(first);
  sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)").run(c.address,c.pool,JSON.stringify(c),c.checked_at);
  expect((await candidateScorecard(db,c.address,"live",at))!.inputs.first_market).toEqual(first);expect(network).not.toHaveBeenCalled();expect(await scoreFirstMarkets(db,[],at)).toEqual(new Map());
  await expect(scoreFirstMarkets(db,Array(501).fill(c.address),at)).rejects.toThrow("inventory_limit");
  sqlite.prepare("UPDATE tenx_market_history SET payload=json_set(payload,'$.fetched_at',?) WHERE fetched_at=?").run(later.fetched_at,first.fetched_at);await expect(scoreFirstMarkets(db,[c.address],at)).rejects.toThrow("identity_mismatch");
});
it("migrates retained v1/v2 cohorts, outcomes and attempt bytes atomically; admits v3 without rewriting history",async()=>{
  const {sqlite}=setup(true),atString=at.toISOString(),candidate={...(await fixtureCandidates(at))[0]!,mode:"live" as const},cohorts=[await freezeScoreCohort(await freezeDiscoveryScore(defaultScoreInput(candidate,at))),await freezeScoreCohort(await freezeDiscoveryScoreV2(defaultScoreInputV2(candidate,at)))];
  for(const cohort of cohorts){const model=cohort.summary.score.version,outcome=await freezeScoreOutcome({version:"score-outcome-input-v1",cohort:cohort.summary,finalized_at:new Date(at.getTime()+SCORE_OUTCOME_DELAY).toISOString(),points:[],history_limited:false});sqlite.prepare("INSERT INTO tenx_score_cohorts VALUES(?,?,?,?,?,?,?)").run(cohort.summary.address,model,atString,atString.slice(0,10),cohort.summary.cohort_hash,JSON.stringify(cohort).length,JSON.stringify(cohort));sqlite.prepare("INSERT INTO tenx_score_outcomes VALUES(?,?,?,?,?)").run(cohort.summary.address,model,cohort.summary.cohort_hash,outcome.result.finalized_at,JSON.stringify(outcome));sqlite.prepare("INSERT INTO tenx_score_attempts VALUES(?,?,?,?)").run(cohort.summary.address,model,atString,"retained_gap");}
  const snapshot=()=>["tenx_score_cohorts","tenx_score_outcomes","tenx_score_attempts"].map(t=>sqlite.prepare("SELECT * FROM "+t+" ORDER BY address,model").all()),before=snapshot(),migration=readFileSync(new URL("../migrations/0039_score_launch_review.sql",import.meta.url),"utf8");
  sqlite.exec("BEGIN");expect(()=>sqlite.exec(migration+"\nSELECT * FROM deliberately_missing;")).toThrow();sqlite.exec("ROLLBACK");expect(snapshot()).toEqual(before);
  sqlite.exec("BEGIN");sqlite.exec(migration);sqlite.exec("COMMIT");expect(snapshot()).toEqual(before);expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  for(const cohort of cohorts)expect(await replayScoreCohort(cohort)).toEqual(cohort);const v3=await freezeScoreCohort(await freezeDiscoveryScoreV3(defaultScoreInputV3(candidate,at)));
  sqlite.prepare("INSERT INTO tenx_score_cohorts VALUES(?,?,?,?,?,?,?)").run(v3.summary.address,"discovery-score-v3",atString,atString.slice(0,10),v3.summary.cohort_hash,JSON.stringify(v3).length,JSON.stringify(v3));expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:3});
});
