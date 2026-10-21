// Offline only. Encrypts a verified frozen evidence subset, never a live store.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {lstat,mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {
  evidencePrivatePath,evidenceRegularFile,readEvidenceCatalog,validateEvidenceCatalog,
  restoreEvidenceRow,decodeEvidenceBytes,verifyEvidenceObjects,
} from "./discovery-evidence-objects.mjs";

const VERSION="discovery-evidence-sealed-v1",CIPHER="aes-256-gcm";
const MAX_CATALOG=20*1024**2,MAX_OBJECT=2100000,MAX_TOTAL=2*1024**3;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const digest=value=>sha(JSON.stringify(value));
const Hash=z.string().length(64).regex(/^[a-f0-9]{64}$/);
const Descriptor=z.object({sha256:Hash,bytes:z.number().int().positive().max(MAX_CATALOG),
  iv:z.string().length(24).regex(/^[a-f0-9]{24}$/),tag:z.string().length(32).regex(/^[a-f0-9]{32}$/)}).strict();
const Outer=z.object({version:z.literal(VERSION),cipher:z.literal(CIPHER),catalog:Descriptor}).strict();
const Inner=z.object({source_catalog:z.unknown(),objects:z.object({raw_sha256:Hash,sealed:Descriptor}).strict().array().max(10000)}).strict();
const contained=(folder,file)=>file===folder||file.startsWith(folder+path.sep);
const aad=identity=>Buffer.from(`${VERSION}|${identity}`,"utf8");

function encrypt(bytes,key,identity,nonces){
  let iv;
  do{iv=randomBytes(12);}while(nonces.has(iv.toString("hex")));
  nonces.add(iv.toString("hex"));
  const cipher=createCipheriv(CIPHER,key,iv,{authTagLength:16});
  cipher.setAAD(aad(identity));
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return {ciphertext,descriptor:{sha256:sha(ciphertext),bytes:ciphertext.length,iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex")}};
}

function decrypt(ciphertext,descriptor,key,identity){
  if(ciphertext.length!==descriptor.bytes||sha(ciphertext)!==descriptor.sha256)throw Error("Encrypted evidence size/checksum mismatch");
  const decipher=createDecipheriv(CIPHER,key,Buffer.from(descriptor.iv,"hex"),{authTagLength:16});
  decipher.setAAD(aad(identity));
  decipher.setAuthTag(Buffer.from(descriptor.tag,"hex"));
  // Nothing is returned or written unless authentication succeeds at final().
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]);
}

async function keyAt(file,folder){
  const info=await evidenceRegularFile(file,32);
  if(info.bytes!==32||contained(folder,info.file))throw Error("A separate exact 32-byte evidence key is required");
  const key=await readFile(info.file);
  if(key.length!==32){key.fill(0);throw Error("Evidence key length changed");}
  return key;
}

export async function createEvidenceKey(file){
  const target=await evidencePrivatePath(file,true),key=randomBytes(32);
  try{await writeFile(target,key,{flag:"wx",mode:0o600});}finally{key.fill(0);}
  return {key_created:true,key_bytes:32,key_printed:false,network_requests:0,runtime_activated:false};
}

async function ciphertextAt(file,descriptor,maximum){
  const info=await evidenceRegularFile(file,maximum);
  if(info.bytes!==descriptor.bytes)throw Error("Encrypted evidence size mismatch");
  return readFile(info.file);
}

function validateInner(value){
  Inner.parse(value);
  const source=value.source_catalog;
  validateEvidenceCatalog(source,source?.catalog_manifest_sha256);
  if(Buffer.byteLength(JSON.stringify(source))>16*1024**2)throw Error("Source catalog exceeds offline bound");
  const byRaw=new Map(),nonces=new Set(),cipherHashes=new Set();
  for(const item of value.objects){
    if(byRaw.has(item.raw_sha256)||nonces.has(item.sealed.iv)||cipherHashes.has(item.sealed.sha256)||item.sealed.bytes>MAX_OBJECT)throw Error("Duplicate or oversized encrypted object");
    byRaw.set(item.raw_sha256,item.sealed);nonces.add(item.sealed.iv);cipherHashes.add(item.sealed.sha256);
  }
  if(byRaw.size!==source.objects.length||value.objects.reduce((n,o)=>n+o.sealed.bytes,0)>MAX_TOTAL)throw Error("Incomplete or oversized encrypted population");
  for(const object of source.objects){
    if(byRaw.get(object.sha256)?.bytes!==object.gzip_bytes)throw Error("Encrypted object does not match source");
  }
  return {source,byRaw,nonces};
}

export async function readSealedEnvelope(directory,pin){
  const folder=await evidencePrivatePath(directory);
  if(!(await lstat(folder)).isDirectory())throw Error("Encrypted evidence directory required");
  const file=await evidenceRegularFile(path.join(folder,"sealed.json"),4096);
  const value=JSON.parse(await readFile(file.file,"utf8")),{sealed_manifest_sha256,...body}=value;
  if(!/^[a-f0-9]{64}$/.test(pin??"")||sealed_manifest_sha256!==pin||digest(body)!==pin)throw Error("Encrypted evidence manifest checksum mismatch");
  Outer.parse(body);
  if(!(await lstat(await evidencePrivatePath(path.join(folder,"objects")))).isDirectory())throw Error("Encrypted object directory required");
  return {folder,value};
}

async function openCatalog(directory,pin,keyFile){
  const {folder,value}=await readSealedEnvelope(directory,pin),body=value;
  const key=await keyAt(keyFile,folder);
  try{
    const bytes=decrypt(await ciphertextAt(path.join(folder,"catalog.bin"),body.catalog,MAX_CATALOG),body.catalog,key,"catalog");
    const inner=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)),verified=validateInner(inner);
    if(verified.nonces.has(body.catalog.iv))throw Error("Catalog/object nonce reuse");
    return {folder,key,value,inner,...verified};
  }catch(error){key.fill(0);throw error;}
}

// Private offline index construction only; never exports the encryption key.
export async function readSealedIndexMaterial(directory,pin,keyFile){
  const open=await openCatalog(directory,pin,keyFile);
  try{return {source_catalog:open.source,objects:open.inner.objects};}
  finally{open.key.fill(0);}
}
export {decrypt as decryptEvidenceCiphertext};

async function payloadAt(open,object){
  const descriptor=open.byRaw.get(object.sha256);
  const bytes=await ciphertextAt(path.join(open.folder,"objects",descriptor.sha256+".bin"),descriptor,MAX_OBJECT);
  return decodeEvidenceBytes(decrypt(bytes,descriptor,open.key,"object|"+object.sha256),object);
}

async function verifyRows(open){
  const deadline=performance.now()+300000,groups=new Map(open.source.objects.map(o=>[o.sha256,[]]));
  for(const entry of open.source.entries)groups.get(entry.object_sha256).push(entry);
  for(const object of open.source.objects){
    if(performance.now()>deadline)throw Error("Encrypted evidence verification deadline exceeded");
    const payload=await payloadAt(open,object);
    for(const entry of groups.get(object.sha256))restoreEvidenceRow(entry,payload);
  }
}

export async function sealEvidenceObjects(directory,sourcePin,keyFile,target){
  const folder=await evidencePrivatePath(directory),output=await evidencePrivatePath(target,true);
  if(contained(folder,output)||contained(output,folder))throw Error("Encrypted destination must be separate from source");
  const key=await keyAt(keyFile,output);
  try{
    const source=await verifyEvidenceObjects(folder,sourcePin),nonces=new Set(),objects=[],deadline=performance.now()+300000;
    await mkdir(output,{mode:0o700});await mkdir(path.join(output,"objects"),{mode:0o700});
    for(const object of source.objects){
      if(performance.now()>deadline)throw Error("Evidence encryption deadline exceeded; partial output retained");
      const file=await evidenceRegularFile(path.join(folder,"objects",object.sha256+".gz"),MAX_OBJECT),bytes=await readFile(file.file);
      // Recheck each source on the actual encryption read, after full verification.
      decodeEvidenceBytes(bytes,object);
      const sealed=encrypt(bytes,key,"object|"+object.sha256,nonces);
      await writeFile(path.join(output,"objects",sealed.descriptor.sha256+".bin"),sealed.ciphertext,{flag:"wx",mode:0o600});
      objects.push({raw_sha256:object.sha256,sealed:sealed.descriptor});
    }
    // Detect catalog changes too; all output still binds the original retained pin.
    await readEvidenceCatalog(folder,sourcePin);
    const inner={source_catalog:source,objects},verified=validateInner(inner),raw=Buffer.from(JSON.stringify(inner));
    if(raw.length>MAX_CATALOG)throw Error("Encrypted catalog exceeds offline bound");
    const catalog=encrypt(raw,key,"catalog",nonces);
    await writeFile(path.join(output,"catalog.bin"),catalog.ciphertext,{flag:"wx",mode:0o600});
    // Authenticate the actual saved catalog and every object before completion.
    const saved=decrypt(await ciphertextAt(path.join(output,"catalog.bin"),catalog.descriptor,MAX_CATALOG),catalog.descriptor,key,"catalog");
    if(!saved.equals(raw))throw Error("Encrypted catalog round-trip mismatch");
    await verifyRows({folder:output,key,...verified});
    const body={version:VERSION,cipher:CIPHER,catalog:catalog.descriptor},manifest={...body,sealed_manifest_sha256:digest(body)};
    await writeFile(path.join(output,"sealed.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    return {sealed_manifest_sha256:manifest.sealed_manifest_sha256,source_catalog_manifest_sha256:sourcePin,rows:source.entries.length,objects:objects.length,
      encrypted_object_bytes:objects.reduce((n,o)=>n+o.sealed.bytes,0),encrypted_catalog_bytes:catalog.ciphertext.length,
      encrypted:true,all_catalog_rows_verified:true,key_in_pack:false,network_requests:0,runtime_activated:false,action_authority:false};
  }finally{key.fill(0);}
}

export async function verifySealedEvidence(directory,pin,keyFile){
  const open=await openCatalog(directory,pin,keyFile);
  try{await verifyRows(open);return {sealed_manifest_sha256:pin,source_catalog_manifest_sha256:open.source.catalog_manifest_sha256,
    rows:open.source.entries.length,objects:open.source.objects.length,encrypted:true,all_catalog_rows_verified:true,network_requests:0,runtime_activated:false,action_authority:false};}
  finally{open.key.fill(0);}
}

export async function readSealedEvidenceRow(directory,pin,keyFile,table,identity){
  const open=await openCatalog(directory,pin,keyFile);
  try{
    const entry=open.source.entries.find(e=>e.table===table&&e.metadata[0]===identity);
    if(!entry)throw Error("Evidence row not in encrypted catalog");
    const object=open.source.objects.find(o=>o.sha256===entry.object_sha256),payload=await payloadAt(open,object);
    return {sealed_manifest_sha256:pin,catalog_manifest_sha256:open.source.catalog_manifest_sha256,source_manifest_sha256:open.source.source_manifest_sha256,
      table,row:restoreEvidenceRow(entry,payload),row_sha256:entry.row_sha256,objects_read:1,encrypted_catalog_bytes_read:open.value.catalog.bytes,
      encrypted_object_bytes_read:object.gzip_bytes,other_objects_verified:false,action_authority:false,runtime_activated:false};
  }finally{open.key.fill(0);}
}

async function main([action,...args]){
  if(action==="key"&&args.length===1)return createEvidenceKey(args[0]);
  if(action==="seal"&&args.length===4)return sealEvidenceObjects(...args);
  if(action==="verify"&&args.length===3)return verifySealedEvidence(...args);
  if(action==="lookup"&&args.length===6){
    const output=await evidencePrivatePath(args[5],true),folder=await evidencePrivatePath(args[0]);
    if(!output.endsWith(".json")||contained(folder,output))throw Error("Separate new private JSON output required");
    const row=await readSealedEvidenceRow(...args.slice(0,5)),text=JSON.stringify(row,null,2)+"\n";
    await writeFile(output,text,{flag:"wx",mode:0o600});
    return {file_sha256:sha(text),objects_read:1,other_objects_verified:false,plaintext_export:true,network_requests:0,runtime_activated:false,action_authority:false};
  }
  throw Error("Usage: key NEW_PRIVATE_KEY | seal SOURCE SOURCE_PIN KEY NEW_DIRECTORY | verify DIRECTORY PIN KEY | lookup DIRECTORY PIN KEY TABLE PAYLOAD_HASH NEW_PRIVATE_JSON");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2))
  .then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(()=>{console.error("Encrypted evidence operation failed; no runtime activated. Check private paths, retained pins, separate key and input integrity.");process.exitCode=1;});
