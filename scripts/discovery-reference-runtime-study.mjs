// Isolated synthetic study. Never uses live data, application secrets or remote bindings.
import {createRequire} from "node:module";
import {createCipheriv,randomBytes} from "node:crypto";
import {gzipSync} from "node:zlib";
import {lstat,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {evidencePrivatePath} from "./discovery-evidence-objects.mjs";
import {createReferenceTree,verifyReferenceProof} from "./lib/evidence-reference-proof.mjs";
import {recoverEvidenceBytes,evidenceHash as sha} from "./lib/evidence-reference-contract.mjs";

const base=createRequire(new URL("../discovery/package.json",import.meta.url)),require=createRequire(base.resolve("wrangler/package.json"));
const {Miniflare}=require("miniflare"),{build}=require("esbuild");
const NOW="2026-10-22T01:00:00.000Z",TABLE="tenx_holder_evidence";
const clone=value=>JSON.parse(JSON.stringify(value)),digest=value=>sha(JSON.stringify(value));
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:values.length,min_ms:sorted[0],median_ms:sorted[Math.floor(sorted.length/2)],p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_ms:sorted.at(-1)};};
const config=await readFile("discovery/wrangler.local.jsonc","utf8"),compatibilityDate=config.match(/"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1],compatibilityFlags=JSON.parse(config.match(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/)?.[1]??"null");
if(!compatibilityDate||!Array.isArray(compatibilityFlags)||!compatibilityFlags.includes("nodejs_compat"))throw Error("Existing local compatibility configuration required");
const output=await evidencePrivatePath(process.argv[2]??"",true),privateRoot=await realpath(".tmp");
for(let parent=path.dirname(output);parent===privateRoot||parent.startsWith(privateRoot+path.sep);parent=path.dirname(parent)){
  for(const marker of ["sealed.json","objects.json","index.json","references.json","manifest.json","pack.json"]){try{await lstat(path.join(parent,marker));}catch(error){if(error.code==="ENOENT")continue;throw error;}throw Error("Study output cannot be nested inside an evidence artifact");}
  if(parent===privateRoot)break;
}
await mkdir(output,{mode:0o700});
const key=randomBytes(32),token=randomBytes(32).toString("hex"),grants={},fixtures=[];
function encoded(raw){
  const compressed=gzipSync(raw),iv=randomBytes(12),object={sha256:sha(raw),bytes:raw.length,gzip_bytes:compressed.length,gzip_sha256:sha(compressed)},cipher=createCipheriv("aes-256-gcm",key,iv,{authTagLength:16});
  cipher.setAAD(Buffer.from("discovery-evidence-sealed-v1|object|"+object.sha256));const bytes=Buffer.concat([cipher.update(compressed),cipher.final()]);
  return {object,sealed:{sha256:sha(bytes),bytes:bytes.length,iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex")},bytes};
}
const commonPayload="synthetic unselected evidence",common=encoded(Buffer.from(commonPayload));
const noisy=randomBytes(2000000);for(let i=0;i<noisy.length;i++)noisy[i]&=127;
const cases=[
  {id:"ordinary",count:958,raw:Buffer.from("\ufeffsynthetic\0漢 "+"x".repeat(1000))},
  {id:"maximum_proof",count:10000,raw:Buffer.from("max-proof "+"x".repeat(1000))},
  {id:"maximum_compressible",count:10000,raw:Buffer.alloc(2000000,120)},
  {id:"maximum_ascii",count:10000,raw:noisy},
  {id:"maximum_metadata",count:10000,raw:Buffer.from("metadata-bound"),wide:true},
  {id:"gzip_overrun",count:3,raw:Buffer.alloc(4096,120),invalid:"gzip"},
  {id:"invalid_utf8",count:3,raw:Buffer.from([255]),invalid:"utf8"},
  {id:"invalid_gcm_tag",count:3,raw:Buffer.from("authenticated synthetic evidence"),invalid:"tag"},
];
for(const item of cases){
  const data=encoded(item.raw);if(item.invalid==="gzip")data.object.bytes=1;
  if(item.invalid==="tag")data.sealed.tag=(parseInt(data.sealed.tag.slice(0,2),16)^1).toString(16).padStart(2,"0")+data.sealed.tag.slice(2);
  const ordinal=item.count-1,identity=item.wide?"\u0000".repeat(4090)+"target":item.id+"-target",metadata=[identity,item.wide?"\u0001".repeat(4096):"synthetic-mint",42,item.wide?"\u0002".repeat(4096):NOW];
  const row={payload_hash:metadata[0],address:metadata[1],slot:metadata[2],payload:item.raw.toString("utf8"),observed_at:metadata[3]},reference={ordinal,entry:{table:TABLE,metadata,object_sha256:data.object.sha256,row_sha256:digest(row)},object:data.object,sealed:data.sealed};
  const context={version:"discovery-evidence-references-v1",source_index_manifest_sha256:sha(item.id+"-index"),source_sealed_manifest_sha256:sha(item.id+"-sealed"),source_catalog_manifest_sha256:sha(item.id+"-catalog"),source_archive_manifest_sha256:sha(item.id+"-archive"),rows:item.count,objects:2};
  const refs=Array.from({length:item.count},(_,i)=>{if(i===ordinal)return reference;const r={payload_hash:item.id+"-"+i,address:"synthetic-mint",slot:42,payload:commonPayload,observed_at:NOW};return {ordinal:i,entry:{table:TABLE,metadata:[r.payload_hash,r.address,r.slot,r.observed_at],object_sha256:common.object.sha256,row_sha256:digest(r)},object:common.object,sealed:common.sealed};});
  const tree=createReferenceTree(context,refs),body={context,confidentiality:"private_plaintext_metadata",algorithm:"sha256-domain-separated-duplicate-last-v1",root_sha256:tree.root_sha256,database:{file:"references.sqlite",bytes:1,sha256:"0".repeat(64)}},manifest={...body,reference_manifest_sha256:digest(body)},pin=manifest.reference_manifest_sha256;
  const proof=tree.proofs[ordinal];verifyReferenceProof(manifest,pin,reference,proof,TABLE,identity);
  if(!item.invalid&&digest(recoverEvidenceBytes({entry:reference.entry,object:reference.object,sealed:reference.sealed},data.bytes,key))!==digest(row))throw Error("Node original-row parity failed");
  const grant={case_id:item.id,generation:sha(item.id+"-generation"),manifest,pin,table:TABLE,identity,expires_at:"2026-10-22T01:00:30.000Z"};grants[item.id]=grant;
  fixtures.push({id:item.id,grant,reference,proof,bytes:data.bytes,expected:digest(row),serialized_bytes:Buffer.byteLength(JSON.stringify(row)),invalid:item.invalid??null,raw_bytes:item.raw.length});
}
const bundled=await build({entryPoints:["scripts/lib/evidence-reference-runtime-worker.mjs"],bundle:true,write:false,format:"esm",platform:"neutral",external:["node:*"],metafile:true});
const forbidden=Object.keys(bundled.metafile.inputs).filter(f=>/node:sqlite|discovery-evidence-(?:references|index|objects|sealed)\.mjs$/.test(f));if(forbidden.length)throw Error("Offline storage module reached runtime bundle");
if(Object.values(bundled.metafile.outputs).some(o=>o.imports.some(i=>/^node:(?:fs|sqlite|path|url|module)(?:\/|$)/.test(i.path))))throw Error("Filesystem module reached runtime bundle");
const code=bundled.outputFiles[0].text;await writeFile(path.join(output,"reference-worker.mjs"),code,{flag:"wx",mode:0o600});
let outbound=0;const mf=new Miniflare({workers:[{config:{name:"reference-study",type:"worker",compatibilityDate,compatibilityFlags,
  env:{STUDY_DB:{type:"d1",id:"reference-study",dev:{remote:false}},STUDY_OBJECTS:{type:"r2",name:"reference-study",dev:{remote:false}},STUDY_TOKEN:{type:"json",value:token},STUDY_KEY:{type:"json",value:key.toString("hex")},STUDY_NOW:{type:"json",value:NOW},STUDY_GRANTS:{type:"json",value:grants}},
  manifest:{mainModule:"reference-worker.mjs",modules:{"reference-worker.mjs":{type:"esm",contents:code}}}},dev:{outboundService:{type:"fetcher",handler:()=>{outbound++;return new Response("blocked",{status:502});}}}}],host:"127.0.0.1",port:0,cf:false,telemetry:{enabled:false},isolatedResourcePersistencePath:path.join(output,"isolated-runtime")});
try{
  const db=await mf.getD1Database("STUDY_DB","reference-study"),bucket=await mf.getR2Bucket("STUDY_OBJECTS","reference-study"),worker=await mf.getWorker("reference-study");
  await db.prepare("CREATE TABLE study_generations(case_id TEXT PRIMARY KEY,generation TEXT NOT NULL,manifest_pin TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE study_references(generation TEXT NOT NULL,table_name TEXT NOT NULL,identity TEXT NOT NULL,ordinal INTEGER NOT NULL,reference_json TEXT NOT NULL,proof_json TEXT NOT NULL,PRIMARY KEY(generation,table_name,identity))").run();
  for(const f of fixtures){await db.prepare("INSERT INTO study_generations VALUES(?,?,?)").bind(f.id,f.grant.generation,f.grant.pin).run();await db.prepare("INSERT INTO study_references VALUES(?,?,?,?,?,?)").bind(f.grant.generation,TABLE,f.grant.identity,f.reference.ordinal,JSON.stringify(f.reference),JSON.stringify(f.proof)).run();await bucket.put(f.reference.sealed.sha256,f.bytes);}
  const snapshot=async()=>digest({generations:(await db.prepare("SELECT * FROM study_generations ORDER BY case_id").all()).results,references:(await db.prepare("SELECT * FROM study_references ORDER BY generation").all()).results});
  const before=await snapshot(),request=async(id,extra={},headers={authorization:"Bearer "+token})=>{const start=performance.now(),response=await worker.fetch("http://localhost/study/reference?"+new URLSearchParams({case:id,...extra}),{headers}),text=await response.text();return {status:response.status,headers:response.headers,value:JSON.parse(text),wall_ms:performance.now()-start,receipt_bytes:Buffer.byteLength(text)};};
  const check=(f,r)=>{if(r.status!==200||r.headers.get("cache-control")!=="no-store"||r.value.state!=="available"||r.value.row_sha256!==f.expected||r.value.serialized_row_bytes!==f.serialized_bytes||r.value.object_reads!==1||r.value.index_bytes_hashed!==0||r.value.trace.length!==3||r.value.trace.some(q=>q.rows_written!==0)||r.value.action_authority!==false)throw Error("Runtime parity/read-only contract failed: "+f.id);};
  const measurements=[];
  for(const f of fixtures.filter(f=>!f.invalid)){
    const first=await request(f.id);check(f,first);for(let i=0;i<2;i++)check(f,await request(f.id));
    const times=[];for(let i=0;i<8;i++){const r=await request(f.id);check(f,r);times.push(r.wall_ms);}
    measurements.push({case_id:f.id,raw_bytes:f.raw_bytes,encrypted_bytes:f.bytes.length,serialized_row_bytes:f.serialized_bytes,first_wall_ms:first.wall_ms,warm_wall:summary(times),trace:first.value.trace,proof_hashes:first.value.proof_hashes,reference_bytes:first.value.reference_bytes,proof_bytes:first.value.proof_bytes,receipt_bytes:first.receipt_bytes});
  }
  const heavy=fixtures.find(f=>f.id==="maximum_ascii"),concurrent=await Promise.all(Array.from({length:4},()=>request(heavy.id)));for(const r of concurrent)check(heavy,r);
  if(await snapshot()!==before)throw Error("Normal reads changed local D1");
  const guards={unauthorized:(await request("ordinary",{},{})).status,bad_origin:(await request("ordinary",{__bad_origin:"1"})).status,expired:(await request("ordinary",{__expired:"1"})).value};
  if(guards.unauthorized!==401||guards.bad_origin!==403||guards.expired.reason!=="expired_grant"||guards.expired.trace.length||guards.expired.object_reads)throw Error("Private admission failed");
  const held=[];for(const f of fixtures.filter(f=>f.invalid)){const r=await request(f.id);if(r.status!==409||r.value.state!=="held"||r.value.row_sha256)throw Error("Malformed evidence accepted");held.push({case_id:f.id,reason:r.value.reason,object_reads:r.value.object_reads});}
  const ordinary=fixtures[0],restore=()=>db.prepare("UPDATE study_generations SET generation=?,manifest_pin=? WHERE case_id=?").bind(ordinary.grant.generation,ordinary.grant.pin,ordinary.id).run();
  await db.prepare("UPDATE study_generations SET manifest_pin=? WHERE case_id=?").bind("0".repeat(64),ordinary.id).run();const wrongRoot=await request("ordinary");if(wrongRoot.status!==409||wrongRoot.value.trace.length!==1||wrongRoot.value.object_reads!==0)throw Error("Unadmitted root queried evidence");await restore();
  const races=[];for(const phase of ["after_reference","after_payload"]){const r=await request("ordinary",{__race:phase});if(r.status!==409||r.value.reason!=="generation_changed"||r.value.row_sha256)throw Error("Generation race accepted");races.push({phase,reason:r.value.reason});await restore();}
  await db.prepare("UPDATE study_references SET proof_json=? WHERE generation=?").bind(JSON.stringify(["0".repeat(64)]),ordinary.grant.generation).run();const badProof=await request("ordinary");if(badProof.status!==409||badProof.value.object_reads!==0)throw Error("Invalid proof read an object");
  await db.prepare("UPDATE study_references SET proof_json=? WHERE generation=?").bind(JSON.stringify(ordinary.proof),ordinary.grant.generation).run();
  const corrupted=Buffer.from(ordinary.bytes);corrupted[0]^=1;await bucket.put(ordinary.reference.sealed.sha256,corrupted);const badCipher=await request("ordinary");if(badCipher.status!==409||badCipher.value.row_sha256)throw Error("Ciphertext corruption accepted");await bucket.put(ordinary.reference.sealed.sha256,ordinary.bytes);
  if(await snapshot()!==before||outbound!==0)throw Error("Study restoration/egress contract failed");
  const report={version:"evidence-reference-runtime-study-v1",runtime:"installed local workerd/native D1 and local object storage",compatibilityDate,compatibilityFlags,bundle_sha256:sha(code),synthetic_only:true,selected_rows_seeded:fixtures.length,full_context_population_seeded:false,measurements,
    maximum_ascii_concurrency_4_wall:summary(concurrent.map(r=>r.wall_ms)),guards:{unauthorized:guards.unauthorized,bad_origin:guards.bad_origin,origin_test_mode:"hostile Origin injected inside worker after authentication to bypass RPC proxy prefilter",expired:guards.expired.reason,expired_database_queries:guards.expired.trace.length,wrong_root_database_queries:wrongRoot.value.trace.length,wrong_root_object_reads:wrongRoot.value.object_reads},held,races,invalid_proof_object_reads:badProof.value.object_reads,ciphertext_corruption_held:true,normal_reads_zero_writes:true,original_fixture_rows_restored:true,blocked_outbound_attempts:outbound,
    network_requests:0,application_credentials_used:false,runtime_activated:false,action_authority:false,cpu_acceptance:false,free_acceptance:false,limits:"Local wall latency and local D1 metadata only; not billed Worker CPU, deployed D1/R2 metering/coldness, private production authorization, complete source/recovery/growth/shared-budget acceptance. Responses serialize/hash the original row internally and return only synthetic receipts."};
  const text=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(output,"report.json"),text,{flag:"wx",mode:0o600});console.log(JSON.stringify({report_sha256:sha(text),cases:measurements.length,maximum_proof_hashes:Math.max(...measurements.map(c=>c.proof_hashes)),...report}));
}finally{key.fill(0);await mf.dispose();}
