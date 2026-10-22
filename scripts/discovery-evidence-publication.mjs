// Private Node/SQLite experiment only. Never an application backend or migration.
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync,backup} from "node:sqlite";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {z} from "zod";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {inspectEvidenceAppendStage,readStagedEvidenceAppend} from "./discovery-evidence-append-stage.mjs";

const VERSION="discovery-evidence-publication-v1",FILE="metadata.sqlite",MAX_DB=2*1024**3;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Id=z.string().uuid();
const Grant=z.object({generation:Id,owner:Id,epoch:z.number().int().safe().positive()}).strict();
const Ticket=z.object({context_pin:Hash,stage_id:Id,ticket_sha256:Hash}).strict();
const Operation=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("receipt")}).strict(),
  z.object({kind:z.literal("sql"),sql:z.string().min(1).max(16384),bindings:z.union([z.string().max(2000000),z.number().finite(),z.null()]).array().max(100),expect_changes:z.number().int().nonnegative().optional()}).strict(),
]);
const Plan=z.object({publication_id:Id,ticket:Ticket,operations:Operation.array().min(1).max(128)}).strict();
const Header=z.object({version:z.literal(VERSION),file:z.literal(FILE),capacity_pin:Hash,source_archive_pin:Hash,base_reference_pin:Hash,context_pin:Hash,generation:Id,schema_sha256:Hash}).strict();
const writable=new Set(["tenx_candidates","tenx_market_history","tenx_wallet_signals","tenx_proofs","tenx_evidence","tenx_account_evidence","tenx_wallet_runs","tenx_wallet_attempts","tenx_wallet_control","tenx_wallet_work","tenx_wallet_profiles"]);
const SCHEMA=[
  "CREATE TABLE tenx_append_control(id INTEGER PRIMARY KEY CHECK(id=1),generation TEXT NOT NULL,owner TEXT NOT NULL,epoch INTEGER NOT NULL CHECK(epoch>0)) STRICT",
  "CREATE TABLE tenx_append_base(table_name TEXT NOT NULL,payload_hash TEXT NOT NULL,row_sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(table_name,payload_hash)) STRICT",
  "CREATE TABLE tenx_append_references(table_name TEXT NOT NULL,payload_hash TEXT NOT NULL,row_sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,ticket_json TEXT NOT NULL,publication_id TEXT NOT NULL,PRIMARY KEY(table_name,payload_hash)) STRICT",
  "CREATE TABLE tenx_append_publications(publication_id TEXT PRIMARY KEY,plan_sha256 TEXT NOT NULL,generation TEXT NOT NULL,owner TEXT NOT NULL,epoch INTEGER NOT NULL,results_json TEXT NOT NULL) STRICT",
];
const digest=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
const inactive=()=>({runtime_activated:false,action_authority:false,evidence_qualified:false,provider_requests:0,free_acceptance:false});
async function smallJson(file){const info=await evidenceRegularFile(file,4096),handle=await fs.open(info.file,"r");try{const bytes=Buffer.alloc(info.bytes+1),read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==info.bytes||(await handle.stat()).size!==info.bytes)throw Error("publication_header_size_changed");return JSON.parse(bytes.subarray(0,read.bytesRead));}finally{await handle.close();}}
export async function createEvidencePublicationTarget({target,source,stage,owner}){
  Id.parse(owner);const folder=await evidencePrivatePath(target,true);
  if(path.dirname(folder)!==await fs.realpath(".tmp"))throw Error("publication_standalone_target_required");
  const context=await inspectEvidenceAppendStage(stage);
  const admitted=await withScratchEvidenceResolver(source,async reader=>{
    if(context.source_archive_pin!==reader.capacity.source_archive_manifest_sha256||context.base_reference_pin!==source.referencePin)throw Error("publication_source_context_mismatch");
    await fs.mkdir(folder,{mode:0o700});const file=path.join(folder,FILE),handle=await fs.open(file,"wx",0o600);await handle.close();await backup(reader.sqlite,file);
    const db=new DatabaseSync(file),refs=new DatabaseSync(path.join(await evidencePrivatePath(source.referenceDirectory),"references.sqlite"),{readOnly:true});let body;
    try{
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE");
      for(const sql of SCHEMA)db.exec(sql);
      db.prepare("INSERT INTO tenx_append_control VALUES(1,?,?,1)").run(context.generation,owner);
      let count=0;
      for(const saved of refs.prepare("SELECT reference_json FROM evidence_references ORDER BY ordinal").iterate()){
        if(++count>10000)throw Error("publication_base_bound");const {entry,object}=JSON.parse(saved.reference_json),meta=reader.describe(entry.table,entry.metadata[0]);
        if(meta.bytes!==object.bytes||entry.metadata[0]!==object.sha256)throw Error("publication_base_payload_hash_mismatch");
        db.prepare("INSERT INTO tenx_append_base VALUES(?,?,?,?)").run(entry.table,entry.metadata[0],entry.row_sha256,object.bytes);
      }
      const population=["tenx_holder_evidence","tenx_wallet_evidence"].reduce((n,t)=>n+db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n,0);
      if(population!==count)throw Error("publication_base_population_mismatch");
      body={version:VERSION,file:FILE,capacity_pin:source.capacityPin,source_archive_pin:context.source_archive_pin,base_reference_pin:context.base_reference_pin,context_pin:stage.contextPin,generation:context.generation,schema_sha256:digest(schema(db))};db.exec("COMMIT");
    }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();refs.close();}
    return body;
  });
  // Publish the independent immutable header only after frozen source end checks.
  const body=admitted.value,pin=digest(body);await fs.writeFile(path.join(folder,"publication.json"),JSON.stringify({...body,target_pin:pin})+"\n",{flag:"wx",mode:0o600});
  return {target_pin:pin,grant:{generation:body.generation,owner,epoch:1},...inactive()};
}
async function opened(options,readOnly=false){
  Hash.parse(options.targetPin);const folder=await evidencePrivatePath(options.directory),saved=await smallJson(path.join(folder,"publication.json")),{target_pin,...body}=saved;Header.parse(body);
  if(target_pin!==options.targetPin||digest(body)!==target_pin||body.context_pin!==options.stage.contextPin)throw Error("publication_target_pin_mismatch");
  const context=await inspectEvidenceAppendStage(options.stage);
  if(context.generation!==body.generation||context.source_archive_pin!==body.source_archive_pin||context.base_reference_pin!==body.base_reference_pin)throw Error("publication_stage_context_mismatch");
  const file=await evidenceRegularFile(path.join(folder,FILE),MAX_DB),db=new DatabaseSync(file.file,{readOnly});
  try{db.exec("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000");if(db.prepare("PRAGMA journal_mode").get().journal_mode!=="delete"||digest(schema(db))!==body.schema_sha256)throw Error("publication_schema_changed");return {db,body};}catch(error){db.close();throw error;}
}
function fenced(db,body,grant){
  Grant.parse(grant);const current=db.prepare("SELECT generation,owner,epoch FROM tenx_append_control WHERE id=1").get();
  if(grant.generation!==body.generation||!isDeepStrictEqual({...current},grant))throw Error("publication_owner_fenced");
  if(digest(schema(db))!==body.schema_sha256)throw Error("publication_schema_changed");
}
function normalizedPlan(input){
  const plan=Plan.parse(input);if(plan.operations.filter(o=>o.kind==="receipt").length!==1)throw Error("publication_receipt_position_invalid");let bytes=0;
  for(const op of plan.operations)if(op.kind==="sql"){
    const table=op.sql.match(/^(?:INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM) (\w+)\b/i)?.[1];
    if(!writable.has(table)||/[;]|--|\/\*|\bRETURNING\b/i.test(op.sql))throw Error("publication_sql_not_allowed");
    bytes+=Buffer.byteLength(op.sql)+op.bindings.reduce((n,b)=>n+(typeof b==="string"?Buffer.byteLength(b):8),0);
  }
  if(bytes>10*1024**2)throw Error("publication_plan_byte_bound");return plan;
}
function metadata(db,table,hash){
  const fields=table==="tenx_holder_evidence"?["payload_hash","address","slot","observed_at"]:["payload_hash","address","observed_at"],row=db.prepare(`SELECT ${fields.map(c=>c==="slot"?c:`CAST(${c} AS BLOB) AS ${c}`).join(",")} FROM ${table} WHERE payload_hash=?`).get(hash);
  return row?Object.fromEntries(fields.map(c=>[c,c==="slot"?row[c]:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(row[c])])):null;
}
function append(db,verified,ticket,publicationId,allowInsert=true){
  const {table,row}=verified,hash=row.payload_hash,current=metadata(db,table,hash),base=db.prepare("SELECT row_sha256,bytes FROM tenx_append_base WHERE table_name=? AND payload_hash=?").get(table,hash),prior=db.prepare("SELECT row_sha256,bytes FROM tenx_append_references WHERE table_name=? AND payload_hash=?").get(table,hash),admitted=prior??base;
  if(current||admitted){
    if(base&&prior)throw Error("publication_reference_overlap");
    if(!current||!admitted)throw Error("publication_existing_reference_missing");
    const first=table==="tenx_holder_evidence"?{...row,observed_at:current.observed_at}:row;
    if(current.address!==row.address||(table==="tenx_holder_evidence"&&current.slot!==row.slot)||current.observed_at!==first.observed_at||digest(first)!==admitted.row_sha256||Buffer.byteLength(row.payload)!==admitted.bytes)throw Error("publication_immutable_collision");
    return 0;
  }
  if(!allowInsert)throw Error("publication_committed_reference_missing");
  if(table==="tenx_holder_evidence")db.prepare("INSERT INTO tenx_holder_evidence(payload_hash,address,slot,observed_at) VALUES(?,?,?,?)").run(hash,row.address,row.slot,row.observed_at);
  else db.prepare("INSERT INTO tenx_wallet_evidence(payload_hash,address,observed_at) VALUES(?,?,?)").run(hash,row.address,row.observed_at);
  db.prepare("INSERT INTO tenx_append_references VALUES(?,?,?,?,?,?)").run(table,hash,digest(row),Buffer.byteLength(row.payload),JSON.stringify(ticket),publicationId);return 1;
}
export async function transferEvidencePublicationOwner(options,grant,nextOwner){
  Id.parse(nextOwner);const {db,body}=await opened(options);
  try{db.exec("BEGIN IMMEDIATE");fenced(db,body,grant);const next={generation:grant.generation,owner:nextOwner,epoch:grant.epoch+1};Grant.parse(next);db.prepare("UPDATE tenx_append_control SET owner=?,epoch=? WHERE id=1").run(next.owner,next.epoch);db.exec("COMMIT");return {grant:next,...inactive()};}finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
export async function publishEvidenceAppend(options,grant,input,afterCommit){
  const plan=normalizedPlan(input),planHash=digest(plan),verified=await readStagedEvidenceAppend(options.stage,plan.ticket),{db,body}=await opened(options);let publication,commitAttempted=false;
  try{
    db.exec("BEGIN IMMEDIATE");fenced(db,body,grant);
    const prior=db.prepare("SELECT plan_sha256,results_json FROM tenx_append_publications WHERE publication_id=?").get(plan.publication_id);
    if(prior){
      if(prior.plan_sha256!==planHash)throw Error("publication_identity_conflict");
      append(db,verified,plan.ticket,plan.publication_id,false);
      const results=z.object({success:z.literal(true),results:z.tuple([]),meta:z.object({changes:z.number().int().nonnegative()}).strict()}).strict().array().length(plan.operations.length).parse(JSON.parse(prior.results_json));
      publication={results,reconciled:true};
    }
    else{
      const results=plan.operations.map(op=>{
        let changes;if(op.kind==="receipt")changes=append(db,verified,plan.ticket,plan.publication_id);
        else{changes=Number(db.prepare(op.sql).run(...op.bindings).changes);if(op.expect_changes!==undefined&&changes!==op.expect_changes)throw Error("publication_expected_changes_mismatch");}
        return {success:true,results:[],meta:{changes}};
      });
      db.prepare("INSERT INTO tenx_append_publications VALUES(?,?,?,?,?,?)").run(plan.publication_id,planHash,grant.generation,grant.owner,grant.epoch,JSON.stringify(results));publication={results,reconciled:false};
    }
    commitAttempted=true;db.exec("COMMIT");
  }catch(error){const uncertain=commitAttempted&&!db.isTransaction;if(db.isTransaction)db.exec("ROLLBACK");if(uncertain)throw Error("publication_commit_acknowledgement_unknown");throw error;}finally{db.close();}
  const outcome={state:"committed",publication_id:plan.publication_id,...publication,post_commit:"not_requested",...inactive()};
  if(afterCommit){try{await afterCommit(structuredClone(outcome));outcome.post_commit="completed";}catch{outcome.post_commit="failed";outcome.post_commit_error="publication_post_commit_work_failed";}}
  return outcome;
}
export async function readPublishedEvidenceAppend(options,grant,table,hash){
  if(!["tenx_holder_evidence","tenx_wallet_evidence"].includes(table))throw Error("publication_table_unsupported");Hash.parse(hash);
  let ref;const first=await opened(options);
  try{first.db.exec("BEGIN");fenced(first.db,first.body,grant);ref=first.db.prepare("SELECT row_sha256,ticket_json FROM tenx_append_references WHERE table_name=? AND payload_hash=?").get(table,hash);if(!ref)throw Error("publication_dynamic_reference_unavailable");first.db.exec("COMMIT");}finally{if(first.db.isTransaction)first.db.exec("ROLLBACK");first.db.close();}
  const verified=await readStagedEvidenceAppend(options.stage,JSON.parse(ref.ticket_json));if(verified.table!==table||verified.row.payload_hash!==hash||digest(verified.row)!==ref.row_sha256)throw Error("publication_read_reference_mismatch");
  const last=await opened(options);try{last.db.exec("BEGIN");fenced(last.db,last.body,grant);const current=last.db.prepare("SELECT row_sha256,ticket_json FROM tenx_append_references WHERE table_name=? AND payload_hash=?").get(table,hash),meta=metadata(last.db,table,hash),{payload:ignored,...expected}=verified.row;if(!isDeepStrictEqual({...current},{...ref})||!isDeepStrictEqual(meta,expected))throw Error("publication_read_changed");last.db.exec("COMMIT");return {table,row:verified.row,scratch_published:true,...inactive()};}finally{if(last.db.isTransaction)last.db.exec("ROLLBACK");last.db.close();}
}
// Bounded explicit selections for the offline shared-read adapter. No SQL proxy.
export async function selectEvidencePublication(options,grant,input){
  const Text=z.string().max(4096),Table=z.enum(["tenx_holder_evidence","tenx_wallet_evidence"]),request=z.discriminatedUnion("kind",[
    z.object({kind:z.literal("index"),table:Table,address:Text,start:Text,cutoff:Text,baseline:Hash.array().max(97)}).strict(),
    z.object({kind:z.literal("receipt"),table:Table,hash:Text,baseline:Hash.array().max(1)}).strict(),
  ]).parse(input),{db,body}=await opened(options,true);
  const selected=hash=>{
    const meta=metadata(db,request.table,hash),base=db.prepare("SELECT row_sha256,bytes FROM tenx_append_base WHERE table_name=? AND payload_hash=?").get(request.table,hash),dynamic=db.prepare("SELECT row_sha256,bytes,ticket_json FROM tenx_append_references WHERE table_name=? AND payload_hash=?").get(request.table,hash),bound=dynamic??base;
    if(!meta&&!bound)return null;
    if(!meta||!bound||base&&dynamic)throw Error("publication_selected_reference_missing_or_overlapping");
    const row_sha256=Hash.parse(bound.row_sha256),bytes=z.number().int().nonnegative().max(2000000).parse(bound.bytes);
    return {meta,source:dynamic?"published":"base",bytes,row_sha256,ticket:dynamic?Ticket.parse(JSON.parse(dynamic.ticket_json)):null};
  };
  try{
    db.exec("BEGIN");fenced(db,body,grant);
    const baseline=request.baseline.map(hash=>{const row=selected(hash);if(!row||row.source!=="base")throw Error("publication_frozen_baseline_missing");return row;});
    const hashes=request.kind==="receipt"?[request.hash]:db.prepare(`SELECT payload_hash FROM ${request.table} WHERE address=? AND observed_at>=? AND observed_at<=? ORDER BY ${request.table==="tenx_holder_evidence"?"observed_at,slot,payload_hash LIMIT 97":"observed_at DESC,payload_hash DESC LIMIT 2"}`).all(request.address,request.start,request.cutoff).map(r=>r.payload_hash);
    const rows=hashes.map(selected).filter(row=>row!==null);db.exec("COMMIT");
    return {context:{capacity_pin:body.capacity_pin,source_archive_pin:body.source_archive_pin,base_reference_pin:body.base_reference_pin},baseline,rows};
  }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
