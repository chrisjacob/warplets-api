// Private offline staging only. No SQL publication, provider IO or runtime use.
import fs from "node:fs/promises";
import path from "node:path";
import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes,timingSafeEqual} from "node:crypto";
import {gzipSync} from "node:zlib";
import {z} from "zod";
import {evidencePrivatePath,evidenceRegularFile,decodeEvidenceBytes,restoreEvidenceRow} from "./discovery-evidence-objects.mjs";
import {canonicalEvidenceReference,EvidenceCipherDescriptor} from "./lib/evidence-reference-contract.mjs";

const VERSION="discovery-evidence-append-stage-v1",MAX_DESCRIPTOR=65536,MAX_CIPHER=2100000;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Id=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),Text=z.string().max(4096);
const Context=z.object({version:z.literal(VERSION),generation:Id,source_archive_pin:Hash,base_reference_pin:Hash,stage_salt:Hash}).strict();
const Holder=z.object({payload_hash:Hash,address:Text.min(1),slot:z.number().int().safe().nonnegative(),payload:z.string().max(2000000),observed_at:Text}).strict();
const Wallet=Holder.omit({slot:true});
const Ready=z.object({version:z.literal(VERSION),context_pin:Hash,stage_id:Id,descriptor:EvidenceCipherDescriptor}).strict();
const Ticket=z.object({context_pin:Hash,stage_id:Id,ticket_sha256:Hash}).strict();
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),digest=value=>sha(JSON.stringify(value));
const inside=(a,b)=>a===b||b.startsWith(a+path.sep);
const aad=(context,id,role)=>Buffer.from(JSON.stringify([VERSION,context,id,role]));
const derive=(key,context,id,role)=>Buffer.from(hkdfSync("sha256",key,Buffer.from(context,"hex"),aad(context,id,role),32));
const held=()=>({state:"staged",published:false,evidence_admitted:false,provider_requests:0,database_writes:0,runtime_activated:false,action_authority:false});

// Fixed-size reads remain bounded even if a private file grows after stat().
async function bounded(file,maximum){
  const info=await evidenceRegularFile(file,maximum),handle=await fs.open(info.file,"r");
  try{
    const bytes=Buffer.alloc(info.bytes+1);let offset=0,reads=0;
    while(offset<bytes.length){if(++reads>4096)throw Error("append_file_read_bound");const read=await handle.read(bytes,offset,bytes.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}
    if(offset!==info.bytes||(await handle.stat()).size!==info.bytes)throw Error("append_file_size_changed");return bytes.subarray(0,offset);
  }finally{await handle.close();}
}
async function exclusive(file,bytes){
  const handle=await fs.open(file,"wx",0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
async function keyAt(keyFile,folder){
  const key=await evidenceRegularFile(keyFile,32);if(key.bytes!==32||inside(folder,key.file))throw Error("append_separate_key_required");
  return bounded(key.file,32);
}
async function separate(folder){
  const root=await fs.realpath(".tmp");
  for(let parent=path.dirname(folder);inside(root,parent);parent=path.dirname(parent)){
    for(const marker of ["stage.json","sealed.json","objects.json","index.json","references.json","manifest.json","pack.json"]){
      try{await fs.lstat(path.join(parent,marker));}catch(e){if(e.code==="ENOENT")continue;throw e;}throw Error("append_target_nested_in_artifact");
    }
    if(parent===root)break;
  }
}
function seal(bytes,key,context,id,role){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv,{authTagLength:16});cipher.setAAD(aad(context,id,role));
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {ciphertext,descriptor:{sha256:sha(ciphertext),bytes:ciphertext.length,iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex")}};
}
function unseal(bytes,key,context,id,role,descriptor){
  if(bytes.length!==descriptor.bytes||sha(bytes)!==descriptor.sha256)throw Error("append_ciphertext_mismatch");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(descriptor.iv,"hex"),{authTagLength:16});decipher.setAAD(aad(context,id,role));decipher.setAuthTag(Buffer.from(descriptor.tag,"hex"));
  return Buffer.concat([decipher.update(bytes),decipher.final()]);
}
function rowInput(table,input){
  if(!["tenx_holder_evidence","tenx_wallet_evidence"].includes(table))throw Error("append_table_unsupported");
  const row=(table==="tenx_holder_evidence"?Holder:Wallet).parse(input),raw=Buffer.from(row.payload),maximum=table==="tenx_holder_evidence"?2000000:1800000;
  if(raw.length>maximum||new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw)!==row.payload)throw Error("append_payload_byte_bound");
  if(sha(raw)!==row.payload_hash)throw Error("append_payload_hash_mismatch");
  const body=JSON.parse(row.payload);
  if(table==="tenx_holder_evidence"?body?.mint!==row.address||body?.inventory?.context?.slot!==row.slot:body?.asset?.address!==row.address||body?.observed_at!==row.observed_at)throw Error("append_payload_identity_mismatch");
  for(const value of Object.values(row).filter(v=>typeof v==="string"))if(Buffer.from(value).toString("utf8")!==value)throw Error("append_text_not_exact_utf8");
  return {row,raw};
}
async function contextAt(options){
  Hash.parse(options.contextPin);const folder=await evidencePrivatePath(options.directory),key=await keyAt(options.keyFile,folder);
  try{
    const saved=JSON.parse((await bounded(path.join(folder,"stage.json"),4096)).toString("utf8")),{context_pin,key_mac,...body}=saved;
    Context.parse(body);Hash.parse(key_mac);
    if(context_pin!==options.contextPin||digest(body)!==context_pin)throw Error("append_context_pin_mismatch");
    const role=derive(key,context_pin,body.generation,"context");try{const expected=createHmac("sha256",role).update(JSON.stringify(body)).digest();if(!timingSafeEqual(expected,Buffer.from(key_mac,"hex")))throw Error("append_context_key_mismatch");}finally{role.fill(0);}
    return {folder,key,body,pin:context_pin};
  }catch(error){key.fill(0);throw error;}
}
export async function createEvidenceAppendStage({target,keyFile,generation,sourceArchivePin,baseReferencePin}){
  const body=Context.parse({version:VERSION,generation,source_archive_pin:sourceArchivePin,base_reference_pin:baseReferencePin,stage_salt:randomBytes(32).toString("hex")}),pin=digest(body),folder=await evidencePrivatePath(target,true);
  await separate(folder);const key=await keyAt(keyFile,folder),role=derive(key,pin,generation,"context");
  try{
    await fs.mkdir(folder,{mode:0o700});await fs.mkdir(path.join(folder,"pending"),{mode:0o700});
    const key_mac=createHmac("sha256",role).update(JSON.stringify(body)).digest("hex");await exclusive(path.join(folder,"stage.json"),Buffer.from(JSON.stringify({...body,context_pin:pin,key_mac})+"\n"));
    return {context_pin:pin,generation,...held()};
  }finally{key.fill(0);role.fill(0);}
}
async function verified(open,ticket){
  Ticket.parse(ticket);if(ticket.context_pin!==open.pin)throw Error("append_ticket_context_mismatch");
  const folder=await evidencePrivatePath(path.join(open.folder,"pending",ticket.stage_id)),bytes=await bounded(path.join(folder,"ready.json"),4096),ready=Ready.parse(JSON.parse(bytes.toString("utf8")));
  if(sha(bytes)!==ticket.ticket_sha256||ready.context_pin!==open.pin||ready.stage_id!==ticket.stage_id||ready.descriptor.bytes>MAX_DESCRIPTOR)throw Error("append_ready_mismatch");
  const descriptorKey=derive(open.key,open.pin,ticket.stage_id,"descriptor"),payloadKey=derive(open.key,open.pin,ticket.stage_id,"payload");let plain,compressed;
  try{
    plain=unseal(await bounded(path.join(folder,"descriptor.bin"),MAX_DESCRIPTOR),descriptorKey,open.pin,ticket.stage_id,"descriptor",ready.descriptor);
    const ref=canonicalEvidenceReference(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(plain)));
    compressed=unseal(await bounded(path.join(folder,"object.bin"),MAX_CIPHER),payloadKey,open.pin,ticket.stage_id,"payload",ref.sealed);
    const payload=decodeEvidenceBytes(compressed,ref.object),row=restoreEvidenceRow(ref.entry,payload);rowInput(ref.entry.table,row);
    return {table:ref.entry.table,row,ciphertext_bytes:ref.sealed.bytes+ready.descriptor.bytes};
  }finally{plain?.fill(0);compressed?.fill(0);descriptorKey.fill(0);payloadKey.fill(0);}
}
async function ticketAt(open,id){
  Id.parse(id);const folder=await evidencePrivatePath(path.join(open.folder,"pending",id)),bytes=await bounded(path.join(folder,"ready.json"),4096);
  return {context_pin:open.pin,stage_id:id,ticket_sha256:sha(bytes)};
}
export async function readStagedEvidenceAppend(options,ticket){
  const open=await contextAt(options);try{return {...await verified(open,ticket),...held()};}finally{open.key.fill(0);}
}
export async function stageEvidenceAppend(options,{stageId,table,row:input}){
  Id.parse(stageId);const {row,raw}=rowInput(table,input);let open,payloadKey,descriptorKey,compressed,descriptorPlain;
  try{
    open=await contextAt(options);
    // Check pending itself before using it as the parent of a fresh directory.
    await evidencePrivatePath(path.join(open.folder,"pending"));const folder=path.join(open.folder,"pending",stageId);
    try{await fs.mkdir(folder,{mode:0o700});}catch(error){
      if(error.code!=="EEXIST")throw error;const ticket=await ticketAt(open,stageId),prior=await verified(open,ticket);
      const {observed_at:ignored,...a}=prior.row,{observed_at:ignoredAgain,...b}=row;
      if(prior.table!==table||JSON.stringify(a)!==JSON.stringify(b)||(table==="tenx_wallet_evidence"&&prior.row.observed_at!==row.observed_at))throw Error("append_stage_identity_conflict");
      return {ticket,...held(),reused:true};
    }
    payloadKey=derive(open.key,open.pin,stageId,"payload");descriptorKey=derive(open.key,open.pin,stageId,"descriptor");compressed=gzipSync(raw);
    if(compressed.length>MAX_CIPHER)throw Error("append_compressed_byte_bound");
    const sealed=seal(compressed,payloadKey,open.pin,stageId,"payload"),metadata=table==="tenx_holder_evidence"?[row.payload_hash,row.address,row.slot,row.observed_at]:[row.payload_hash,row.address,row.observed_at];
    const reference=canonicalEvidenceReference({entry:{table,metadata,object_sha256:sha(raw),row_sha256:digest(row)},object:{sha256:sha(raw),bytes:raw.length,gzip_bytes:compressed.length,gzip_sha256:sha(compressed)},sealed:sealed.descriptor});
    descriptorPlain=Buffer.from(JSON.stringify(reference));if(descriptorPlain.length>MAX_DESCRIPTOR)throw Error("append_descriptor_byte_bound");
    const descriptor=seal(descriptorPlain,descriptorKey,open.pin,stageId,"descriptor");
    await exclusive(path.join(folder,"object.bin"),sealed.ciphertext);await exclusive(path.join(folder,"descriptor.bin"),descriptor.ciphertext);
    const ready={version:VERSION,context_pin:open.pin,stage_id:stageId,descriptor:descriptor.descriptor},readyBytes=Buffer.from(JSON.stringify(ready)+"\n");
    await exclusive(path.join(folder,"ready.json"),readyBytes);
    const ticket={context_pin:open.pin,stage_id:stageId,ticket_sha256:sha(readyBytes)};await verified(open,ticket);
    return {ticket,...held(),reused:false};
  }finally{raw.fill(0);compressed?.fill(0);descriptorPlain?.fill(0);payloadKey?.fill(0);descriptorKey?.fill(0);open?.key.fill(0);}
}
