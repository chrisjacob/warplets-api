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
const code=`import {storedJsonHash,storedJsonTextHash} from '../discovery/src/stored-json-hash.ts';
import {PackedScoreInventorySchema,packScoreInventory,unpackScoreInventory} from '../discovery/src/score-read-index.ts';
import {ScoreSummaryRowsSchema,PackedScoreSummariesSchema,packScoreSummaries,unpackScoreSummaries} from '../discovery/src/score-read-summaries.ts';
export default {async fetch(request){const values=await request.json();const results=[];
for(const entry of values){const value=entry.undefined?undefined:entry.value;
const native=storedJsonHash(value),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
const original=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');results.push(native===original&&storedJsonTextHash(JSON.stringify(value)??'')===original);}
const entries=Array.from({length:500},(_,i)=>({address:'11111111111111111111111111111111',name:'\\u0000'.repeat(95)+String(i).padStart(5,'0'),symbol:'\\u0001'.repeat(27)+String(i).padStart(5,'0'),
eligibility:'provisional',creation_at:null,score:i/5,coverage:(500-i)/5,liquidity:null,freshness:'missing',card_hash:'a'.repeat(64),body_hash:'b'.repeat(64),score_page:Math.floor(i/25)}));
const packed=packScoreInventory(entries),parsed=PackedScoreInventorySchema.parse(packed);
const inventory_equal=JSON.stringify(unpackScoreInventory(parsed))===JSON.stringify(entries);
const invalid=[{...packed,text:[...packed.text,'unused']},{...packed,rows:[[...packed.rows[0],'extra']]},{...packed,rows:packed.rows.map((r,i)=>i?r:[r[0],999,...r.slice(2)])}];
const inventory_rejections=invalid.filter(v=>!PackedScoreInventorySchema.safeParse(v).success).length;
const originals=ScoreSummaryRowsSchema.parse(entries.slice(0,25).map((e,i)=>({address:e.address,discovery_score:{version:'discovery-score-v4',as_of:'2026-10-22T01:00:00.000Z',value:i*4,evidence_coverage:75,ceiling:100,input_hash:'1'.repeat(64),policy_hash:'2'.repeat(64),result_hash:'3'.repeat(64),record_hash:'4'.repeat(64),risk_flags:Array.from({length:24},(_,j)=>({code:'Concern '+j,ceiling:j,observed_at:null}))}})));
const compact=packScoreSummaries(originals),decoded=unpackScoreSummaries(PackedScoreSummariesSchema.parse(compact));
const summary_equal=JSON.stringify(originals)===JSON.stringify(decoded),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(originals)));
const summary_hash_equal=storedJsonHash(decoded)===storedJsonTextHash(JSON.stringify(decoded))&&storedJsonHash(decoded)===Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
const bad=[{...compact,headers:[]},{...compact,flags:[...compact.flags,[]]},{...compact,rows:[[...compact.rows[0],'extra']]}];
const summary_rejections=bad.filter(v=>!PackedScoreSummariesSchema.safeParse(v).success).length;
return Response.json({all_equal:results.every(Boolean),vectors:results.length,inventory_equal,inventory_rows:entries.length,inventory_rejections,summary_equal,summary_hash_equal,summary_rows:originals.length,summary_rejections});}};`;
const bundled=await build({stdin:{contents:code,resolveDir:fileURLToPath(new URL(".",import.meta.url)),sourcefile:"stored-hash-check.ts",loader:"ts"},bundle:true,write:false,format:"esm",platform:"neutral",external:["node:crypto"]});
const values=[{undefined:true},...[null,"",true,1.25,{z:1,a:2},"\u0000\n\"\\","🙂漢字","\ud800",{payload:"x".repeat(16000)},{payload:"x".repeat(100000)},{payload:"x".repeat(600000)},{payload:"x".repeat(1800000)}].map(value=>({value}))];
const mf=new Miniflare({workers:[{config:{name:"hash-check",type:"worker",compatibilityDate,compatibilityFlags,manifest:{mainModule:"hash-check.mjs",modules:{"hash-check.mjs":{type:"esm",contents:bundled.outputFiles[0].text}}}}}],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false}});
try {
  const worker=await mf.getWorker("hash-check"),response=await worker.fetch("http://localhost/hash-check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(values)});
  const result=await response.json();
  if(!response.ok||!result.all_equal||result.vectors!==values.length||!result.inventory_equal||result.inventory_rows!==500||result.inventory_rejections!==3||!result.summary_equal||!result.summary_hash_equal||result.summary_rows!==25||result.summary_rejections!==3)throw Error("runtime_hash_or_projection_parity_failed");
  console.log(JSON.stringify({runtime:"installed local workerd",compatibilityDate,compatibilityFlags,...result,no_database_bindings:true,no_provider_credentials:true,cpu_acceptance:false}));
} finally {await mf.dispose();}
