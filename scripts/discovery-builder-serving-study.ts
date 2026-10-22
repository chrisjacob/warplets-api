// Offline native D1 builder costs; no original/live database is ever writable.
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
import {createHash,randomBytes} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {resolve,join,sep} from "node:path";
import {performance} from "node:perf_hooks";
import {z} from "zod";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {scoreInventoryCandidates,rankedDiscovery} from "../discovery/src/discovery-score-store";
import {candidateCard} from "../discovery/src/candidate-card";
import {toBase58} from "../discovery/src/solana";
import {assessFreeServingWorkload,D1TraceSchema,summarizeD1Trace} from "./lib/discovery-serving-workload";
type Runtime={getWorker(name:string):Promise<{fetch(url:string,init?:RequestInit):Promise<Response>}>;getD1Database(binding:string,name:string):Promise<D1Database>;dispose():Promise<void>};
type Row=Record<string,string|number|null>;
const base=createRequire(new URL("../discovery/package.json",import.meta.url)),require=createRequire(base.resolve("wrangler/package.json"));
const {Miniflare}=require("miniflare") as {Miniflare:new(options:unknown)=>Runtime};
const {build}=require("esbuild") as {build(options:unknown):Promise<{outputFiles:{path:string;text:string}[]}>};
const [sourceArg,pin,cutoff,readerArg,readerPin,outputArg]=process.argv.slice(2),source=resolve(sourceArg??""),readerFile=resolve(readerArg??""),output=resolve(outputArg??"");
if(!sourceArg||!pin?.match(/^[a-f0-9]{64}$/)||!readerArg||!readerPin?.match(/^[a-f0-9]{64}$/)||!cutoff||!Number.isFinite(Date.parse(cutoff))||!outputArg||!output.startsWith(resolve(".tmp")+sep))throw Error("source_reader_pins_cutoff_new_private_output_required");
const sha=async(path:string)=>{const h=createHash("sha256");for await(const c of createReadStream(path))h.update(c);return h.digest("hex");};
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
if(await sha(source)!==pin||await sha(readerFile)!==readerPin)throw Error("input_pin_mismatch");
const Reader=z.object({source:z.object({sha256:z.literal(pin),cutoff:z.literal(cutoff)}),decision:z.literal("held"),studies:z.array(z.object({shape:z.string(),routes:z.array(z.object({route:z.string(),cases:z.array(z.object({query:z.record(z.string(),z.string()),queries:z.number().int(),rows_read:z.number().int()}))}))}))});
const readers=Reader.parse(JSON.parse(readFileSync(readerFile,"utf8")));
mkdirSync(output); // Exclusive private output; old proofs remain untouched.
const config=readFileSync("discovery/wrangler.local.jsonc","utf8"),compatibilityDate=config.match(/"compatibility_date"\s*:\s*"([\d-]+)"/)?.[1],compatibilityFlags=JSON.parse(config.match(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/)?.[1]??"null");
if(!compatibilityDate||!Array.isArray(compatibilityFlags))throw Error("compatibility_config_required");
const bundle=await build({entryPoints:["scripts/lib/discovery-builder-study-worker.ts"],bundle:true,write:false,format:"esm",platform:"neutral",external:["node:*"],keepNames:true,outfile:join(output,"builder-runtime.mjs")}),code=bundle.outputFiles[0]!.text;
writeFileSync(join(output,"builder-runtime.mjs"),code,{flag:"wx"});
const original=new DatabaseSync(source,{readOnly:true}),studies=[];
const tables=["tenx_candidates","tenx_market_history","tenx_candidate_expiry","tenx_control","tenx_score_source_revision","tenx_score_page_manifest","tenx_score_page_cards","tenx_score_page_summaries"],projection=tables.slice(5),sources=tables.slice(0,5);
const Wire=z.object({response:z.object({state:z.enum(["built","held","available"]).optional(),reason:z.string().optional(),error:z.string().optional(),action_authority:z.literal(false).optional(),data:z.object({candidates:z.unknown().array()}).passthrough().optional()}).passthrough(),trace:D1TraceSchema.array()});
try{
 for(const shape of ["archived_selection","synthetic_wide_500"]){
  const memory=new DatabaseSync(":memory:");
  try{
   for(const f of readdirSync("discovery/migrations").filter(f=>f.endsWith(".sql")).sort())memory.exec(readFileSync("discovery/migrations/"+f,"utf8"));
   const at=new Date(cutoff),fixtures=await fixtureCandidates(at),items=shape==="archived_selection"?await scoreInventoryCandidates(sqliteD1(original),"live",false):Array.from({length:500},(_,i)=>{const b=new Uint8Array(32).fill(9);new DataView(b.buffer).setUint32(0,30000+i);return {...fixtures[i%fixtures.length]!,mode:"live" as const,address:toBase58(b),name:"\u0000".repeat(95)+String(i).padStart(5,"0"),symbol:"\u0001".repeat(27)+String(i).padStart(5,"0")};});
   for(const c of items)memory.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)").run(c.address,c.pool,JSON.stringify(c),c.checked_at);
   if(shape==="archived_selection"){
    for(const c of items)for(const row of original.prepare("SELECT address,fetched_at,payload FROM tenx_market_history WHERE address=? AND fetched_at<=? ORDER BY fetched_at").all(c.address,cutoff))memory.prepare("INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES(?,?,?)").run(row.address,row.fetched_at,row.payload);
    memory.exec("DELETE FROM tenx_control");for(const row of original.prepare("SELECT * FROM tenx_control").all()){const k=Object.keys(row);memory.prepare(`INSERT INTO tenx_control(${k}) VALUES(${k.map(()=>"?")})`).run(...k.map(key=>row[key]));}
   }
   // Candidate-update guards reference other domains. Keep the complete schema,
   // including every original trigger, rather than removing a guard to seed edits.
   const schema=memory.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as {name:string;sql:string}[];
   const allTables=schema.map(t=>t.name),protectedTables=allTables.filter(t=>!projection.includes(t));
   const order=new Map(schema.map(t=>[t.name,memory.prepare(`PRAGMA table_info(${t.name})`).all().length>1?"1,2":"1"]));
   const extras=memory.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND type IN ('index','trigger','view') ORDER BY type,name").all().map(r=>String(r.sql));
   let rows=Object.fromEntries(allTables.map(name=>[name,memory.prepare(`SELECT * FROM ${name} ORDER BY ${order.get(name)}`).all() as Row[]]));
   const cases=[],guards=[];let outbound=0;
   for(const epoch of ["initial","next_cutoff","older_cutoff"]){
    const epochAt=epoch==="next_cutoff"?new Date(at.getTime()+60000):at,token=randomBytes(32).toString("hex");
    const mf=new Miniflare({workers:[{config:{name:"builder-study",type:"worker",compatibilityDate,compatibilityFlags,env:{STUDY_DB:{type:"d1",id:"builder-study-db",dev:{remote:false}},STUDY_TOKEN:{type:"json",value:token},STUDY_NOW:{type:"json",value:epochAt.toISOString()}},manifest:{mainModule:"builder-runtime.mjs",modules:{"builder-runtime.mjs":{type:"esm",contents:code}}}},dev:{outboundService:{type:"fetcher",handler:()=>{outbound++;return new Response("blocked",{status:502});}}}}],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false},isolatedResourcePersistencePath:join(output,shape,epoch)});
    try{
     const db=await mf.getD1Database("STUDY_DB","builder-study");
     for(const t of schema){await db.prepare(t.sql).run();const data=rows[t.name]!;if(!data.length)continue;const k=Object.keys(data[0]!),group=Math.floor(100/k.length),statements=[];
      for(let i=0;i<data.length;i+=group){const chunk=data.slice(i,i+group);statements.push(db.prepare(`INSERT INTO ${t.name}(${k}) VALUES ${chunk.map(()=>`(${k.map(()=>"?")})`)}`).bind(...chunk.flatMap(r=>k.map(key=>r[key]))));}for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));}
     for(const sql of extras)await db.prepare(sql).run();
     const capture=async(names:string[])=>{const saved:Record<string,Row[]>={};for(let i=0;i<names.length;i+=50){const batch=names.slice(i,i+50),result=await db.batch(batch.map(name=>db.prepare(`SELECT * FROM ${name} ORDER BY ${order.get(name)}`)));batch.forEach((name,j)=>saved[name]=result[j]!.results as Row[]);}return saved;};
     const worker=await mf.getWorker("builder-study"),url="http://localhost/api/10x/admin/score-read-pages";
     const call=async(method="POST",extra:Record<string,string>={},body=JSON.stringify({reason:"Offline native builder cost assessment"}))=>{
      const started=performance.now(),r=await worker.fetch(url,{method,headers:{"x-study-token":token,authorization:`Bearer ${token}`,"content-type":"application/json",...extra},...method==="POST"?{body}:{} }),text=await r.text(),wall=performance.now()-started;
      if(r.headers.get("cache-control")!=="no-store")throw Error("builder_headers_changed");
      return {status:r.status,wall_ms:wall,...Wire.parse(JSON.parse(text))};
     };
     const checkCards=async()=>{
      const expected=await rankedDiscovery(sqliteD1(memory),items,epochAt,"score","all",{maximum:500}),actual=[],readBefore=digest(await capture(allTables));let cursor:string|undefined;
      do{const r=await worker.fetch(url+"?"+new URLSearchParams({browse:"inventory",limit:"100",...cursor?{cursor}:{}}),{headers:{"x-study-token":token,authorization:`Bearer ${token}`}}),v=Wire.parse(await r.json()).response;
       if(r.status!==200||v.state!=="available")throw Error("builder_read_held");
       if(v.action_authority!==false||!v.data)throw Error("reader_authority_changed");actual.push(...v.data.candidates);cursor=typeof v.next_cursor==="string"?v.next_cursor:undefined;
      }while(cursor);
      if(digest(actual)!==digest(expected.rows.map(candidateCard))||readBefore!==digest(await capture(allTables)))throw Error("builder_card_parity_or_read_mutation");
     };
     const measure=async(name:string,expected:"built"|"held",reason?:string)=>{
      const before=digest(await capture(protectedTables)),old=digest(await capture(projection)),r=await call(),cost=summarizeD1Trace(r.trace);
      if(r.status!==200||r.response.state!==expected||r.response.action_authority!==false||reason&&r.response.reason!==reason||before!==digest(await capture(protectedTables)))throw Error("builder_outcome_or_source_mutation:"+name);
      if(cost.reads.total===null||cost.writes.total===null)throw Error("native_builder_metadata_missing");
      if(expected==="held"&&(old!==digest(await capture(projection))||cost.writes.total!==0))throw Error("held_builder_changed_projection");
      if(expected==="built")await checkCards();
      const result={name,cutoff:epochAt.toISOString(),response:r.response,trace:r.trace,cost,wall_ms:r.wall_ms,worker_cpu_ms:null,source_unchanged:true};cases.push(result);console.log(JSON.stringify({shape,name,cost,passed:true}));return result;
     };
     if(epoch==="initial"){
      for(const [name,status,extra,body] of [["authentication",401,{authorization:""},undefined],["origin",403,{"x-study-probe":"bad_origin"},undefined],["runtime",503,{"x-study-probe":"runtime_disabled"},undefined],["host",503,{"x-study-probe":"external_host"},undefined],["schema",400,{},"{}"]] as const){
       const before=digest(await capture(allTables)),headers:Record<string,string>={};for(const [k,v] of Object.entries(extra))if(v!==undefined)headers[k]=v;const r=await call("POST",headers,body);
       if(r.status!==status||r.trace.length||before!==digest(await capture(allTables)))throw Error("builder_guard_failed:"+name);guards.push({name,status,queries:0});}
      await measure("first_build","built");const replay=await measure("identical_replay","built");if(replay.cost.writes.total!==0)throw Error("identical_replay_wrote_rows");
      const c=items[0]!;c.symbol=c.symbol.startsWith("X")?"Y"+c.symbol.slice(1):"X"+c.symbol.slice(1);memory.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?").run(JSON.stringify(c),c.address);
      const revisionBefore=await db.prepare("SELECT revision FROM tenx_score_source_revision WHERE id=1").first<number>("revision");
      const mutation=await db.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?").bind(JSON.stringify(c),c.address).run();
      if(await db.prepare("SELECT revision FROM tenx_score_source_revision WHERE id=1").first<number>("revision")!==revisionBefore!+1)throw Error("source_invalidation_trigger_missing");
      cases.push({name:"one_source_edit",cost:summarizeD1Trace([{sql:"UPDATE tenx_candidates (including original revision trigger)",rows_read:mutation.meta.rows_read,rows_written:mutation.meta.rows_written,changes:mutation.meta.changes,returned_rows:mutation.results.length}]),worker_cpu_ms:null});
      await measure("one_body_edit_same_cutoff","built");
      await db.prepare("UPDATE tenx_control SET paused=1 WHERE id=1").run();await measure("paused_hold","held","paused");await db.prepare("UPDATE tenx_control SET paused=0 WHERE id=1").run();
      // The failure must occur AFTER a real body change inside the batch. A
      // no-op replay would not demonstrate rollback of an earlier write.
      const originalCandidate=items[1]!,stagedSymbol=(originalCandidate.symbol.startsWith("R")?"S":"R")+originalCandidate.symbol.slice(1),staged={...originalCandidate,symbol:stagedSymbol};
      await db.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?").bind(JSON.stringify(staged),staged.address).run();
      const before=digest(await capture(allTables)),literal=(v:string)=>"'"+v.replaceAll("'","''")+"'";
      await db.prepare(`CREATE TRIGGER study_builder_failure BEFORE INSERT ON tenx_score_page_manifest
        WHEN EXISTS(SELECT 1 FROM tenx_score_page_cards WHERE address=${literal(staged.address)} AND json_extract(payload,'$.symbol')=json_extract(${literal(JSON.stringify(stagedSymbol))},'$'))
        BEGIN SELECT RAISE(ABORT,'isolated_builder_failure'); END`).run();
      const failed=await call();if(failed.status!==503||before!==digest(await capture(allTables)))throw Error("builder_batch_rollback_failed");
      await db.prepare("DROP TRIGGER study_builder_failure").run();
      // Undo only the synthetic stimulus through original triggers; revision
      // advances again and is never reset. Next epoch measures a pure refresh.
      await db.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?").bind(JSON.stringify(originalCandidate),originalCandidate.address).run();
      guards.push({name:"atomic_rollback_after_body_write",status:503,queries:failed.trace.length});
     }else if(epoch==="next_cutoff")await measure("sixty_second_refresh","built");
     else await measure("older_cutoff_hold","held","source_changed_paused_or_newer_snapshot");
     rows=await capture(allTables);
    }finally{await mf.dispose();}
   }
   if(outbound)throw Error("builder_outbound_attempt");
   const cold=cases.find(c=>c.name==="first_build")!,refresh=cases.find(c=>c.name==="sixty_second_refresh")!,edit=cases.find(c=>c.name==="one_source_edit")!;
   const reader=readers.studies.find(s=>s.shape===shape)?.routes.find(r=>r.route==="compact")?.cases.find(c=>c.query.age==="24h"&&c.query.browse==="inventory");if(!reader)throw Error("matching_reader_evidence_required");
   const worksheet=[1,10,30].map(viewers=>({viewers,plan:assessFreeServingWorkload({components:[{name:"reader",invocations_daily:viewers*1440,rows_read:reader.rows_read,rows_written:0,queries:reader.queries,cpu_ms:null},{name:"first_build",invocations_daily:1,rows_read:cold.cost.reads.total,rows_written:cold.cost.writes.total,queries:cold.cost.queries,cpu_ms:null},{name:"scheduled_refresh",invocations_daily:1439,rows_read:refresh.cost.reads.total,rows_written:refresh.cost.writes.total,queries:refresh.cost.queries,cpu_ms:null},{name:"source_edits",invocations_daily:null,rows_read:edit.cost.reads.total,rows_written:edit.cost.writes.total,queries:edit.cost.queries,cpu_ms:null},{name:"event_driven_rebuilds",invocations_daily:null,rows_read:refresh.cost.reads.total,rows_written:refresh.cost.writes.total,queries:refresh.cost.queries,cpu_ms:null}],background:{worker_requests:null,d1_reads:null,d1_writes:null},refresh_seconds:60,validity_seconds:60,database_bytes:null,account_bytes:null,largest_row_bytes:null})}));
   studies.push({shape,candidates:items.length,schema_tables:allTables.length,cases,guards,worksheet,outbound_attempts:outbound,source_triggers_copied:true,projection_adopted:false});
  }finally{memory.close();}
 }
}finally{original.close();}
if(await sha(source)!==pin||await sha(readerFile)!==readerPin)throw Error("original_input_changed");
const report={version:1,source:{path:source,sha256:pin,cutoff,unchanged:true},reader_report:{path:readerFile,sha256:readerPin,unchanged:true},bundle_sha256:createHash("sha256").update(code).digest("hex"),studies,decision:"held",free_acceptance:false,action_authority:false,provider_requests:0,runtime_adopted:false,limitations:["Local native D1 metadata is not remote billing or deployed Workers CPU.","Selected active candidates and history only; full store/account/heap/growth/Pages and other projects remain unmeasured.","Scheduled worksheet extrapolates one observed refresh, not a measured whole day. Source/edit-driven frequency and background usage stay unknown.","Sixty-second validity is unchanged; scheduling/failed build latency leaves gaps, and historical data is never refreshed by replay."]};
const text=JSON.stringify(report,null,2)+"\n";writeFileSync(join(output,"report.json"),text,{flag:"wx"});console.log(JSON.stringify({report:join(output,"report.json"),sha256:createHash("sha256").update(text).digest("hex"),decision:"held"}));
