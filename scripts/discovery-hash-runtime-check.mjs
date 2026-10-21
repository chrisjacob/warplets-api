// One-shot local component check. No app/database bindings, credentials or provider IO.
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const base=createRequire(new URL("../discovery/package.json",import.meta.url));
const require=createRequire(base.resolve("wrangler/package.json"));
const {Miniflare}=require("miniflare"),{build}=require("esbuild");
const config=readFileSync(new URL("../discovery/wrangler.local.jsonc",import.meta.url),"utf8");
const compatibilityDate=config.match(/"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1];
const compatibilityFlags=JSON.parse(config.match(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/)?.[1]??"null");
if(!compatibilityDate||!Array.isArray(compatibilityFlags)||!compatibilityFlags.every(f=>typeof f==="string"))throw Error("local_compatibility_config_required");
const code=`import {storedJsonHash} from '../discovery/src/stored-json-hash.ts';
export default {async fetch(request){const values=await request.json();const results=[];
for(const entry of values){const value=entry.undefined?undefined:entry.value;
const native=storedJsonHash(value),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
const original=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');results.push(native===original);}
return Response.json({all_equal:results.every(Boolean),vectors:results.length});}};`;
const bundled=await build({stdin:{contents:code,resolveDir:fileURLToPath(new URL(".",import.meta.url)),sourcefile:"stored-hash-check.ts",loader:"ts"},bundle:true,write:false,format:"esm",platform:"neutral",external:["node:crypto"]});
const values=[{undefined:true},...[null,"",true,1.25,{z:1,a:2},"\u0000\n\"\\","🙂漢字","\ud800",{payload:"x".repeat(16000)},{payload:"x".repeat(100000)},{payload:"x".repeat(600000)},{payload:"x".repeat(1800000)}].map(value=>({value}))];
const mf=new Miniflare({workers:[{config:{name:"hash-check",type:"worker",compatibilityDate,compatibilityFlags,manifest:{mainModule:"hash-check.mjs",modules:{"hash-check.mjs":{type:"esm",contents:bundled.outputFiles[0].text}}}}}],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false}});
try {
  const worker=await mf.getWorker("hash-check"),response=await worker.fetch("http://localhost/hash-check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(values)});
  const result=await response.json();
  if(!response.ok||!result.all_equal||result.vectors!==values.length)throw Error("runtime_hash_parity_failed");
  console.log(JSON.stringify({runtime:"installed local workerd",compatibilityDate,compatibilityFlags,...result,no_database_bindings:true,no_provider_credentials:true,cpu_acceptance:false}));
} finally {await mf.dispose();}
