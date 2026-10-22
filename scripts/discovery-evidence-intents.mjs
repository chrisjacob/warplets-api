// Private offline publication intents. No runtime bindings or new source IO.
import fs from "node:fs/promises";
import path from "node:path";
import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes,timingSafeEqual} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {z} from "zod";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {inspectEvidenceAppendStage,readStagedEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {validateEvidenceTargetPlan,selectEvidencePublication,publishEvidenceAppend,reconcileEvidenceAppend,publishEvidenceCandidateMetadata,reconcileEvidenceCandidateMetadata,publishEvidenceWalletCached,reconcileEvidenceWalletCached,publishEvidenceWalletQuota,reconcileEvidenceWalletQuota,publishEvidenceWalletCycle,reconcileEvidenceWalletCycle,publishEvidenceWalletCollection,reconcileEvidenceWalletCollection} from "./discovery-evidence-publication.mjs";

const VERSION="discovery-evidence-intents-v1",MAX=16*1024**2;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Id=z.string().uuid();
const Grant=z.object({generation:Id,owner:Id,epoch:z.number().int().safe().positive()}).strict();
const Context=z.object({version:z.literal(VERSION),target_pin:Hash,stage_pin:Hash,generation:Id,source_archive_pin:Hash,base_reference_pin:Hash,salt:Hash}).strict();
const Ready=z.object({context_pin:Hash,publication_id:Id,sha256:Hash,bytes:z.number().int().positive().max(MAX),iv:z.string().regex(/^[a-f0-9]{24}$/),tag:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
const Intent=z.object({version:z.literal(VERSION),original_grant:Grant,plan:z.unknown()}).strict();
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),digest=value=>sha(JSON.stringify(value));
const aad=(pin,id,role)=>Buffer.from(JSON.stringify([VERSION,pin,id,role]));
const derive=(key,pin,id,role)=>Buffer.from(hkdfSync("sha256",key,Buffer.from(pin,"hex"),aad(pin,id,role),32));
const inactive=()=>({evidence_qualified:false,runtime_activated:false,action_authority:false,provider_requests:0,free_acceptance:false});
async function bounded(file,max){
  const info=await evidenceRegularFile(file,max),handle=await fs.open(info.file,"r");
  try{const bytes=Buffer.alloc(info.bytes+1);let offset=0,reads=0;
    while(offset<bytes.length){if(++reads>4096)throw Error("intent_file_read_bound");const read=await handle.read(bytes,offset,bytes.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}
    if(offset!==info.bytes||(await handle.stat()).size!==info.bytes)throw Error("intent_file_size_changed");return bytes.subarray(0,offset);
  }finally{await handle.close();}
}
const json=bytes=>JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes));
async function exclusive(file,bytes){const handle=await fs.open(file,"wx",0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
async function keyAt(publication,folder){
  const info=await evidenceRegularFile(publication.stage.keyFile,32);
  if(info.bytes!==32||info.file===folder||info.file.startsWith(folder+path.sep))throw Error("intent_separate_key_required");return bounded(info.file,32);
}
async function fence(publication,grant){return selectEvidencePublication(publication,Grant.parse(grant),{kind:"receipt",table:"tenx_holder_evidence",hash:"intent-context-only",baseline:[]});}
async function opened(publication,journal,grant){
  Hash.parse(journal.contextPin);const folder=await evidencePrivatePath(journal.directory),key=await keyAt(publication,folder);
  try{
    const {context_pin,key_mac,...body}=json(await bounded(path.join(folder,"intents.json"),4096));Context.parse(body);Hash.parse(key_mac);
    if(context_pin!==journal.contextPin||digest(body)!==context_pin||body.target_pin!==publication.targetPin||body.stage_pin!==publication.stage.contextPin||body.generation!==grant.generation)throw Error("intent_context_mismatch");
    const role=derive(key,context_pin,body.generation,"context");try{if(!timingSafeEqual(createHmac("sha256",role).update(JSON.stringify(body)).digest(),Buffer.from(key_mac,"hex")))throw Error("intent_context_key_mismatch");}finally{role.fill(0);}
    const selected=await fence(publication,grant);
    if(body.source_archive_pin!==selected.context.source_archive_pin||body.base_reference_pin!==selected.context.base_reference_pin)throw Error("intent_source_context_mismatch");
    return {folder,key,pin:context_pin,body};
  }catch(error){key.fill(0);throw error;}
}
export async function createEvidenceIntentJournal({target,publication,grant}){
  grant=Grant.parse(grant);
  const folder=await evidencePrivatePath(target,true);if(path.dirname(folder)!==await fs.realpath(".tmp"))throw Error("intent_standalone_target_required");
  const stage=await inspectEvidenceAppendStage(publication.stage);await fence(publication,grant);
  const body=Context.parse({version:VERSION,target_pin:publication.targetPin,stage_pin:publication.stage.contextPin,generation:stage.generation,source_archive_pin:stage.source_archive_pin,base_reference_pin:stage.base_reference_pin,salt:randomBytes(32).toString("hex")}),pin=digest(body),key=await keyAt(publication,folder),role=derive(key,pin,body.generation,"context");
  try{
    await fs.mkdir(folder,{mode:0o700});await fs.mkdir(path.join(folder,"pending"),{mode:0o700});
    const key_mac=createHmac("sha256",role).update(JSON.stringify(body)).digest("hex");await exclusive(path.join(folder,"intents.json"),Buffer.from(JSON.stringify({...body,context_pin:pin,key_mac})+"\n"));
    await fence(publication,grant);return {context_pin:pin,...inactive()};
  }finally{key.fill(0);role.fill(0);}
}
async function readAt(open,id){
  Id.parse(id);const folder=await evidencePrivatePath(path.join(open.folder,"pending",id)),readyBytes=await bounded(path.join(folder,"ready.json"),4096),ready=Ready.parse(json(readyBytes));
  if(ready.context_pin!==open.pin||ready.publication_id!==id)throw Error("intent_ready_context_mismatch");
  const ciphertext=await bounded(path.join(folder,"intent.bin"),MAX);if(ciphertext.length!==ready.bytes||sha(ciphertext)!==ready.sha256)throw Error("intent_ciphertext_mismatch");
  const role=derive(open.key,open.pin,id,"plan");let plain;
  try{
    const decipher=createDecipheriv("aes-256-gcm",role,Buffer.from(ready.iv,"hex"),{authTagLength:16});decipher.setAAD(aad(open.pin,id,"plan"));decipher.setAuthTag(Buffer.from(ready.tag,"hex"));plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    const saved=Intent.parse(json(plain)),plan=validateEvidenceTargetPlan(saved.plan);
    if(plan.publication_id!==id||!plan.kind&&plan.ticket.context_pin!==open.body.stage_pin||saved.original_grant.generation!==open.body.generation)throw Error("intent_plan_context_mismatch");
    return {original_grant:saved.original_grant,plan,ready_sha256:sha(readyBytes)};
  }finally{plain?.fill(0);role.fill(0);}
}
export async function persistEvidencePublicationIntent(publication,journal,grant,input){
  const plan=validateEvidenceTargetPlan(input),original=Grant.parse(grant);
  if(!plan.kind&&plan.ticket.context_pin!==publication.stage.contextPin)throw Error("intent_stage_context_mismatch");
  const encoded=Buffer.from(JSON.stringify({version:VERSION,original_grant:original,plan}));
  if(encoded.length>MAX){encoded.fill(0);throw Error("intent_plan_byte_bound");}
  let open,role;
  try{
    open=await opened(publication,journal,original);if(!plan.kind)await readStagedEvidenceAppend(publication.stage,plan.ticket);
    const folder=await evidencePrivatePath(path.join(open.folder,"pending",plan.publication_id),true);let existing=false;
    try{await fs.lstat(folder);existing=true;}catch(error){if(error.code!=="ENOENT")throw error;}
    if(existing){const saved=await readAt(open,plan.publication_id);if(!isDeepStrictEqual(saved.original_grant,original)||!isDeepStrictEqual(saved.plan,plan))throw Error("intent_immutable_identity_conflict");await fence(publication,original);return {publication_id:plan.publication_id,ready_sha256:saved.ready_sha256,reused:true,...inactive()};}
    await fence(publication,original);await fs.mkdir(folder,{mode:0o700});role=derive(open.key,open.pin,plan.publication_id,"plan");
    const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",role,iv,{authTagLength:16});cipher.setAAD(aad(open.pin,plan.publication_id,"plan"));const ciphertext=Buffer.concat([cipher.update(encoded),cipher.final()]);
    await exclusive(path.join(folder,"intent.bin"),ciphertext);
    const ready=Ready.parse({context_pin:open.pin,publication_id:plan.publication_id,sha256:sha(ciphertext),bytes:ciphertext.length,iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex")}),bytes=Buffer.from(JSON.stringify(ready)+"\n");
    await exclusive(path.join(folder,"ready.json"),bytes);await readAt(open,plan.publication_id);await fence(publication,original);
    return {publication_id:plan.publication_id,ready_sha256:sha(bytes),reused:false,...inactive()};
  }finally{encoded.fill(0);role?.fill(0);open?.key.fill(0);}
}
export async function readEvidencePublicationIntent(publication,journal,grant,id){
  grant=Grant.parse(grant);
  const open=await opened(publication,journal,grant);try{const saved=await readAt(open,id);await fence(publication,grant);return {...saved,...inactive()};}finally{open.key.fill(0);}
}
export async function publishStoredEvidenceIntent(publication,journal,grant,id,afterCommit){
  grant=Grant.parse(grant);
  const saved=await readEvidencePublicationIntent(publication,journal,grant,id);
  if(!isDeepStrictEqual(saved.original_grant,Grant.parse(grant)))throw Error("intent_original_owner_required");
  return (saved.plan.kind==="candidate_metadata"?publishEvidenceCandidateMetadata:saved.plan.kind==="wallet_cached_progress"?publishEvidenceWalletCached:saved.plan.kind==="wallet_quota"?publishEvidenceWalletQuota:saved.plan.kind==="wallet_cycle_control"?publishEvidenceWalletCycle:saved.plan.kind==="wallet_collection"?publishEvidenceWalletCollection:publishEvidenceAppend)(publication,grant,saved.plan,afterCommit);
}
export async function reconcileStoredEvidenceIntent(publication,journal,grant,id,afterCommit){
  grant=Grant.parse(grant);
  const saved=await readEvidencePublicationIntent(publication,journal,grant,id);return (saved.plan.kind==="candidate_metadata"?reconcileEvidenceCandidateMetadata:saved.plan.kind==="wallet_cached_progress"?reconcileEvidenceWalletCached:saved.plan.kind==="wallet_quota"?reconcileEvidenceWalletQuota:saved.plan.kind==="wallet_cycle_control"?reconcileEvidenceWalletCycle:saved.plan.kind==="wallet_collection"?reconcileEvidenceWalletCollection:reconcileEvidenceAppend)(publication,grant,saved.plan,afterCommit);
}
