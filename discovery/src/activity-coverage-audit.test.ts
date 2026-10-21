import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {ActivityMetric,activityObservation} from "./activity-observation";
import {activityCoverageAudit,CoverageAuditInput,freezeActivityCoverage,summarizeActivityCoverage,verifyActivityCoverage} from "./activity-coverage-audit";
import {key} from "./wallet-fixtures.test-helper";
import {GMGN_REGRESSION_MINTS} from "./gmgn-rotation";
import {hashJson} from "./solana";
import {toBase58} from "./solana";
import {CandidateSchema} from "./model";
import {exportCoverageAudit,verifyCoverageAudit} from "../../scripts/discovery-coverage-audit";

const at=new Date("2026-10-21T09:05:00.000Z"),opened:DatabaseSync[]=[],directories:string[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();for(const dir of directories.splice(0)){expect(path.basename(dir)).toMatch(/^coverage-audit-test-/);expect(path.dirname(dir)).toBe(temp);rmSync(dir,{recursive:true,force:true});}});
const temp=fileURLToPath(new URL("../../.tmp",import.meta.url));
function directory(){mkdirSync(temp,{recursive:true});const dir=mkdtempSync(path.join(temp,"coverage-audit-test-"));directories.push(dir);return dir;}
function input(address=key(1)):CoverageAuditInput{
  return {version:"activity-coverage-input-v1",cutoff_at:at.toISOString(),scope:"all_retained_live_candidates",rows:[{
    address,candidate_hash:"a".repeat(64),age_band:"first_day",state:"available",gaps:[],
    observations:ActivityMetric.options.map(metric=>activityObservation({address,cutoff_at:at.toISOString(),metric,source:"unavailable",unit:metric==="meaningful_holder_growth_24h"?"owners":"USD"})),
  }]};
}
async function setup(file=":memory:"){
  const sqlite=new DatabaseSync(file);opened.push(sqlite);
  for(const name of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  const candidate={...(await fixtureCandidates(at))[0]!,mode:"live" as const},db=sqliteD1(sqlite);
  const put=(address:string,payload:unknown)=>sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)").run(address,candidate.pool,typeof payload==="string"?payload:JSON.stringify(payload),candidate.checked_at);
  return {sqlite,db,candidate,put};
}

describe("activity coverage audit",()=>{
  it("retains zero and all missing/held/rejected observations in each metric denominator",()=>{
    const data=input();const row=data.rows[0]!;
    row.observations[0]=activityObservation({address:row.address,cutoff_at:at.toISOString(),metric:"pool_reported_volume_24h",source:"dexscreener",unit:"USD"},
      {value:0,qualification:"reported_only",freshness:"fresh",fetched_at:at.toISOString(),window:{kind:"reported_rolling",duration_seconds:86400,start_at:null,end_at:null}});
    data.rows.push({...input(key(2)).rows[0]!,state:"held",candidate_hash:null,age_band:"unknown",observations:[],gaps:["bad_candidate"]});
    for(const [index,qualification] of (["supported_sample","held","rejected","missing"] as const).entries()){
      const extra=input(key(index+3)).rows[0]!;
      extra.observations[0]=activityObservation({address:extra.address,cutoff_at:at.toISOString(),metric:"pool_reported_volume_24h",source:"dexscreener",unit:"USD"},
        {value:qualification==="supported_sample"?5:null,qualification,freshness:"stale",fetched_at:"2026-10-21T08:00:00.000Z",
          window:{kind:"observed_interval",duration_seconds:60,start_at:"2026-10-21T07:59:00.000Z",end_at:"2026-10-21T08:00:00.000Z"},
          references:[{kind:"gmgn_receipt",id:"fixture",hash:"b".repeat(64),integrity:"archived_hash_verified"}]});
      data.rows.push(extra);
    }
    const summary=summarizeActivityCoverage(data),metric=summary.strata[0]!.metrics[0]!;
    expect(metric).toMatchObject({denominator:6,numeric:2,fresh_numeric:1,numeric_with_explicit_bounds:1,numeric_with_archived_hash_references:1,
      qualification:{reported_only:1,supported_sample:1,held:1,rejected:1,missing:1,candidate_held:1}});
    for(const m of summary.strata[0]!.metrics){expect(Object.values(m.qualification).reduce((a,b)=>a+b,0)).toBe(6);expect(Object.values(m.freshness).reduce((a,b)=>a+b,0)).toBe(6);}
    expect(summary.scoring_effect).toBe("none");expect(summary.prospective_study_enrollment).toBe(false);
  });
  it("separates founder regression references and unknown/older ages without omitting either",()=>{
    const data=input();data.rows.push({...input(GMGN_REGRESSION_MINTS[0]).rows[0]!,age_band:"older"});
    const strata=summarizeActivityCoverage(data).strata;
    expect(strata.map(s=>[s.id,s.candidates])).toEqual([["all_retained",2],["coverage_population",1],["regression_references",1],["age_first_day",1],["age_older",1],["age_unknown",0]]);
  });
  it("rejects duplicate/missing metrics, mixed cutoffs, foreign identity and duplicate inventory entries",()=>{
    for(const mutate of [
      (v:CoverageAuditInput)=>v.rows[0]!.observations.pop(),
      (v:CoverageAuditInput)=>{v.rows[0]!.observations[1]=v.rows[0]!.observations[0]!;},
      (v:CoverageAuditInput)=>{v.rows[0]!.observations[0]!.cutoff_at=new Date(at.getTime()+1).toISOString();},
      (v:CoverageAuditInput)=>{v.rows[0]!.observations[0]!.address=key(2);},
      (v:CoverageAuditInput)=>v.rows.push(v.rows[0]!),
      (v:CoverageAuditInput)=>{v.rows[0]!.state="held";},
    ]){const data=input();mutate(data);expect(CoverageAuditInput.safeParse(data).success).toBe(false);}
  });
  it("replays summaries and detects edited summary or observation hashes",async()=>{
    const artifact=await freezeActivityCoverage(input());expect(await verifyActivityCoverage(artifact)).toEqual(artifact);
    const edited=structuredClone(artifact);edited.summary.strata[0]!.candidates++;
    await expect(verifyActivityCoverage(edited)).rejects.toThrow(/replay/);
    const modified=structuredClone(artifact);modified.inputs.rows[0]!.age_band="older";
    await expect(verifyActivityCoverage(modified)).rejects.toThrow(/replay/);
  });
  it("audits the full cache without writes/network, retaining malformed, future and mismatched rows",async()=>{
    const {sqlite,db,candidate,put}=await setup();put(candidate.address,candidate);put(key(2),"{");
    put(key(3),{...candidate,address:key(3),checked_at:new Date(at.getTime()+1).toISOString()});put(key(4),candidate);
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden")),before=sqlite.prepare("SELECT total_changes() n").get();
    sqlite.exec("PRAGMA query_only=ON; BEGIN");
    const audit=await activityCoverageAudit(db,at);
    expect(audit.inputs.rows).toHaveLength(4);expect(audit.summary.strata[0]).toMatchObject({candidates:4,available_candidates:1,held_candidates:3});
    expect(audit.inputs.rows.find(r=>r.address===candidate.address)!.candidate_hash).toBe(await hashJson(CandidateSchema.parse(candidate)));
    expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  });
  it("refuses oversize inventories instead of silently auditing the first 500",async()=>{
    const {db,put}=await setup();for(let i=0;i<501;i++){const bytes=new Uint8Array(32);new DataView(bytes.buffer).setUint32(0,i+1);put(toBase58(bytes),"{}");}
    await expect(activityCoverageAudit(db,at)).rejects.toThrow(/inventory_bound/);
  });
  it("rejects oversized payloads before JSON parsing and exports no partial candidate subset",async()=>{
    const {db,put}=await setup();put(key(1)," ".repeat(1600001));
    await expect(activityCoverageAudit(db,at)).rejects.toThrow(/inventory_bound/);
    const total=await setup();for(let i=1;i<=3;i++)total.put(key(i)," ".repeat(1400000));
    await expect(activityCoverageAudit(total.db,at)).rejects.toThrow(/inventory_bound/);
  });
  it("holds the entire artifact on an expired read deadline rather than omitting unfinished rows",async()=>{
    const {db,candidate,put}=await setup();put(candidate.address,candidate);
    await expect(activityCoverageAudit(db,at,-1)).rejects.toThrow(/time_bound/);
  });
  it("exports a private new artifact from a read-only store, verifies its pinned checksum and refuses overwrite",async()=>{
    const dir=directory(),database=path.join(dir,"test.sqlite"),output=path.join(dir,"audit.json");
    const {candidate,put}=await setup(database);put(candidate.address,candidate);
    const result=await exportCoverageAudit(database,output);
    expect(result.summary.strata[0]!.candidates).toBe(1);
    expect((await verifyCoverageAudit(output,result.sha256)).summary).toEqual(result.summary);
    await expect(exportCoverageAudit(database,output)).rejects.toThrow(/already_exists/);
    await expect(exportCoverageAudit(database,path.resolve("public-coverage-audit.json"))).rejects.toThrow(/private_tmp/);
    await expect(exportCoverageAudit(path.join(dir,"missing.sqlite"),path.join(dir,"other.json"))).rejects.toThrow();
    await expect(verifyCoverageAudit(output,"0".repeat(64))).rejects.toThrow(/checksum/);
    await expect(verifyCoverageAudit(output,"")).rejects.toThrow(/pinned/);
    writeFileSync(output,"{}");await expect(verifyCoverageAudit(output,result.sha256)).rejects.toThrow(/checksum/);
  });
});
