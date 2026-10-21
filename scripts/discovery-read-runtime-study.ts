// Local, synthetic full-reader study. Never attach app bindings or credentials.
// From repo root: pnpm exec tsx scripts/discovery-read-runtime-study.ts .tmp/read-runtime-NEW
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
import {createHash,randomBytes} from "node:crypto";
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {resolve,join,sep} from "node:path";
import {performance} from "node:perf_hooks";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {buildScoreReadPages} from "../discovery/src/score-read-pages";
import {rankedDiscovery} from "../discovery/src/discovery-score-store";
import {candidateCard} from "../discovery/src/candidate-card";
import {PackedScoreInventorySchema,unpackScoreInventory} from "../discovery/src/score-read-index";
import {toBase58} from "../discovery/src/solana";
import type {Candidate} from "../discovery/src/model";
import {latencySummary,summarizeCpuProfile,type CpuProfile,type CpuFrame} from "./lib/discovery-read-runtime-metrics";

type Runtime={getWorker(name:string):Promise<{fetch(url:string,init?:RequestInit):Promise<Response>}>;getD1Database(binding:string,name:string):Promise<D1Database>;getInspectorURL():Promise<URL>;dispose():Promise<void>};
const base=createRequire(new URL("../discovery/package.json",import.meta.url)),require=createRequire(base.resolve("wrangler/package.json"));
const {Miniflare}=require("miniflare") as {Miniflare:new(options:unknown)=>Runtime};
const {build}=require("esbuild") as {build(options:unknown):Promise<{outputFiles:{path:string;text:string}[]}>};
const {TraceMap,originalPositionFor}=require("@jridgewell/trace-mapping") as {TraceMap:new(map:string)=>unknown;originalPositionFor(map:unknown,p:{line:number;column:number}):{source:string|null}};
const output=resolve(process.argv[2]??""),privateRoot=resolve(".tmp")+sep;
if(!output.startsWith(privateRoot)||output===privateRoot.slice(0,-1))throw Error("new_private_output_directory_required");
mkdirSync(resolve(".tmp"),{recursive:true});
mkdirSync(output); // Fail on an existing directory; never overwrite earlier evidence.
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const write=(name:string,value:unknown)=>{const text=JSON.stringify(value,null,2)+"\n";writeFileSync(join(output,name),text,{flag:"wx"});return createHash("sha256").update(text).digest("hex");};
const config=readFileSync("discovery/wrangler.local.jsonc","utf8"),compatibilityDate=config.match(/"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1];
const compatibilityFlags=JSON.parse(config.match(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/)?.[1]??"null") as string[];
if(!compatibilityDate||!Array.isArray(compatibilityFlags))throw Error("compatibility_config_required");
const bundle=await build({entryPoints:["scripts/lib/discovery-read-runtime-worker.ts"],bundle:true,write:false,format:"esm",platform:"neutral",external:["node:*"],keepNames:true,sourcemap:"external",outfile:join(output,"reader-runtime.mjs")});
for(const file of bundle.outputFiles)writeFileSync(file.path,file.text,{flag:"wx"});
const code=bundle.outputFiles.find(f=>f.path.endsWith(".mjs"))!.text,map=new TraceMap(bundle.outputFiles.find(f=>f.path.endsWith(".map"))!.text);
const sourceFor=(frame:CpuFrame)=>{
  if(!frame.url.endsWith("reader-runtime.mjs")||frame.lineNumber<0)return null;
  const source=originalPositionFor(map,{line:frame.lineNumber+1,column:Math.max(0,frame.columnNumber)}).source;
  if(!source)return null;const normalized=source.replaceAll("\\","/");
  if(normalized.includes("node_modules/"))return normalized.includes("zod")?"dependency/zod":"dependency/other";
  for(const prefix of ["discovery/src/","scripts/lib/"]){const i=normalized.indexOf(prefix);if(i>=0)return normalized.slice(i);}
  return "bundle/unmapped";
};
class Cdp {
  private id=0;private pending=new Map<number,{resolve:(v:Record<string,unknown>)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(private socket:WebSocket){socket.addEventListener("message",event=>{const result=JSON.parse(String(event.data));const waiter=this.pending.get(result.id);if(!waiter)return;clearTimeout(waiter.timer);this.pending.delete(result.id);if(result.error)waiter.reject(Error("CDP "+JSON.stringify(result.error)));else waiter.resolve(result.result??{});});
    socket.addEventListener("close",()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error("cdp_closed"));}this.pending.clear();});}
  static async connect(url:string){const socket=new WebSocket(url);await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error("cdp_connection_timeout"));},15000);socket.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener("error",()=>{clearTimeout(timer);reject(Error("cdp_connection_failed"));},{once:true});});return new Cdp(socket);}
  send(method:string,params:Record<string,unknown>={}){return new Promise<Record<string,unknown>>((resolve,reject)=>{const id=++this.id,timer=setTimeout(()=>{this.pending.delete(id);reject(Error("cdp_command_timeout:"+method));},15000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});}
  close(){this.socket.close();}
}
const tables=["tenx_score_source_revision","tenx_score_page_manifest","tenx_score_page_cards","tenx_score_page_summaries"] as const;
type SavedTable={name:string;sql:string;rows:Record<string,string|number|null>[]};
const at=new Date("2026-10-22T01:00:00.000Z"),fixtures=await fixtureCandidates(at),studies=[];
let runtimeNumber=0;
for(const shape of ["ordinary_244","distinct_wide_500"] as const){
  const sqlite=new DatabaseSync(":memory:");
  try{
    for(const f of readdirSync("discovery/migrations").filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync("discovery/migrations/"+f,"utf8"));
    const n=shape==="ordinary_244"?244:500,items:Candidate[]=Array.from({length:n},(_,i)=>{const bytes=new Uint8Array(32).fill(7);new DataView(bytes.buffer).setUint32(0,20000+i);return {...fixtures[i%fixtures.length]!,mode:"live",address:toBase58(bytes),
      name:shape==="ordinary_244"?`Observed ${i}`:"\u0000".repeat(95)+String(i).padStart(5,"0"),symbol:shape==="ordinary_244"?`OBS${i}`:"\u0001".repeat(27)+String(i).padStart(5,"0")};});
    const insert=sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)");for(const c of items)insert.run(c.address,c.pool,JSON.stringify(c),c.checked_at);
    const db=sqliteD1(sqlite);let built=await buildScoreReadPages(db,at);if(built.state!=="built")throw Error(built.reason);
    if(n===500){const m=JSON.parse((sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get() as {payload:string}).payload),chosen=new Set(unpackScoreInventory(PackedScoreInventorySchema.parse(m.inventory)).filter((_,i)=>i%25<5).map(e=>e.address));
      for(const c of items)if(chosen.has(c.address)){c.name="\u0002"+c.name.slice(1);sqlite.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?").run(JSON.stringify(c),c.address);}
      built=await buildScoreReadPages(db,at);if(built.state!=="built")throw Error(built.reason);}
    const saved:SavedTable[]=tables.map(name=>({name,sql:(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name) as {sql:string}).sql,rows:sqlite.prepare(`SELECT * FROM ${name} ORDER BY 1`).all() as SavedTable["rows"]}));
    const queries:Record<string,string>[]=[{limit:"1"},{limit:"25"},{limit:"100",sort:"liquidity"},{limit:"1",q:items.at(-1)!.address},{limit:"25",q:"no match"},...(n===500?[{limit:"100",q:"\u0002",browse:"inventory"}]:[])];
    const expected=new Map<string,string>();for(const q of queries){const ranked=await rankedDiscovery(db,items,at,q.sort==="liquidity"?"liquidity":"score","all",{search:q.q,maximum:q.browse==="inventory"?500:100});expected.set(JSON.stringify(q),digest(ranked.rows.slice(0,Number(q.limit)).map(candidateCard)));}
    const cold:number[]=[],runs=[];
    for(const kind of ["cold_first","cold_repeat","measure","profile"] as const){
      const token=randomBytes(32).toString("hex"),id=++runtimeNumber;let outboundAttempts=0,cdp:Cdp|undefined;
      const options={workers:[{config:{name:"reader-study",type:"worker",compatibilityDate,compatibilityFlags,env:{STUDY_DB:{type:"d1",id:"reader-study-db",dev:{remote:false}},STUDY_TOKEN:{type:"json",value:token},STUDY_NOW:{type:"json",value:at.toISOString()}},
        manifest:{mainModule:"reader-runtime.mjs",modules:{"reader-runtime.mjs":{type:"esm",contents:code}}}},dev:{outboundService:{type:"fetcher",handler:()=>{outboundAttempts++;return new Response("blocked",{status:502});}}}}],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false},isolatedResourcePersistencePath:join(output,`isolated-${id}`),...(kind==="profile"?{inspectorPort:0}:{} )};
      const started=performance.now(),mf=new Miniflare(options);
      try{
        const native=await mf.getD1Database("STUDY_DB","reader-study");
        for(const table of saved){await native.prepare(table.sql).run();for(let i=0;i<table.rows.length;i+=50){await native.batch(table.rows.slice(i,i+50).map(row=>{const keys=Object.keys(row);return native.prepare(`INSERT INTO ${table.name}(${keys.join(",")}) VALUES(${keys.map(()=>"?").join(",")})`).bind(...keys.map(k=>row[k]));}));}}
        const readyMs=performance.now()-started,worker=await mf.getWorker("reader-study");
        const request=async(q:Record<string,string>,extra:Record<string,string>={})=>{
          const start=performance.now(),response=await worker.fetch("http://localhost/study/reader?"+new URLSearchParams({...q,...extra}),{headers:{authorization:`Bearer ${token}`}}),text=await response.text(),wall=performance.now()-start;
          if(response.status!==200||response.headers.get("cache-control")!=="no-store")throw Error("reader_http_contract");
          return {wall,bytes:Buffer.byteLength(text),value:JSON.parse(text)};
        };
        const check=(q:Record<string,string>,value:{state:string;action_authority:boolean;data?:{candidates:unknown[]}})=>{if(value.state!=="available"||value.action_authority!==false||digest(value.data?.candidates)!==expected.get(JSON.stringify(q)))throw Error("full_evaluator_parity_failed");};
        const first=await request(queries[1]!);check(queries[1]!,first.value);if(kind!=="profile")cold.push(first.wall);
        if(kind.startsWith("cold")){runs.push({kind,startup_and_seed_ms:readyMs,first_read_ms:first.wall});continue;}
        const snapshot=async()=>digest(await Promise.all(tables.map(async table=>({name:table,rows:(await native.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results}))));
        const before=await snapshot(),cases=[];
        if(kind==="measure"){
          for(const q of queries){for(let i=0;i<3;i++)check(q,(await request(q)).value);const walls=[];let bytes=0;for(let i=0;i<20;i++){const r=await request(q);check(q,r.value);walls.push(r.wall);bytes=r.bytes;}const traced=await request(q,{__trace:"1"});check(q,traced.value.result);
            if(traced.value.trace.length!==3||traced.value.trace.some((t:{rows_written:number|null})=>t.rows_written!==0))throw Error("unexpected_reader_io");
            if(q.q==="\u0002"&&traced.value.trace[2].returned_rows!==20)throw Error("maximum_scatter_not_exercised");
            cases.push({query:q,response_bytes:bytes,wall:latencySummary(walls),trace:traced.value.trace});}
          const concurrency=[];
          for(const width of [4,16]){const walls=[],batchWalls=[];for(let batch=0;batch<3;batch++){const start=performance.now();const responses=await Promise.all(Array.from({length:width},(_,i)=>{const q=queries[i%queries.length]!;return request(q).then(r=>{check(q,r.value);return r;});}));batchWalls.push(performance.now()-start);walls.push(...responses.map(r=>r.wall));}concurrency.push({width,batches:3,wall:latencySummary(walls),batch_wall:latencySummary(batchWalls)});}
          if(await snapshot()!==before)throw Error("read_changed_projection");
          const guards={unauthorized:(await worker.fetch("http://localhost/study/reader")).status,bad_origin:(await worker.fetch("http://localhost/study/reader",{headers:{authorization:`Bearer ${token}`,origin:"https://evil.test"}})).status,expired:(await request(queries[1]!,{__expired:"1"})).value.reason};
          if(guards.unauthorized!==401||guards.bad_origin!==403||guards.expired!=="cutoff_expired_or_future")throw Error("reader_guard_failed");
          const races=[];
          for(const race of ["revision","generation"]){for(const q of [queries[1]!,queries[4]!]){
            const result=await request(q,{__trace:"1",__race:race});if(result.value.result.reason!=="source_or_generation_changed")throw Error("race_not_held");races.push({race,empty:q.q==="no match",state:result.value.result.state,reason:result.value.result.reason});
            const revision=saved[0]!.rows[0]!.revision;await native.prepare("UPDATE tenx_score_source_revision SET revision=? WHERE id=1").bind(revision).run();await native.prepare("UPDATE tenx_score_page_manifest SET manifest_hash=? WHERE id=1").bind(built.manifest_hash).run();
          }}
          if(await snapshot()!==before)throw Error("race_restore_failed");
          runs.push({kind,startup_and_seed_ms:readyMs,first_read_ms:first.wall,cases,concurrency,no_read_writes:true,guards,races});
        }else{
          const inspector=await mf.getInspectorURL(),http=new URL(inspector);http.protocol="http:";http.pathname="/json";
          const targets=await(await fetch(http)).json() as {id:string;webSocketDebuggerUrl:string}[],target=targets.find(t=>t.id==="core:user:reader-study");if(!target)throw Error("reader_inspector_missing");
          cdp=await Cdp.connect(target.webSocketDebuggerUrl);await cdp.send("Profiler.enable");await cdp.send("Profiler.setSamplingInterval",{interval:1000});
          const profiles=[];for(const index of n===500?[1,5]:[1]){const q=queries[index]!;for(let i=0;i<3;i++)check(q,(await request(q)).value);await cdp.send("Profiler.start");for(let i=0;i<40;i++)check(q,(await request(q)).value);
            const stopped=await cdp.send("Profiler.stop"),profile=stopped.profile as CpuProfile,name=`${shape}-query-${index}.cpuprofile`,hash=write(name,profile),summary=summarizeCpuProfile(profile,sourceFor);
            if(!summary.attribution.some(s=>s.source.startsWith("discovery/src/")))throw Error("reader_source_mapping_missing");
            profiles.push({query:q,requests:40,artifact:name,sha256:hash,...summary});}
          if(await snapshot()!==before)throw Error("profile_read_changed_projection");runs.push({kind,profiles,no_read_writes:true});
        }
      }finally{cdp?.close();await mf.dispose();if(outboundAttempts)throw Error("outbound_network_attempted");}
    }
    studies.push({shape,candidates:n,built,first_read_after_new_runtime:latencySummary(cold),runs});
    console.log(JSON.stringify({completed:shape,candidates:n,full_reader_parity:true}));
  }finally{sqlite.close();}
}
const result={version:"full-reader-workerd-d1-study-v1",compatibilityDate,compatibilityFlags,cutoff:at.toISOString(),studies,
  limits:"Synthetic fixtures and frozen explicit reader time; actual unmodified reader, local D1 binding, shared production auth/header functions and complete response serialization. General application router excluded. New-runtime first requests include module warmup but D1 is seeded/prewarmed. Timings include local proxy/IPC, not deployed latency. Traces/profiles are separate from uninstrumented reads; sampled elapsed attribution is not billed CPU. No provider credentials/IO, app data, new dependencies, live migration/restart or deploy. Public/automatic adoption and Free acceptance remain held.",cpu_acceptance:false};
const hash=write("report.json",result);console.log(JSON.stringify({report:join(output,"report.json"),sha256:hash,cpu_acceptance:false}));
