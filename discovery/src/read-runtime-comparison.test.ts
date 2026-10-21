import {describe,expect,it} from "vitest";
import {compareRuntimeStudies} from "../../scripts/lib/discovery-read-runtime-comparison";
const wall=(requests:number,value=10)=>({requests,p50_ms:value,p95_ms:value+2,max_ms:value+4,mean_ms:value+1});
function report(){return {version:"full-reader-workerd-d1-study-v1",compatibilityDate:"2026-09-01",compatibilityFlags:["nodejs_compat"],cutoff:"2026-10-22T01:00:00.000Z",limits:"Synthetic local test",cpu_acceptance:false,
  studies:[244,500].map(n=>({shape:n===244?"ordinary_244":"distinct_wide_500",candidates:n,built:{state:"built",manifest_hash:(n===244?"a":"b").repeat(64),cutoff:"2026-10-22T01:00:00.000Z",candidates:n,manifest_bytes:100,card_bytes:1000,writes:{removed_bodies:0,changed_bodies:n,removed_summary_pages:0,changed_summary_pages:Math.ceil(n/25),manifest:1},action_authority:false},first_read_after_new_runtime:wall(3),
    runs:[{kind:"cold_first",startup_and_seed_ms:10,first_read_ms:10},{kind:"cold_repeat",startup_and_seed_ms:10,first_read_ms:10},
      {kind:"measure",startup_and_seed_ms:10,first_read_ms:10,no_read_writes:true,cases:Array.from({length:n===244?5:6},(_,i)=>({query:{limit:String(i+1)},response_bytes:100+i,wall:wall(20),trace:["manifest","bodies","summaries"].map(kind=>({kind,rows_read:2,rows_written:0,duration_ms:1,returned_rows:1,payload_bytes:100}))})),
        concurrency:[4,16].map(width=>({width,batches:3,wall:wall(width*3),batch_wall:wall(3)})),guards:{unauthorized:401,bad_origin:403,expired:"cutoff_expired_or_future"},races:["revision","generation"].flatMap(race=>[false,true].map(empty=>({race,empty,state:"held",reason:"source_or_generation_changed"})))},
      {kind:"profile",no_read_writes:true,profiles:Array.from({length:n===244?1:2},(_,i)=>({query:{limit:String(i+1)},requests:40,artifact:`fixture-${i}.cpuprofile`,sha256:"c".repeat(64),cpu_acceptance:false}))}]}))};}
const measure=(r:ReturnType<typeof report>,index=0)=>r.studies[index]!.runs.find(v=>v.kind==="measure")!;
describe("runtime experiment comparison gates",()=>{
  it("retains every query and regression, permits harmless ordering, and never grants promotion/CPU acceptance",()=>{
    const before=report(),after=report(),m=measure(after);m.cases![0]!.wall=wall(20,20);m.cases![1]!.wall=wall(20,5);m.cases!.reverse();after.studies.reverse();
    const result=compareRuntimeStudies(before,after);expect(result).toMatchObject({cpu_acceptance:false,promotion_authorized:false});expect(result.studies.map(s=>s.cases.length)).toEqual([5,6]);
    expect(result.studies[0]!.cases[0]!.wall.p50).toMatchObject({before_ms:10,after_ms:20,delta_ms:10,change_pct:100});expect(result.studies[0]!.cases[1]!.wall.p50.delta_ms).toBe(-5);
  });
  it("rejects changed data, byte counts, runtime identity, incomplete races, writes and altered sample counts",()=>{
    const mutations:((v:ReturnType<typeof report>)=>void)[]=[v=>{v.compatibilityDate="2026-09-02";},v=>{v.studies[0]!.built.manifest_hash="d".repeat(64);},
      v=>{measure(v).cases![0]!.response_bytes++;},v=>{measure(v).cases![0]!.trace[0]!.rows_read++;},v=>{measure(v).cases![0]!.trace[0]!.rows_written=1;},
      v=>{measure(v).cases![0]!.wall.requests=19;},v=>{measure(v).cases!.pop();},v=>{measure(v).races![1]=measure(v).races![0]!;},v=>{measure(v).guards!.unauthorized=200;},
      v=>{measure(v).no_read_writes=false;},v=>{measure(v).concurrency![0]!.wall.requests=1;},v=>{v.studies[1]=v.studies[0]!;},v=>{v.cpu_acceptance=true;}];
    for(const mutate of mutations){const after=report();mutate(after);expect(()=>compareRuntimeStudies(report(),after)).toThrow();}
  });
  it("preserves zero-baseline deltas without inventing an infinite percentage and rejects invalid timing evidence",()=>{
    const before=report(),after=report();measure(before).cases![0]!.wall={requests:20,p50_ms:0,p95_ms:0,max_ms:0,mean_ms:0};
    expect(compareRuntimeStudies(before,after).studies[0]!.cases[0]!.wall.p50.change_pct).toBeNull();
    for(const value of [NaN,-1,Infinity]){const bad=report();measure(bad).cases![0]!.wall.mean_ms=value;expect(()=>compareRuntimeStudies(report(),bad)).toThrow();}
    const bad=report();measure(bad).cases![0]!.wall.max_ms=1;expect(()=>compareRuntimeStudies(report(),bad)).toThrow();
  });
});
