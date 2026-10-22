import test from "node:test";
import assert from "node:assert/strict";
import {assessFreeServingWorkload,summarizeD1Trace} from "./lib/discovery-serving-workload";
import {traceBuilderDatabase} from "./lib/discovery-builder-study-worker";
import type {D1Trace} from "./lib/discovery-serving-workload";
const component={name:"reader",invocations_daily:1440,rows_read:148,rows_written:0,queries:3,cpu_ms:null};
const base={components:[component],background:{worker_requests:null,d1_reads:null,d1_writes:null},refresh_seconds:60,validity_seconds:60,database_bytes:null,account_bytes:null,largest_row_bytes:null};
test("unknown background and CPU never grant shared Free admission",()=>{const r=assessFreeServingWorkload(base);assert.equal(r.reads.known_minimum,213120);assert.equal(r.reads.total,null);assert.equal(r.reads.status,"unknown");assert.equal(r.per_invocation[0]!.cpu,"unknown");assert.equal(r.free_acceptance,false);assert.equal(r.action_authority,false);});
test("builder and reader costs accumulate including indexed native writes",()=>{const r=assessFreeServingWorkload({...base,components:[component,{name:"builder",invocations_daily:1440,rows_read:50000,rows_written:22,queries:14,cpu_ms:null}]});assert.equal(r.reads.known_minimum,72213120);assert.equal(r.reads.status,"over_limit");assert.equal(r.writes.known_minimum,31680);assert.equal(r.writes.status,"unknown");});
test("unknown source-edit volume remains unknown without losing a known overrun",()=>{const r=assessFreeServingWorkload({...base,components:[{...component,rows_read:28355},{...component,name:"source_changes",invocations_daily:null,rows_read:null,rows_written:null}]});assert.equal(r.reads.known_minimum,40831200);assert.equal(r.reads.status,"over_limit");assert.equal(r.writes.total,null);});
test("explicit zero work does not invent missing usage",()=>{const r=assessFreeServingWorkload({...base,components:[component,{name:"unused",invocations_daily:0,rows_read:null,rows_written:null,queries:null,cpu_ms:null}],background:{worker_requests:0,d1_reads:0,d1_writes:0}});assert.equal(r.reads.total,213120);assert.equal(r.writes.total,0);assert.equal(r.decision,"held");});
test("even a completely known under-budget planning scenario cannot approve runtime or evidence use",()=>{const r=assessFreeServingWorkload({...base,components:[{...component,cpu_ms:1}],background:{worker_requests:0,d1_reads:0,d1_writes:0},database_bytes:1000,account_bytes:1000,largest_row_bytes:100});assert.equal(r.reads.status,"within_model");assert.equal(r.per_invocation[0]!.cpu,"within_model");assert.equal(r.decision,"held");assert.equal(r.free_acceptance,false);assert.equal(r.action_authority,false);});
test("slowing rebuilds beyond the existing validity interval exposes a gap",()=>assert.equal(assessFreeServingWorkload({...base,refresh_seconds:61}).freshness_schedule,"gap_in_model"));
test("per-invocation query and CPU overruns remain distinct from daily fit",()=>{const r=assessFreeServingWorkload({...base,components:[{...component,queries:51,cpu_ms:11}]});assert.equal(r.per_invocation[0]!.queries,"over_limit");assert.equal(r.per_invocation[0]!.cpu,"over_limit");});
test("duplicate components cannot hide or double-name costs",()=>assert.throws(()=>assessFreeServingWorkload({...base,components:[component,component]}),/duplicate/));
test("unsafe products and accumulated totals are rejected",()=>{assert.throws(()=>assessFreeServingWorkload({...base,components:[{...component,rows_read:Number.MAX_SAFE_INTEGER}]}),/overflow/);assert.throws(()=>assessFreeServingWorkload({...base,background:{worker_requests:0,d1_reads:Number.MAX_SAFE_INTEGER,d1_writes:0}}),/overflow/);});
test("native scanned/written counters stay separate from logical changes",()=>{const r=summarizeD1Trace([{sql:"INSERT",rows_read:8,rows_written:6,changes:1,returned_rows:0}]);assert.equal(r.reads.total,8);assert.equal(r.writes.total,6);assert.equal(r.logical_changes.total,1);});
test("missing native counters remain unknown with a known lower bound",()=>{const r=summarizeD1Trace([{sql:"SELECT",rows_read:null,rows_written:0,changes:0,returned_rows:5},{sql:"INSERT",rows_read:7,rows_written:null,changes:1,returned_rows:0}]);assert.equal(r.reads.total,null);assert.equal(r.reads.known_minimum,7);assert.equal(r.writes.total,null);});
test("negative, fractional or non-finite metadata and demand are rejected",()=>{for(const rows_read of [-1,.5,Infinity,NaN])assert.throws(()=>summarizeD1Trace([{sql:"SELECT",rows_read,rows_written:0,changes:0,returned_rows:0}]));assert.throws(()=>assessFreeServingWorkload({...base,components:[{...component,invocations_daily:-1}]}));});
function fakeDatabase(){
  const prepared:string[]=[],executed:string[]=[];
  const statement=(sql:string):D1PreparedStatement=>({bind(){return statement(sql);},async all(){executed.push(sql);return result(sql);},async run(){executed.push(sql);return result(sql);}} as D1PreparedStatement);
  const result=(sql:string):D1Result=>({success:true,results:sql.startsWith("SELECT")?[{n:7}]:[],meta:{duration:0,size_after:0,last_row_id:0,changed_db:!sql.startsWith("SELECT"),rows_read:2,rows_written:sql.startsWith("SELECT")?0:4,changes:sql.startsWith("SELECT")?0:1}});
  const db={prepare(sql:string){prepared.push(sql);return statement(sql);},async batch(statements:D1PreparedStatement[]){return Promise.all(statements.map(s=>s.all()));}} as D1Database;
  return {db,prepared,executed};
}
test("builder instrumentation blocks source writes and untraced execution before touching D1",()=>{
  const fake=fakeDatabase(),db=traceBuilderDatabase(fake.db,[]);
  for(const sql of ["UPDATE tenx_candidates SET payload='bad'","DELETE FROM tenx_market_history","INSERT INTO tenx_control VALUES(1)","DROP TABLE tenx_candidates"])assert.throws(()=>db.prepare(sql),/source_write_forbidden/);
  for(const action of [()=>db.exec("SELECT 1"),()=>db.dump(),()=>db.withSession()])assert.throws(action,/method_forbidden/);
  assert.deepEqual(fake.prepared,[]);assert.deepEqual(fake.executed,[]);
});
test("builder instrumentation forwards bound reads and native batch costs without replacing them with logical changes",async()=>{
  const fake=fakeDatabase(),trace:D1Trace[]=[],db=traceBuilderDatabase(fake.db,trace);
  assert.equal(await db.prepare("SELECT n FROM tenx_control").bind(1).first("n"),7);
  await db.batch([db.prepare("INSERT INTO tenx_score_page_cards SELECT 1").bind("body")]);
  assert.equal(trace.length,2);assert.equal(trace[1]!.rows_written,4);assert.equal(trace[1]!.changes,1);assert.equal(summarizeD1Trace(trace).writes.total,4);
});
test("foreign batch statements and raw methods cannot escape the instrumentation",async()=>{
  const fake=fakeDatabase(),db=traceBuilderDatabase(fake.db,[]);
  await assert.rejects(db.batch([fake.db.prepare("SELECT 1")]),/foreign_statement/);
  assert.throws(()=>db.prepare("SELECT 1").raw(),/raw_forbidden/);assert.deepEqual(fake.executed,[]);
});
