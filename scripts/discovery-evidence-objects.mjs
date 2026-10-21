// Private offline prototype. No runtime bindings, provider IO or live writes.
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {lstat,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync,gunzipSync} from "node:zlib";
import {z} from "zod";
import {verifyArchive,hashFile} from "./discovery-archive.mjs";

const VERSION="discovery-evidence-objects-v1",FILE="objects.json",MAX_TOTAL=2*1024**3,MAX_MANIFEST=16*1024**2;
export const OBJECT_MAX_BYTES=2000000;
const columns={tenx_holder_evidence:["payload_hash","address","slot","payload","observed_at"],tenx_wallet_evidence:["payload_hash","address","payload","observed_at"]};
const tables=Object.keys(columns),Hash=z.string().regex(/^[a-f0-9]{64}$/),Count=z.number().int().safe().nonnegative();
const ObjectDescriptor=z.object({sha256:Hash,bytes:Count.max(OBJECT_MAX_BYTES),gzip_bytes:Count.positive().max(2100000),gzip_sha256:Hash}).strict();
const Body=z.object({version:z.literal(VERSION),confidentiality:z.literal("private_holder_wallet_evidence_subset"),codec:z.literal("gzip"),encrypted:z.literal(false),
  source_manifest_sha256:Hash,source_manifest:z.unknown(),objects:ObjectDescriptor.array().max(10000),
  entries:z.object({table:z.enum(tables),metadata:z.union([z.string().max(4096),z.number().int().safe()]).array().min(3).max(4),object_sha256:Hash,row_sha256:Hash}).strict().array().max(10000)}).strict();
const sha=value=>createHash("sha256").update(value).digest("hex"),digest=value=>sha(JSON.stringify(value));
function exactText(bytes){try{return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error("Evidence text is not exact UTF-8");}}
const within=(root,file)=>{const name=path.relative(root,file);return name!==""&&!path.isAbsolute(name)&&name!==".."&&!name.startsWith(".."+path.sep);};
async function privatePath(file,fresh=false){
  const root=await realpath(path.resolve(".tmp")),lexical=path.resolve(file),parent=await realpath(path.dirname(lexical)),resolved=path.join(parent,path.basename(lexical));
  if(!within(root,lexical)||!within(root,resolved)||[lexical,resolved].some(p=>p.split(/[\\/]/).some(part=>part.toLowerCase()===".wrangler")))throw Error("Evidence objects require a private .tmp path outside .wrangler");
  if(fresh)return resolved;
  const info=await lstat(resolved),actual=await realpath(resolved);
  if(info.isSymbolicLink()||!within(root,actual))throw Error("Evidence object links are not allowed");
  return actual;
}
async function regular(file,maximum){const resolved=await privatePath(file),info=await lstat(resolved);if(!info.isFile()||info.size<=0||info.size>maximum)throw Error("Invalid evidence file size/type");return {file:resolved,bytes:info.size};}
function metadataFor(table,row){
  const names=columns[table];if(!names)throw Error("Unsupported evidence table");
  if(Object.keys(row).join("|")!==names.join("|")||typeof row.payload!=="string")throw Error("Unsupported evidence row layout");
  const metadata=names.filter(k=>k!=="payload").map(k=>row[k]);
  if(metadata.some((v,i)=>table==="tenx_holder_evidence"&&i===2?!Number.isSafeInteger(v):typeof v!=="string"||v.length>4096)||!metadata[0])throw Error("Unsupported evidence metadata");
  return metadata;
}
function rowFor(entry,payload){let i=0;const row=Object.fromEntries(columns[entry.table].map(k=>[k,k==="payload"?payload:entry.metadata[i++]]));metadataFor(entry.table,row);
  if(digest(row)!==entry.row_sha256)throw Error("Evidence row checksum mismatch");return row;}
function validateManifest(value,expected){
  const {catalog_manifest_sha256,...body}=value??{};
  if(!/^[a-f0-9]{64}$/.test(expected??"")||catalog_manifest_sha256!==expected||digest(body)!==expected)throw Error("Evidence catalog checksum mismatch");
  Body.parse(body); // Validate without replacing/reordering the pinned original.
  const source=body.source_manifest,{manifest_sha256,...sourceBody}=source??{};
  if(manifest_sha256!==body.source_manifest_sha256||digest(sourceBody)!==manifest_sha256||sourceBody.version!=="discovery-local-archive-v1"||sourceBody.database?.file!=="discovery.sqlite"||
    !/^[a-f0-9]{64}$/.test(sourceBody.database?.sha256??"")||!Number.isSafeInteger(sourceBody.database?.bytes)||sourceBody.database.bytes<=0||sourceBody.database.bytes>MAX_TOTAL||!Array.isArray(sourceBody.storage?.inventory))throw Error("Invalid pinned source archive");
  const objects=new Map(body.objects.map(o=>[o.sha256,o])),seen=new Set(),used=new Set();
  if(objects.size!==body.objects.length)throw Error("Duplicate evidence object");
  for(const entry of body.entries){
    const names=columns[entry.table].filter(k=>k!=="payload");if(entry.metadata.length!==names.length)throw Error("Invalid evidence metadata length");
    metadataFor(entry.table,Object.fromEntries(columns[entry.table].map(k=>[k,k==="payload"?"":entry.metadata[names.indexOf(k)]])));
    const identity=JSON.stringify([entry.table,entry.metadata[0]]);if(seen.has(identity)||!objects.has(entry.object_sha256))throw Error("Duplicate/missing evidence identity/object");seen.add(identity);used.add(entry.object_sha256);
  }
  if(used.size!==objects.size)throw Error("Unreferenced evidence objects");
  for(const table of tables){const saved=sourceBody.storage.inventory.filter(t=>t.table===table);if(saved.length!==1||!Number.isSafeInteger(saved[0].rows)||saved[0].rows!==body.entries.filter(e=>e.table===table).length)throw Error("Incomplete source evidence population");}
  if(body.objects.reduce((n,o)=>n+o.gzip_bytes,0)>MAX_TOTAL||body.entries.reduce((n,e)=>n+objects.get(e.object_sha256).bytes,0)>MAX_TOTAL)throw Error("Evidence catalog byte bound exceeded");
  return value;
}
async function catalog(directory,pin){
  const folder=await privatePath(directory);if(!(await lstat(folder)).isDirectory())throw Error("Evidence catalog directory required");
  const file=await regular(path.join(folder,FILE),MAX_MANIFEST),value=JSON.parse(await readFile(file.file,"utf8"));validateManifest(value,pin);
  if(!(await lstat(await privatePath(path.join(folder,"objects")))).isDirectory())throw Error("Object directory required");return {folder,value};
}
async function decode(folder,object){
  const file=await regular(path.join(folder,"objects",object.sha256+".gz"),object.gzip_bytes);if(file.bytes!==object.gzip_bytes)throw Error("Evidence compressed size mismatch");
  const compressed=await readFile(file.file);if(sha(compressed)!==object.gzip_sha256)throw Error("Evidence compressed checksum mismatch");
  const raw=gunzipSync(compressed,{maxOutputLength:Math.max(1,object.bytes)});if(raw.length!==object.bytes||sha(raw)!==object.sha256)throw Error("Evidence raw checksum/size mismatch");
  return exactText(raw);
}
export function objectSummary(m){const byHash=new Map(m.objects.map(o=>[o.sha256,o]));return {catalog_manifest_sha256:m.catalog_manifest_sha256,source_manifest_sha256:m.source_manifest_sha256,
  rows:m.entries.length,objects:m.objects.length,duplicate_payload_references:m.entries.length-m.objects.length,raw_payload_bytes:m.entries.reduce((n,e)=>n+byHash.get(e.object_sha256).bytes,0),
  unique_payload_bytes:m.objects.reduce((n,o)=>n+o.bytes,0),compressed_object_bytes:m.objects.reduce((n,o)=>n+o.gzip_bytes,0),encrypted:false,full_database_archive:false,runtime_activated:false,network_requests:0,action_authority:false};}

export async function packEvidenceObjects(directory,sourcePin,target){
  const sourceDirectory=await privatePath(directory),sourceFile=await regular(path.join(sourceDirectory,"discovery.sqlite"),MAX_TOTAL),source=await verifyArchive(sourceDirectory,sourcePin);
  const db=new DatabaseSync(sourceFile.file,{readOnly:true}),objects=new Map(),entries=[];let output;
  const deadline=performance.now()+300000;
  try{
    db.exec("PRAGMA query_only=ON; BEGIN");let total=0,rows=0;
    for(const table of tables){const schema=db.prepare(`PRAGMA table_info(${table})`).all();if(schema.map(c=>c.name).join("|")!==columns[table].join("|")||schema.some(c=>c.type.toUpperCase()!==(c.name==="slot"?"INTEGER":"TEXT")))throw Error("Unsupported evidence table layout");
      const invalid=columns[table].map(k=>`typeof(${k})<>'${k==="slot"?"integer":"text"}'`).join(" OR ");if(db.prepare(`SELECT 1 FROM ${table} WHERE ${invalid} LIMIT 1`).get())throw Error("Unsupported evidence storage types");
      const size=db.prepare(`SELECT count(*) AS n,sum(length(CAST(payload AS BLOB))) AS bytes,max(length(CAST(payload AS BLOB))) AS maximum FROM ${table}`).get();
      rows+=size.n;total+=size.bytes??0;if(rows>10000||total>MAX_TOTAL||(size.maximum??0)>OBJECT_MAX_BYTES)throw Error("Source evidence exceeds offline bounds");}
    output=await privatePath(target,true);await mkdir(output,{mode:0o700});await mkdir(path.join(output,"objects"),{mode:0o700});
    // Read every TEXT field as bytes: Node SQLite's ordinary text conversion
    // can truncate embedded NULs. Preserve complete valid UTF-8, including BOMs.
    for(const table of tables)for(const saved of db.prepare(`SELECT ${columns[table].map(k=>k==="slot"?k:`CAST(${k} AS BLOB) AS ${k}`).join(",")} FROM ${table} ORDER BY payload_hash`).iterate()){
      if(performance.now()>deadline)throw Error("Evidence packing deadline exceeded; partial output retained");
      const row=Object.fromEntries(columns[table].map(k=>[k,k==="slot"?saved[k]:exactText(saved[k])])),metadata=metadataFor(table,row),raw=Buffer.from(saved.payload);
      const hash=sha(raw);if(!objects.has(hash)){const compressed=gzipSync(raw,{level:6}),object={sha256:hash,bytes:raw.length,gzip_bytes:compressed.length,gzip_sha256:sha(compressed)};ObjectDescriptor.parse(object);
        await writeFile(path.join(output,"objects",hash+".gz"),compressed,{flag:"wx",mode:0o600});objects.set(hash,object);}
      entries.push({table,metadata,object_sha256:hash,row_sha256:digest(row)});
    }
  }finally{db.close();}
  if(await hashFile(sourceFile.file)!==source.database.sha256)throw Error("Source archive changed during extraction");
  const body={version:VERSION,confidentiality:"private_holder_wallet_evidence_subset",codec:"gzip",encrypted:false,source_manifest_sha256:sourcePin,source_manifest:source,objects:[...objects.values()],entries};
  const manifest={...body,catalog_manifest_sha256:digest(body)};validateManifest(manifest,manifest.catalog_manifest_sha256);
  // Reconstruct every original row BEFORE writing the final completion marker.
  const grouped=new Map([...objects.keys()].map(hash=>[hash,entries.filter(e=>e.object_sha256===hash)]));
  for(const [hash,group]of grouped){if(performance.now()>deadline)throw Error("Evidence verification deadline exceeded");const payload=await decode(output,objects.get(hash));for(const entry of group)rowFor(entry,payload);}
  const serialized=JSON.stringify(manifest,null,2)+"\n";if(Buffer.byteLength(serialized)>MAX_MANIFEST)throw Error("Evidence catalog manifest exceeds offline bound");
  await writeFile(path.join(output,FILE),serialized,{flag:"wx",mode:0o600});return manifest;
}
export async function verifyEvidenceObjects(directory,pin){
  const {folder,value}=await catalog(directory,pin),deadline=performance.now()+300000;
  const groups=new Map(value.objects.map(o=>[o.sha256,[]]));for(const entry of value.entries)groups.get(entry.object_sha256).push(entry);
  for(const object of value.objects){if(performance.now()>deadline)throw Error("Evidence verification deadline exceeded");const payload=await decode(folder,object);for(const entry of groups.get(object.sha256))rowFor(entry,payload);}
  return value;
}
export async function readEvidenceObjectRow(directory,pin,table,key){
  const {folder,value}=await catalog(directory,pin),entry=value.entries.find(e=>e.table===table&&e.metadata[0]===key);if(!entry)throw Error("Evidence row not in pinned catalog");
  const object=value.objects.find(o=>o.sha256===entry.object_sha256),payload=await decode(folder,object);
  return {version:VERSION,catalog_manifest_sha256:pin,source_manifest_sha256:value.source_manifest_sha256,table,row:rowFor(entry,payload),row_sha256:entry.row_sha256,
    objects_read:1,compressed_bytes_read:object.gzip_bytes,raw_bytes:object.bytes,other_objects_verified:false,action_authority:false,runtime_activated:false};
}
async function main([action,...args]){
  if(action==="pack"&&args.length===3)return objectSummary(await packEvidenceObjects(...args));
  if(action==="verify"&&args.length===2)return {...objectSummary(await verifyEvidenceObjects(...args)),all_catalog_rows_verified:true};
  if(action==="lookup"&&args.length===5){if(!args[4].endsWith(".json"))throw Error("New private JSON output required");const row=await readEvidenceObjectRow(...args.slice(0,4)),file=await privatePath(args[4],true),text=JSON.stringify(row,null,2)+"\n";
    await writeFile(file,text,{flag:"wx",mode:0o600});return {file_sha256:sha(text),objects_read:1,compressed_bytes_read:row.compressed_bytes_read,raw_bytes:row.raw_bytes,other_objects_verified:false,action_authority:false,runtime_activated:false};}
  throw Error("Usage: pack ARCHIVE SOURCE_PIN NEW_PRIVATE_DIRECTORY | verify DIRECTORY CATALOG_PIN | lookup DIRECTORY CATALOG_PIN TABLE PAYLOAD_HASH NEW_PRIVATE_JSON");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
