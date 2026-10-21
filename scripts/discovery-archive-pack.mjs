import {createHash} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {lstat,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {Transform,Writable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createGzip,createGunzip} from "node:zlib";
import {fileURLToPath} from "node:url";
import {verifyArchive} from "./discovery-archive.mjs";

const VERSION="discovery-gzip-archive-v1",FILE="discovery.sqlite.gz",MANIFEST="pack.json";
// Offline scratch-tool bounds, not provider quotas or evidence admission.
export const PACK_MAX_BYTES=2*1024**3;
const hashPattern=/^[a-f0-9]{64}$/;
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

function sourceManifest(manifest){
  const {manifest_sha256,...body}=manifest??{};
  if(!hashPattern.test(manifest_sha256??"")||digest(body)!==manifest_sha256||body.version!=="discovery-local-archive-v1"||
    body.database?.file!=="discovery.sqlite"||!hashPattern.test(body.database?.sha256??"")||
    !Number.isSafeInteger(body.database?.bytes)||body.database.bytes<=0||body.database.bytes>PACK_MAX_BYTES)throw Error("Invalid or oversized source archive manifest");
  return manifest;
}
async function regularFile(file,maximum){
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size<=0||info.size>maximum)throw Error("Expected a bounded regular archive file, not a link");
  return info;
}
async function newDirectory(directory){
  const lexical=path.resolve(directory),parent=await realpath(path.dirname(lexical)),resolved=path.join(parent,path.basename(lexical));
  if([lexical,resolved].some(value=>value.split(/[\\/]/).some(part=>part.toLowerCase()===".wrangler")))throw Error("Pack/unpack destinations must be outside .wrangler");
  await mkdir(resolved,{mode:0o700});
  return resolved;
}
function meter(maximum){
  const hash=createHash("sha256");let bytes=0;
  const stream=new Transform({transform(chunk,_encoding,callback){
    bytes+=chunk.length;
    if(bytes>maximum)return callback(Error("Archive stream exceeds its byte bound"));
    hash.update(chunk);callback(null,chunk);
  }});
  return {stream,result:()=>({bytes,sha256:hash.digest("hex")})};
}
function check(actual,expected){
  if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw Error("Archive stream checksum/size mismatch");
}
async function readPack(directory,expectedHash){
  if(!hashPattern.test(expectedHash??""))throw Error("Provide the independently retained pack manifest SHA-256");
  const file=path.join(directory,MANIFEST);await regularFile(file,1024**2);
  const manifest=JSON.parse(await readFile(file,"utf8")),{pack_manifest_sha256,...body}=manifest;
  if(pack_manifest_sha256!==expectedHash||digest(body)!==expectedHash)throw Error("Pack manifest checksum mismatch");
  if(body.version!==VERSION||body.codec!=="gzip"||body.compressed?.file!==FILE||
    !Number.isSafeInteger(body.compressed?.bytes)||body.compressed.bytes<=0||body.compressed.bytes>PACK_MAX_BYTES||
    !hashPattern.test(body.compressed?.sha256??""))throw Error("Invalid compressed archive contract");
  const original=sourceManifest(body.source_manifest);
  if(original.manifest_sha256!==body.source_manifest_sha256)throw Error("Source manifest identity mismatch");
  if((await regularFile(path.join(directory,FILE),PACK_MAX_BYTES)).size!==body.compressed.bytes)throw Error("Compressed archive size mismatch");
  return manifest;
}
async function decode(directory,manifest,destination){
  const compressed=meter(manifest.compressed.bytes),raw=meter(manifest.source_manifest.database.bytes);
  await pipeline(createReadStream(path.join(directory,FILE)),compressed.stream,createGunzip(),raw.stream,
    destination??new Writable({write(_chunk,_encoding,callback){callback();}}),{signal:AbortSignal.timeout(120000)});
  check(compressed.result(),manifest.compressed);check(raw.result(),manifest.source_manifest.database);
}

export async function packArchive(directory,sourceHash,target){
  // Whole-file hash, SQLite integrity/FKs and complete inventory verify first.
  await regularFile(path.join(directory,"discovery.sqlite"),PACK_MAX_BYTES);
  const original=sourceManifest(await verifyArchive(directory,sourceHash));
  const output=await newDirectory(target),raw=meter(original.database.bytes),compressed=meter(PACK_MAX_BYTES);
  const started=new Date().toISOString();
  await pipeline(createReadStream(path.join(directory,"discovery.sqlite")),raw.stream,createGzip({level:6}),compressed.stream,
    createWriteStream(path.join(output,FILE),{flags:"wx",mode:0o600}),{signal:AbortSignal.timeout(120000)});
  check(raw.result(),original.database);
  const packed=compressed.result();
  const body={version:VERSION,codec:"gzip",confidentiality:"private_full_store_including_identity_sessions_and_research",
    packed_started_at:started,packed_completed_at:new Date().toISOString(),source_manifest_sha256:original.manifest_sha256,
    source_manifest:original,compressed:{file:FILE,...packed}};
  const manifest={...body,pack_manifest_sha256:digest(body)};
  // No completion marker until a complete, exact source stream was compressed.
  await writeFile(path.join(output,MANIFEST),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
  await verifyPack(output,manifest.pack_manifest_sha256);
  return manifest;
}
export async function verifyPack(directory,expectedHash){
  const manifest=await readPack(directory,expectedHash);
  await decode(directory,manifest);
  return manifest;
}
export async function unpackArchive(directory,expectedHash,target){
  const manifest=await verifyPack(directory,expectedHash),output=await newDirectory(target);
  // Recheck both streams while writing: input can change after verification.
  await decode(directory,manifest,createWriteStream(path.join(output,"discovery.sqlite"),{flags:"wx",mode:0o600}));
  await writeFile(path.join(output,"manifest.json"),JSON.stringify(manifest.source_manifest,null,2)+"\n",{flag:"wx",mode:0o600});
  await verifyArchive(output,manifest.source_manifest_sha256);
  return {directory:output,source_manifest_sha256:manifest.source_manifest_sha256,database_sha256:manifest.source_manifest.database.sha256,
    runtime_activated:false,network_requests:0};
}
function summary(manifest){
  return {pack_manifest_sha256:manifest.pack_manifest_sha256,source_manifest_sha256:manifest.source_manifest_sha256,
    database_sha256:manifest.source_manifest.database.sha256,raw_bytes:manifest.source_manifest.database.bytes,compressed_bytes:manifest.compressed.bytes,
    reduction_pct:Number((100*(1-manifest.compressed.bytes/manifest.source_manifest.database.bytes)).toFixed(2)),
    encrypted:false,network_requests:0,runtime_activated:false};
}
async function main(args){
  const [action,...values]=args;
  if(action==="pack"&&values.length===3)return summary(await packArchive(...values));
  if(action==="verify"&&values.length===2)return summary(await verifyPack(...values));
  if(action==="unpack"&&values.length===3)return unpackArchive(...values);
  throw Error("Usage: node scripts/discovery-archive-pack.mjs pack ARCHIVE_DIRECTORY SOURCE_MANIFEST_SHA256 NEW_PRIVATE_DIRECTORY | verify PACK_DIRECTORY PACK_MANIFEST_SHA256 | unpack PACK_DIRECTORY PACK_MANIFEST_SHA256 NEW_SCRATCH_DIRECTORY");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
  console.error(error.message);process.exitCode=1;
});
