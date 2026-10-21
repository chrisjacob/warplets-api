// Offline encrypted metadata recovery. No application binding or live adoption.
import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {lstat,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {Transform,Writable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createGzip,createGunzip} from "node:zlib";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {hashFile} from "./discovery-archive.mjs";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {readSealedEnvelope,verifySealedKeyBytes} from "./discovery-evidence-sealed.mjs";

const VERSION="discovery-metadata-sealed-v1",FILE="metadata-sealed.json",MAX=2*1024**3,EXTRA=1024**2;
const roles=["capacity_manifest","capacity_database","reference_manifest","reference_database"];
const layout={capacity_manifest:["capacity","capacity.json",1024**2],capacity_database:["capacity","capacity.sqlite",MAX],reference_manifest:["references","references.json",4096],reference_database:["references","references.sqlite",64*1024**2]};
const sha=b=>createHash("sha256").update(b).digest("hex"),digest=v=>sha(JSON.stringify(v));
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Count=z.number().int().positive().max(MAX+EXTRA),Size=z.object({bytes:Count,sha256:Hash}).strict();
const Context=z.object({version:z.literal(VERSION),capacity_manifest_sha256:Hash,reference_manifest_sha256:Hash,source_archive_manifest_sha256:Hash,source_sealed_manifest_sha256:Hash}).strict();
const Body=z.object({context:Context,cipher:z.literal("aes-256-gcm"),codec:z.literal("gzip"),kdf:z.literal("hkdf-sha256"),salt:z.string().regex(/^[a-f0-9]{64}$/),
  files:z.array(z.object({role:z.enum(roles),raw:Size,gzip:Size,encrypted:Size,iv:z.string().regex(/^[a-f0-9]{24}$/),tag:z.string().regex(/^[a-f0-9]{32}$/)}).strict()).length(4)}).strict();
const inside=(a,b)=>a===b||b.startsWith(a+path.sep),sink=()=>new Writable({write(_b,_e,done){done();}});
async function separate(file){
  const root=await realpath(".tmp");
  for(let parent=path.dirname(file);inside(root,parent);parent=path.dirname(parent)){
    for(const marker of ["manifest.json","pack.json","objects.json","sealed.json","index.json","references.json","capacity.json","replay.json","key-backup.json","wrapping.json","restore.json",FILE,"metadata-restored.json"]){
      try{await lstat(path.join(parent,marker));}catch(e){if(e.code==="ENOENT")continue;throw e;}throw Error("Separate new metadata recovery directory required");
    }if(parent===root)break;
  }
}
function meter(maximum){
  const hash=createHash("sha256");let bytes=0;
  return {stream:new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;if(bytes>maximum)return done(Error("Metadata stream byte bound exceeded"));hash.update(chunk);done(null,chunk);}}),result:()=>({bytes,sha256:hash.digest("hex")})};
}
function check(actual,expected){if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw Error("Metadata checksum/size mismatch");}
function info(context,role){return Buffer.from(VERSION+"|"+digest(context)+"|"+role);}
function derive(root,salt,context,role){return Buffer.from(hkdfSync("sha256",root,Buffer.from(salt,"hex"),info(context,role),32));}
async function rootKey(file,sealed,pin,forbidden){
  const saved=await evidenceRegularFile(file,32);if(saved.bytes!==32||forbidden.some(f=>inside(f,saved.file)))throw Error("Separate exact evidence root key required");
  const key=await readFile(saved.file);
  try{if(key.length!==32)throw Error("Evidence root key size changed");await verifySealedKeyBytes(sealed,pin,key);return key;}catch(e){key.fill(0);throw e;}
}
function validate(value,pin){
  const {metadata_sealed_manifest_sha256,...body}=value??{};
  if(!/^[a-f0-9]{64}$/.test(pin??"")||metadata_sealed_manifest_sha256!==pin||digest(body)!==pin)throw Error("Retained metadata pack pin mismatch");Body.parse(body);
  if(body.files.some((f,i)=>f.role!==roles[i]||f.raw.bytes>layout[f.role][2]||f.gzip.bytes>f.raw.bytes+EXTRA||f.encrypted.bytes!==f.gzip.bytes)||new Set(body.files.map(f=>f.iv)).size!==4||body.files.reduce((n,f)=>n+f.raw.bytes,0)>MAX)throw Error("Metadata pack role/size bounds");
  return value;
}
async function opened(directory,pin){
  const folder=await evidencePrivatePath(directory),saved=await evidenceRegularFile(path.join(folder,FILE),8192),manifest=validate(JSON.parse(await readFile(saved.file,"utf8")),pin);
  return {folder,manifest};
}
async function decryptFile(folder,file,manifest,key,destination){
  const input=await evidenceRegularFile(path.join(folder,file.role+".bin"),file.encrypted.bytes);if(input.bytes!==file.encrypted.bytes)throw Error("Encrypted metadata size mismatch");
  const derived=derive(key,manifest.salt,manifest.context,file.role);
  try{
    const cipher=createDecipheriv("aes-256-gcm",derived,Buffer.from(file.iv,"hex"),{authTagLength:16});cipher.setAAD(info(manifest.context,file.role));cipher.setAuthTag(Buffer.from(file.tag,"hex"));
    const encrypted=meter(file.encrypted.bytes),compressed=meter(file.gzip.bytes);
    await pipeline(createReadStream(input.file),encrypted.stream,cipher,compressed.stream,destination,{signal:AbortSignal.timeout(120000)});
    check(encrypted.result(),file.encrypted);check(compressed.result(),file.gzip);
  }finally{derived.fill(0);}
}
export async function packSealedMetadata(capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile,target){
  const capacity=await evidencePrivatePath(capacityDirectory),references=await evidencePrivatePath(referenceDirectory),sealed=await evidencePrivatePath(sealedDirectory),output=await evidencePrivatePath(target,true);await separate(output);
  const keyPath=await evidencePrivatePath(keyFile);if([capacity,references,sealed,path.dirname(keyPath)].some(f=>inside(f,output)||inside(output,f)))throw Error("Separate metadata pack output required");
  return withScratchEvidenceResolver({capacityDirectory:capacity,capacityPin,referenceDirectory:references,referencePin,sealedDirectory:sealed,keyFile:keyPath},async reader=>{
    const refManifest=JSON.parse(await readFile(path.join(references,"references.json"),"utf8")),context=Context.parse({version:VERSION,capacity_manifest_sha256:capacityPin,reference_manifest_sha256:referencePin,source_archive_manifest_sha256:reader.capacity.source_archive_manifest_sha256,source_sealed_manifest_sha256:refManifest.context.source_sealed_manifest_sha256});
    const key=await rootKey(keyPath,sealed,context.source_sealed_manifest_sha256,[capacity,references,sealed,output]);
    try{
      const sources=[];for(const role of roles){const [folder,name,bound]=layout[role],saved=await evidenceRegularFile(path.join(folder==="capacity"?capacity:references,name),bound);sources.push({role,file:saved.file,raw:{bytes:saved.bytes,sha256:await hashFile(saved.file)}});}
      if(sources.reduce((n,s)=>n+s.raw.bytes,0)>MAX)throw Error("Metadata total raw bound");
      await mkdir(output,{mode:0o700});const salt=randomBytes(32).toString("hex"),files=[],nonces=new Set();
      for(const source of sources){
        const derived=derive(key,salt,context,source.role);let iv;do{iv=randomBytes(12);}while(nonces.has(iv.toString("hex")));nonces.add(iv.toString("hex"));
        try{
          const cipher=createCipheriv("aes-256-gcm",derived,iv,{authTagLength:16});cipher.setAAD(info(context,source.role));const raw=meter(source.raw.bytes),compressed=meter(source.raw.bytes+EXTRA),encrypted=meter(source.raw.bytes+EXTRA);
          await pipeline(createReadStream(source.file),raw.stream,createGzip({level:6}),compressed.stream,cipher,encrypted.stream,createWriteStream(path.join(output,source.role+".bin"),{flags:"wx",mode:0o600}),{signal:AbortSignal.timeout(120000)});
          check(raw.result(),source.raw);files.push({role:source.role,raw:source.raw,gzip:compressed.result(),encrypted:encrypted.result(),iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex")});
        }finally{derived.fill(0);}
      }
      const body={context,cipher:"aes-256-gcm",codec:"gzip",kdf:"hkdf-sha256",salt,files},manifest={...body,metadata_sealed_manifest_sha256:digest(body)};validate(manifest,manifest.metadata_sealed_manifest_sha256);
      // Authenticate each actual saved file before publishing the completion manifest.
      for(const file of files)await decryptFile(output,file,manifest,key,sink());
      for(const s of sources)if(await hashFile(s.file)!==s.raw.sha256)throw Error("Metadata source changed during packing");
      return {manifest,output};
    }finally{key.fill(0);}
  }).then(async result=>{
    // The complete resolver session's final pin checks precede completion publication.
    const {manifest,output}=result.value;await writeFile(path.join(output,FILE),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    return {metadata_sealed_manifest_sha256:manifest.metadata_sealed_manifest_sha256,files:4,raw_bytes:manifest.files.reduce((n,f)=>n+f.raw.bytes,0),encrypted_bytes:manifest.files.reduce((n,f)=>n+f.encrypted.bytes,0),runtime_activated:false,network_requests:0};
  });
}
export async function restoreSealedMetadata(directory,pin,sealedDirectory,keyFile,target){
  const {folder,manifest}=await opened(directory,pin),sealed=await evidencePrivatePath(sealedDirectory),output=await evidencePrivatePath(target,true);await separate(output);
  const keyPath=await evidencePrivatePath(keyFile);if([folder,sealed,path.dirname(keyPath)].some(f=>inside(f,output)||inside(output,f)))throw Error("Separate metadata restore output required");
  const key=await rootKey(keyPath,sealed,manifest.context.source_sealed_manifest_sha256,[folder,sealed,output]);
  try{
    await mkdir(output,{mode:0o700});const quarantine=path.join(output,"quarantine");await mkdir(quarantine,{mode:0o700});
    // No restored SQLite/JSON is materialized until ALL four compressed streams authenticate.
    for(const file of manifest.files)await decryptFile(folder,file,manifest,key,createWriteStream(path.join(quarantine,file.role+".gz"),{flags:"wx",mode:0o600}));
    await mkdir(path.join(output,"capacity"),{mode:0o700});await mkdir(path.join(output,"references"),{mode:0o700});
    for(const file of manifest.files){
      const compressed=meter(file.gzip.bytes),raw=meter(file.raw.bytes),[sub,name]=layout[file.role];
      await pipeline(createReadStream(path.join(quarantine,file.role+".gz")),compressed.stream,createGunzip(),raw.stream,createWriteStream(path.join(output,sub,name),{flags:"wx",mode:0o600}),{signal:AbortSignal.timeout(120000)});check(compressed.result(),file.gzip);check(raw.result(),file.raw);
    }
    const result=await withScratchEvidenceResolver({capacityDirectory:path.join(output,"capacity"),capacityPin:manifest.context.capacity_manifest_sha256,referenceDirectory:path.join(output,"references"),referencePin:manifest.context.reference_manifest_sha256,sealedDirectory:sealed,keyFile:keyPath},async reader=>{
      if(reader.capacity.source_archive_manifest_sha256!==manifest.context.source_archive_manifest_sha256)throw Error("Restored metadata source context mismatch");
      return {tables:reader.capacity.inventory.length,rows:reader.capacity.inventory.reduce((n,t)=>n+t.rows,0)};
    });
    await opened(folder,pin);for(const file of manifest.files)if(await hashFile(path.join(folder,file.role+".bin"))!==file.encrypted.sha256)throw Error("Encrypted metadata changed during restore");
    await readSealedEnvelope(sealed,manifest.context.source_sealed_manifest_sha256);
    const receipt={version:"discovery-metadata-restore-v1",metadata_sealed_manifest_sha256:pin,context:manifest.context,...result.value,all_four_file_hashes_preserved:true,source_metadata_admitted:true,payload_objects_verified:false,quarantine_retained:true,off_device_recovery_accepted:false,runtime_activated:false,network_requests:0};
    await writeFile(path.join(output,"metadata-restored.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});return receipt;
  }finally{key.fill(0);}
}
async function main([action,...args]){
  if(action==="pack"&&args.length===7)return packSealedMetadata(...args);
  if(action==="restore"&&args.length===5)return restoreSealedMetadata(...args);
  throw Error("Usage: pack CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN SEALED KEY NEW_PRIVATE_PACK | restore PACK PACK_PIN SEALED KEY NEW_PRIVATE_SCRATCH");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error("Private encrypted metadata operation held; check independent pins, separate recovered key and complete source integrity. Partial outputs retained; no runtime activated.");process.exitCode=1;});
