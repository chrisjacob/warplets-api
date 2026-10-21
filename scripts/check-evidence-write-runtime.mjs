// Installed workerd + isolated synthetic D1 only. No credentials or live data.
import {createRequire} from "node:module";
import {mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {evidencePrivatePath} from "./discovery-evidence-objects.mjs";
const base=createRequire(new URL("../discovery/package.json",import.meta.url)),require=createRequire(base.resolve("wrangler/package.json"));
const {Miniflare}=require("miniflare"),{build}=require("esbuild"),target=process.argv[2];
if(!target)throw Error("Supply a NEW private .tmp output directory");const output=await evidencePrivatePath(target,true);
if(path.dirname(output)!==await realpath(".tmp"))throw Error("Standalone private .tmp output required");await mkdir(output,{mode:0o700});
const config=await readFile("discovery/wrangler.local.jsonc","utf8"),compatibilityDate=config.match(/"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1],compatibilityFlags=JSON.parse(config.match(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/)?.[1]??"null");
if(!compatibilityDate||!Array.isArray(compatibilityFlags)||!compatibilityFlags.includes("nodejs_compat"))throw Error("Existing compatibility config required");
const bundle=await build({entryPoints:["scripts/evidence-write-runtime.ts"],bundle:true,write:false,platform:"neutral",format:"esm",metafile:true}),code=bundle.outputFiles[0].text;
if(Object.keys(bundle.metafile.inputs).some(f=>f!=="scripts/evidence-write-runtime.ts"&&f!=="discovery/src/evidence-write-store.ts"))throw Error("Unexpected native fixture dependency");
let outbound=0;const name="evidence-write-study",mf=new Miniflare({workers:[{config:{name,type:"worker",compatibilityDate,compatibilityFlags,env:{TENX_DB:{type:"d1",id:name,dev:{remote:false}}},manifest:{mainModule:"writes.mjs",modules:{"writes.mjs":{type:"esm",contents:code}}}},dev:{outboundService:{type:"fetcher",handler:()=>{outbound++;return new Response("blocked",{status:502});}}}}],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false},isolatedResourcePersistencePath:path.join(output,"isolated-runtime")});
try{
  const db=await mf.getD1Database("TENX_DB",name);
  for(const [file,table] of [["0004_research_history.sql","tenx_holder_evidence"],["0005_wallet_analysis.sql","tenx_wallet_evidence"]]){
    const sql=(await readFile("discovery/migrations/"+file,"utf8")).match(new RegExp("CREATE TABLE "+table+" \\([\\s\\S]*?\\);"))?.[0];
    if(!sql)throw Error("Original evidence table definition required");await db.prepare(sql).run();
  }
  await db.prepare("CREATE TABLE study_spent(id TEXT PRIMARY KEY,used INTEGER NOT NULL)").run();await db.prepare("CREATE TABLE study_publications(id TEXT PRIMARY KEY,value TEXT NOT NULL)").run();
  const response=await mf.dispatchFetch("http://study/check"),result=await response.json();
  if(response.status!==200||result.cases?.length!==11||!result.cases.every(c=>c.passed)||outbound)throw Error("Native evidence write contract or egress failed");
  const report={version:"evidence-write-native-study-v1",compatibilityDate,compatibilityFlags,bundle_sha256:createHash("sha256").update(code).digest("hex"),cases:result.cases,outbound_requests:outbound,synthetic_database_only:true,application_runtime_activated:false,free_acceptance:false,cpu_acceptance:false};
  const serialized=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(output,"writes.json"),serialized,{flag:"wx",mode:0o600});console.log(JSON.stringify({cases:result.cases.length,all_passed:true,outbound_requests:outbound,report_file_sha256:createHash("sha256").update(serialized).digest("hex"),free_acceptance:false}));
}finally{await mf.dispose();}
