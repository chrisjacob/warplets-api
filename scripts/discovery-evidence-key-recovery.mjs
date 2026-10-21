// Private offline key recovery. No wallet keys, application configuration or runtime adoption.
import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {lstat,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {verifySealedKeyBytes} from "./discovery-evidence-sealed.mjs";

const VERSION="discovery-evidence-key-backup-v1",WRAP_VERSION="discovery-evidence-wrapping-key-v1",FILE="key-backup.json";
const hash=v=>createHash("sha256").update(v).digest("hex"),digest=v=>hash(JSON.stringify(v));
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Body=z.object({version:z.literal(VERSION),cipher:z.literal("aes-256-gcm"),source_sealed_manifest_sha256:Hash,
  iv:z.string().regex(/^[a-f0-9]{24}$/),tag:z.string().regex(/^[a-f0-9]{32}$/),ciphertext:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const Wrap=z.object({version:z.literal(WRAP_VERSION),key_file:z.literal("key.bin"),key_bytes:z.literal(32),purpose:z.literal("evidence_key_backup_only")}).strict();
const inside=(a,b)=>a===b||b.startsWith(a+path.sep);
const markers=["manifest.json","pack.json","objects.json","sealed.json","index.json","references.json","capacity.json","replay.json",FILE,"wrapping.json","restore.json","metadata-sealed.json","metadata-restored.json"];
async function outsideArtifacts(file,forKey=false){
  const root=await realpath(".tmp");
  for(let parent=path.dirname(file);inside(root,parent);parent=path.dirname(parent)){
    for(const marker of markers){
      // A generated wrapping key and restored evidence key have their own private role receipts.
      if(forKey&&["wrapping.json","restore.json"].includes(marker)&&parent===path.dirname(file))continue;
      try{await lstat(path.join(parent,marker));}catch(e){if(e.code==="ENOENT")continue;throw e;}throw Error("Separate private key/recovery artifact required");
    }if(parent===root)break;
  }
}
async function keyAt(file){
  const info=await evidenceRegularFile(file,32);if(info.bytes!==32)throw Error("Exact private key file required");await outsideArtifacts(info.file,true);
  const key=await readFile(info.file);if(key.length!==32){key.fill(0);throw Error("Key size changed");}return {file:info.file,key};
}
async function wrappingAt(directory){
  const folder=await evidencePrivatePath(directory),info=await evidenceRegularFile(path.join(folder,"wrapping.json"),4096);
  Wrap.parse(JSON.parse(await readFile(info.file,"utf8")));const value=await keyAt(path.join(folder,"key.bin"));return {folder,...value};
}
async function envelope(directory,pin){
  const folder=await evidencePrivatePath(directory),info=await evidenceRegularFile(path.join(folder,FILE),4096),value=JSON.parse(await readFile(info.file,"utf8"));
  const {key_backup_manifest_sha256,...body}=value;
  if(!/^[a-f0-9]{64}$/.test(pin??"")||key_backup_manifest_sha256!==pin||digest(body)!==pin)throw Error("Retained key backup pin mismatch");Body.parse(body);return {folder,value};
}
const aad=pin=>Buffer.from(VERSION+"|evidence-key|"+pin);
function unwrap(value,wrapping){
  const decipher=createDecipheriv("aes-256-gcm",wrapping,Buffer.from(value.iv,"hex"),{authTagLength:16});decipher.setAAD(aad(value.source_sealed_manifest_sha256));decipher.setAuthTag(Buffer.from(value.tag,"hex"));
  // Do not retain unauthenticated output if final() rejects.
  const first=decipher.update(Buffer.from(value.ciphertext,"hex"));try{return Buffer.concat([first,decipher.final()]);}finally{first.fill(0);}
}
export async function createEvidenceWrappingKey(target){
  const output=await evidencePrivatePath(target,true);await outsideArtifacts(output);await mkdir(output,{mode:0o700});const key=randomBytes(32);
  try{
    await writeFile(path.join(output,"key.bin"),key,{flag:"wx",mode:0o600});
    await writeFile(path.join(output,"wrapping.json"),JSON.stringify(Wrap.parse({version:WRAP_VERSION,key_file:"key.bin",key_bytes:32,purpose:"evidence_key_backup_only"}),null,2)+"\n",{flag:"wx",mode:0o600});
  }finally{key.fill(0);}
  return {wrapping_key_created:true,key_bytes:32,key_printed:false,runtime_activated:false};
}
export async function protectEvidenceKey(sealedDirectory,sealedPin,keyFile,wrappingDirectory,target){
  const sealed=await evidencePrivatePath(sealedDirectory),output=await evidencePrivatePath(target,true);await outsideArtifacts(output);
  let original,wrapping;
  try{
    original=await keyAt(keyFile);wrapping=await wrappingAt(wrappingDirectory);
    if([sealed,path.dirname(original.file),wrapping.folder].some(f=>inside(f,output)||inside(output,f))||inside(path.dirname(original.file),wrapping.folder)||inside(wrapping.folder,path.dirname(original.file))||timingSafeEqual(original.key,wrapping.key))throw Error("Evidence and wrapping keys must remain separate");
    await verifySealedKeyBytes(sealed,sealedPin,original.key);
    const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",wrapping.key,iv,{authTagLength:16});cipher.setAAD(aad(sealedPin));
    const ciphertext=Buffer.concat([cipher.update(original.key),cipher.final()]),body=Body.parse({version:VERSION,cipher:"aes-256-gcm",source_sealed_manifest_sha256:sealedPin,iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex"),ciphertext:ciphertext.toString("hex")});
    const recovered=unwrap(body,wrapping.key);try{if(!timingSafeEqual(recovered,original.key))throw Error("Backup round trip failed");}finally{recovered.fill(0);}
    const manifest={...body,key_backup_manifest_sha256:digest(body)};await mkdir(output,{mode:0o700});await writeFile(path.join(output,FILE),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    return {key_backup_manifest_sha256:manifest.key_backup_manifest_sha256,source_sealed_manifest_sha256:sealedPin,encrypted_key_bytes:32,key_printed:false,network_requests:0,runtime_activated:false};
  }finally{original?.key.fill(0);wrapping?.key.fill(0);}
}
async function withRecovered(directory,pin,sealedDirectory,wrappingDirectory,work){
  const backup=await envelope(directory,pin),sealed=await evidencePrivatePath(sealedDirectory);let wrapping,key;
  try{
    wrapping=await wrappingAt(wrappingDirectory);
    if(inside(backup.folder,wrapping.file)||inside(sealed,wrapping.file))throw Error("Separate wrapping key required");
    key=unwrap(backup.value,wrapping.key);if(key.length!==32||timingSafeEqual(key,wrapping.key))throw Error("Invalid recovered evidence key");
    const proof=await verifySealedKeyBytes(sealed,backup.value.source_sealed_manifest_sha256,key);
    return await work({key,proof,backupFolder:backup.folder,sealedFolder:sealed,wrappingFolder:wrapping.folder});
  }finally{key?.fill(0);wrapping?.key.fill(0);}
}
export async function verifyEvidenceKeyBackup(directory,pin,sealedDirectory,wrappingDirectory){
  return withRecovered(directory,pin,sealedDirectory,wrappingDirectory,async({proof})=>({key_backup_manifest_sha256:pin,...proof,key_printed:false,network_requests:0,runtime_activated:false}));
}
export async function restoreEvidenceKey(directory,pin,sealedDirectory,wrappingDirectory,target){
  const output=await evidencePrivatePath(target,true);await outsideArtifacts(output);
  return withRecovered(directory,pin,sealedDirectory,wrappingDirectory,async({key,proof,backupFolder,sealedFolder,wrappingFolder})=>{
    if([backupFolder,sealedFolder,wrappingFolder].some(f=>inside(f,output)||inside(output,f)))throw Error("Separate new restored key directory required");
    // Authentication and complete original catalog admission precede plaintext output.
    await mkdir(output,{mode:0o700});await writeFile(path.join(output,"key.bin"),key,{flag:"wx",mode:0o600});
    const saved=await keyAt(path.join(output,"key.bin"));try{if(!timingSafeEqual(saved.key,key))throw Error("Restored key bytes changed");await verifySealedKeyBytes(sealedFolder,proof.sealed_manifest_sha256,saved.key);}finally{saved.key.fill(0);}
    const receipt={version:"discovery-evidence-key-restore-v1",key_backup_manifest_sha256:pin,...proof,key_bytes:32,key_restored:true,key_printed:false,network_requests:0,runtime_activated:false};
    await writeFile(path.join(output,"restore.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});return receipt;
  });
}
async function main([action,...args]){
  if(action==="generate"&&args.length===1)return createEvidenceWrappingKey(...args);
  if(action==="protect"&&args.length===5)return protectEvidenceKey(...args);
  if(action==="verify"&&args.length===4)return verifyEvidenceKeyBackup(...args);
  if(action==="restore"&&args.length===5)return restoreEvidenceKey(...args);
  throw Error("Usage: generate NEW_WRAPPING_DIRECTORY | protect SEALED SEALED_PIN EVIDENCE_KEY WRAPPING NEW_BACKUP_DIRECTORY | verify BACKUP BACKUP_PIN SEALED WRAPPING | restore BACKUP BACKUP_PIN SEALED WRAPPING NEW_KEY_DIRECTORY");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error("Private evidence key recovery held; check retained pins, separate private keys and authenticated catalog. Originals and partial artifacts retained; no runtime activated.");process.exitCode=1;});
