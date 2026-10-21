// Installed workerd only, synthetic streams, blocked egress and no bindings/secrets.
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
const bundle=await build({entryPoints:["scripts/bounded-json-runtime.ts"],bundle:true,write:false,platform:"neutral",format:"esm",external:["node:*"]}),code=bundle.outputFiles[0].text;
let outbound=0;const mf=new Miniflare({workers:[{config:{name:"json-stream-study",type:"worker",compatibilityDate,compatibilityFlags,manifest:{mainModule:"stream.mjs",modules:{"stream.mjs":{type:"esm",contents:code}}}},dev:{outboundService:{type:"fetcher",handler:()=>{outbound++;return new Response("blocked",{status:502});}}}}],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false},isolatedResourcePersistencePath:path.join(output,"isolated-runtime")});
try{
  const cases=[];
  for(const [kind,error] of [["normal",null],["oversized","response_too_large"],["fragmented","response_fragment_limit"],["empty_fragments","response_fragment_limit"],["stalled","response_timeout"]]){
    const start=performance.now(),response=await mf.dispatchFetch("http://study/"+kind),result=await response.json();
    if(result.error!==error||!result.stream_unlocked||(error&&result.cancellations!==1)||(!error&&JSON.stringify(result.value)!==JSON.stringify({text:"漢😀",zero:0,flag:false})))throw Error("Native stream result mismatch");
    cases.push({...result,wall_ms:performance.now()-start});
  }
  if(outbound)throw Error("Unexpected egress");const report={version:"bounded-json-native-study-v1",compatibilityDate,compatibilityFlags,bundle_sha256:createHash("sha256").update(code).digest("hex"),cases,outbound_requests:outbound,database_bindings:0,application_runtime_activated:false,cpu_acceptance:false};
  const serialized=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(output,"streams.json"),serialized,{flag:"wx",mode:0o600});console.log(JSON.stringify({cases:cases.length,all_passed:true,outbound_requests:outbound,report_file_sha256:createHash("sha256").update(serialized).digest("hex"),cpu_acceptance:false}));
}finally{await mf.dispose();}
