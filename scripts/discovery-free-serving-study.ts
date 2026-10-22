// Offline-only assessment of the unchanged Discovery Worker router.
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
import {createHash,randomBytes} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdirSync,readFileSync,readdirSync,writeFileSync,statSync} from "node:fs";
import {resolve,join,sep} from "node:path";
import {performance} from "node:perf_hooks";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {scoreInventoryCandidates,rankedDiscovery} from "../discovery/src/discovery-score-store";
import {buildScoreReadPages} from "../discovery/src/score-read-pages";
import {candidateCard} from "../discovery/src/candidate-card";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {toBase58} from "../discovery/src/solana";
import {createdWithinWindow} from "../discovery/src/priority";
import {latencySummary} from "./lib/discovery-read-runtime-metrics";
import {assessFreeServing,FREE_SERVING_LIMITS} from "./lib/discovery-serving-capacity";
type Runtime={getWorker(name:string):Promise<{fetch(url:string,init?:RequestInit):Promise<Response>}>;getD1Database(binding:string,name:string):Promise<D1Database>;dispose():Promise<void>};
const base=createRequire(new URL("../discovery/package.json",import.meta.url)),require=createRequire(base.resolve("wrangler/package.json"));
const {Miniflare}=require("miniflare") as {Miniflare:new(options:unknown)=>Runtime};
const {build}=require("esbuild") as {build(options:unknown):Promise<{outputFiles:{path:string;text:string}[]}>};
const [sourceArg,pin,cutoff,outputArg]=process.argv.slice(2),source=resolve(sourceArg??""),output=resolve(outputArg??"");
if(!sourceArg||!pin?.match(/^[a-f0-9]{64}$/)||!cutoff||!Number.isFinite(Date.parse(cutoff))||!outputArg||!output.startsWith(resolve(".tmp")+sep))throw Error("explicit_source_pin_cutoff_new_private_output_required");
const sha=async(path:string)=>{const h=createHash("sha256");for await(const c of createReadStream(path))h.update(c);return h.digest("hex");};
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
if(await sha(source)!==pin)throw Error("source_pin_mismatch");
mkdirSync(output); // Exclusive: never overwrite a previous study.
const config=readFileSync("discovery/wrangler.local.jsonc","utf8"),compatibilityDate=config.match(/"compatibility_date"\s*:\s*"([\d-]+)"/)?.[1],compatibilityFlags=JSON.parse(config.match(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/)?.[1]??"null");
if(!compatibilityDate||!Array.isArray(compatibilityFlags))throw Error("compatibility_config_required");
const bundle=await build({entryPoints:["scripts/lib/discovery-serving-study-worker.ts"],bundle:true,write:false,format:"esm",platform:"neutral",external:["node:*"],keepNames:true,outfile:join(output,"serving-runtime.mjs")});
const code=bundle.outputFiles[0]!.text;writeFileSync(join(output,"serving-runtime.mjs"),code,{flag:"wx"});
const original=new DatabaseSync(source,{readOnly:true}),at=new Date(cutoff),studies=[];
const tables=["tenx_candidates","tenx_market_history","tenx_candidate_expiry","tenx_control","tenx_score_source_revision","tenx_score_page_manifest","tenx_score_page_cards","tenx_score_page_summaries"];
try{
 for(const shape of ["archived_selection","synthetic_wide_500"]){
  console.log(JSON.stringify({shape,stage:"fixture_start"}));
  const memory=new DatabaseSync(":memory:");
  try{
   for(const f of readdirSync("discovery/migrations").filter(f=>f.endsWith(".sql")).sort())memory.exec(readFileSync("discovery/migrations/"+f,"utf8"));
   const db=sqliteD1(memory);
   const fixtures=await fixtureCandidates(at),items=shape==="archived_selection"?await scoreInventoryCandidates(sqliteD1(original),"live",false):Array.from({length:500},(_,i)=>{const bytes=new Uint8Array(32).fill(9);new DataView(bytes.buffer).setUint32(0,30000+i);return {...fixtures[i%fixtures.length]!,mode:"live" as const,address:toBase58(bytes),name:"\u0000".repeat(95)+String(i).padStart(5,"0"),symbol:"\u0001".repeat(27)+String(i).padStart(5,"0")};});
   const insert=memory.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)");
   for(const c of items)insert.run(c.address,c.pool,JSON.stringify(c),c.checked_at);
   let historyCount=0;
   if(shape==="archived_selection"){
    const rows=original.prepare("SELECT * FROM tenx_market_history WHERE address=? AND fetched_at<=? ORDER BY fetched_at");
    for(const c of items)for(const row of rows.all(c.address,cutoff)){
     const keys=Object.keys(row);memory.prepare(`INSERT INTO tenx_market_history(${keys.join(",")}) VALUES(${keys.map(()=>"?").join(",")})`).run(...keys.map(k=>row[k]));historyCount++;
    }
    const control=original.prepare("SELECT * FROM tenx_control").all();memory.exec("DELETE FROM tenx_control");
    for(const row of control){const keys=Object.keys(row);memory.prepare(`INSERT INTO tenx_control(${keys.join(",")}) VALUES(${keys.map(()=>"?").join(",")})`).run(...keys.map(k=>row[k]));}
   }
   const started=performance.now(),built=await buildScoreReadPages(db,at),nodeBuildWall=performance.now()-started;
   if(built.state!=="built")throw Error("projection_build_held:"+built.reason);
   console.log(JSON.stringify({shape,stage:"projection_built",candidates:items.length,market_rows:historyCount}));
   const saved=tables.map(name=>({name,sql:(memory.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name) as {sql:string}).sql,rows:memory.prepare(`SELECT * FROM ${name} ORDER BY 1,2`).all()}));
   const indexes=memory.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL").all().filter(r=>tables.some(t=>String(r.sql).includes(` ON ${t}(`)||String(r.sql).includes(` ON ${t} (`))).map(r=>String(r.sql));
   const view=(memory.prepare("SELECT sql FROM sqlite_schema WHERE name='tenx_active_candidates'").get() as {sql:string}).sql;
   const queries:Record<string,string>[]=[{limit:"100",browse:"inventory",age:"24h"},{limit:"25"},{limit:"100",sort:"liquidity"},{limit:"25",q:items.at(-1)!.address},{limit:"25",q:"unmatched-study-token"}];
   const expected=new Map<string,string>();
   for(const q of queries){const ranked=await rankedDiscovery(db,q.age==="24h"?items.filter(c=>createdWithinWindow(c,at)):items,at,q.sort==="liquidity"?"liquidity":"score","all",{search:q.q,maximum:q.browse==="inventory"?500:100});expected.set(JSON.stringify(q),digest(ranked.rows.slice(0,Number(q.limit)).map(candidateCard)));}
   const token=randomBytes(32).toString("hex");let outboundAttempts=0;
   const mf=new Miniflare({workers:[{
    config:{name:"serving-study",type:"worker",compatibilityDate,compatibilityFlags,env:{STUDY_DB:{type:"d1",id:"serving-study-db",dev:{remote:false}},STUDY_TOKEN:{type:"json",value:token},STUDY_NOW:{type:"json",value:cutoff}},
     manifest:{mainModule:"serving-runtime.mjs",modules:{"serving-runtime.mjs":{type:"esm",contents:code}}}},
    dev:{outboundService:{type:"fetcher",handler:()=>{outboundAttempts++;return new Response("blocked",{status:502});}}}
   }],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false},isolatedResourcePersistencePath:join(output,shape)});
   try{
    const native=await mf.getD1Database("STUDY_DB","serving-study");
    console.log(JSON.stringify({shape,stage:"native_ready"}));
    for(const t of saved){
     await native.prepare(t.sql).run();if(!t.rows.length)continue;
     const keys=Object.keys(t.rows[0]!),group=Math.floor(100/keys.length),statements=[];
     for(let i=0;i<t.rows.length;i+=group){const rows=t.rows.slice(i,i+group);statements.push(native.prepare(`INSERT INTO ${t.name}(${keys.join(",")}) VALUES ${rows.map(()=>`(${keys.map(()=>"?").join(",")})`).join(",")}`).bind(...rows.flatMap(row=>keys.map(k=>row[k]))));}
     for(let i=0;i<statements.length;i+=50)await native.batch(statements.slice(i,i+50));
    }
    for(const sql of indexes)await native.prepare(sql).run();await native.prepare(view).run();
    console.log(JSON.stringify({shape,stage:"native_seeded",indexes:indexes.length}));
    const snapshot=async()=>digest(await Promise.all(tables.map(async name=>({name,rows:(await native.prepare(`SELECT * FROM ${name} ORDER BY 1,2`).all()).results}))));
    const before=await snapshot(),worker=await mf.getWorker("serving-study");
    const request=async(route:string,q:Record<string,string>,extra:Record<string,string>={})=>{
     const legacy=route==="legacy",query=legacy?{inventory:"current",view:"cards",age:"all",...q}:q;
     const url="http://localhost/api/10x/"+(legacy?"candidates":"admin/score-read-pages")+"?"+new URLSearchParams(query);
     const start=performance.now(),response=await worker.fetch(url,{headers:{"x-study-token":token,authorization:`Bearer ${token}`,...extra}}),body=await response.text(),wall=performance.now()-start;
     if(response.status!==200||response.headers.get("cache-control")!=="no-store")throw Error("http_contract:"+response.status+":"+body.slice(0,250));
     return {wall,bytes:Buffer.byteLength(body),value:JSON.parse(body)};
    };
    const check=(route:string,q:Record<string,string>,v:any)=>{if(route!=="legacy"&&(v.state!=="available"||v.action_authority!==false))throw Error("compact_held:"+JSON.stringify(v));if(digest(v.data?.candidates)!==expected.get(JSON.stringify(q)))throw Error("evaluator_parity_failed:"+route);};
    const routes=[];
    for(const route of ["legacy","compact"]){
     const cases=[];
     for(const q of queries){for(let i=0;i<3;i++)check(route,q,(await request(route,q)).value);const walls=[];let bytes=0;
      for(let i=0;i<30;i++){const r=await request(route,q);check(route,q,r.value);walls.push(r.wall);bytes=r.bytes;}
      const traced=(await request(route,q,{"x-study-trace":"1"})).value;check(route,q,traced.response);
      if(!traced.trace.length||traced.trace.some((t:any)=>t.rows_written!==0||t.rows_read===null))throw Error("unmeasured_or_mutating_read");
      cases.push({query:q,response_bytes:bytes,wall:latencySummary(walls),trace:traced.trace,queries:traced.trace.length,rows_read:traced.trace.reduce((n:number,t:any)=>n+t.rows_read,0)});
      console.log(JSON.stringify({shape,route,stage:"case_passed",query:q}));
     }
     const walls=[];for(let b=0;b<3;b++){const r=await Promise.all(queries.slice(0,3).map(q=>request(route,q).then(v=>{check(route,q,v.value);return v;})));walls.push(...r.map(v=>v.wall));}
     routes.push({route,cases,concurrency:{width:3,batches:3,wall:latencySummary(walls)}});
    }
    const path="http://localhost/api/10x/admin/score-read-pages",guards=[];
    for(const [name,status,extra] of [["admin_auth",401,{authorization:""}],["origin",403,{"x-study-probe":"bad_origin"}],["runtime",503,{"x-study-probe":"runtime_disabled"}],["host",503,{"x-study-probe":"external_host"}]] as const){
     const headers=new Headers({"x-study-token":token,authorization:`Bearer ${token}`,"x-study-trace":"1"});for(const [k,v] of Object.entries(extra))if(v!==undefined)headers.set(k,v);
     const r=await worker.fetch(path,{headers}),v=await r.json() as any;
     if(r.status!==status||v.trace.length!==0)throw Error("guard_failed:"+name);guards.push({name,status:r.status,queries:v.trace.length});
    }
    for(const [name,url,init,status] of [["outer_auth",path,{},403],["method",path,{method:"POST",headers:{"x-study-token":token}},405],["path","http://localhost/private",{headers:{"x-study-token":token}},404]] as const){const r=await worker.fetch(url,init);if(r.status!==status)throw Error("outer_guard_failed");guards.push({name,status:r.status,queries:0});}
    if(await snapshot()!==before||outboundAttempts!==0)throw Error("serving_mutation_or_outbound_attempt");
    const workloads=routes.map(r=>({route:r.route,scenarios:[30,60].flatMap(poll_seconds=>[1,10,30,100].map(viewers=>assessFreeServing({viewers,poll_seconds,active_seconds_daily:86400,requests_per_poll:1,measured_queries:r.cases[0]!.queries,measured_rows_read:r.cases[0]!.rows_read,measured_rows_written:0,shared_worker_requests:null,shared_d1_reads:null,shared_d1_writes:null,worker_cpu_ms:null,database_bytes:null,account_storage_bytes:null,largest_row_bytes:null})))}));
    studies.push({shape,candidates:items.length,market_rows:historyCount,indexes:indexes.length,projection_builder:{node_wall_ms:nodeBuildWall,worker_cpu_ms:null,native_d1_billable_rows:null},read_only_hash:before,unchanged:true,outbound_attempts:outboundAttempts,routes,guards,workloads});
    console.log(JSON.stringify({shape,candidates:items.length,market_rows:historyCount,routes:routes.map(r=>({route:r.route,default_rows_read:r.cases[0]!.rows_read,p95_ms:r.cases[0]!.wall})),passed:true}));
   }finally{await mf.dispose();}
  }finally{memory.close();}
 }
}finally{original.close();}
if(await sha(source)!==pin)throw Error("original_source_changed");
const report={version:1,source:{path:source,sha256:pin,bytes:statSync(source).size,cutoff,unchanged:true,scope:"Restored stripped metadata archive; selected candidate/history/control only. Never a runtime adoption."},limits:FREE_SERVING_LIMITS,compatibilityDate,compatibilityFlags,bundle_sha256:createHash("sha256").update(code).digest("hex"),studies,decision:"held",free_acceptance:false,action_authority:false,production_changes:false,provider_requests:0,limitations:["Host wall time is not Workers CPU or billed D1 time.","No Pages middleware/proxy, deployed CPU, heap, shared-account usage, prospective growth, native projection builder bill, cold-start population or production load measured.","Synthetic stress data does not qualify token evidence. Historical replay does not refresh observations.","Reduced isolated table set does not establish full runtime storage fit; original raw archive exceeds a single Free D1 database."]};
const text=JSON.stringify(report,null,2)+"\n";writeFileSync(join(output,"report.json"),text,{flag:"wx"});console.log(JSON.stringify({report:join(output,"report.json"),sha256:createHash("sha256").update(text).digest("hex"),decision:"held"}));
