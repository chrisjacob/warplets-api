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
import {cachedCheckpointSql,cachedFinishSql} from "./evidence-wallet-cached-sql.mjs";
import {walletQuotaSql,rpcQuotaSql} from "./evidence-wallet-quota-sql.mjs";

const VERSION="discovery-evidence-publication-v1",FILE="metadata.sqlite",MAX_DB=2*1024**3;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Id=z.string().uuid();
const Grant=z.object({generation:Id,owner:Id,epoch:z.number().int().safe().positive()}).strict();
const Ticket=z.object({context_pin:Hash,stage_id:Id,ticket_sha256:Hash}).strict();
const Operation=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("receipt")}).strict(),
  z.object({kind:z.literal("sql"),sql:z.string().min(1).max(16384),bindings:z.union([z.string().max(2000000),z.number().finite(),z.null()]).array().max(100),expect_changes:z.number().int().nonnegative().optional()}).strict(),
]);
const Plan=z.object({publication_id:Id,ticket:Ticket,operations:Operation.array().min(1).max(128)}).strict();
const MetadataPlan=z.object({publication_id:Id,kind:z.literal("candidate_metadata"),operations:Operation.array().min(1).max(128)}).strict();
const WalletCachedPlan=z.object({publication_id:Id,kind:z.literal("wallet_cached_progress"),operations:Operation.array().min(1).max(4)}).strict();
const QuotaLimit=z.number().int().safe().positive(),QuotaReservation=z.object({wallet:Id,rpc:Id,day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),wallet_limit:QuotaLimit,rpc_limit:QuotaLimit}).strict();
const WalletQuotaPlan=z.object({publication_id:Id,kind:z.literal("wallet_quota"),reservation:QuotaReservation,operations:Operation.array().length(1)}).strict();
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
// Offline producer adapters use the identical coordinator validation before IO.
export function validateEvidencePublicationPlan(input){return normalizedPlan(input);}
// A separate, explicit plan domain. Receipt plans still require exactly one
// authenticated receipt; metadata plans cannot contain one or name its tables.
export function validateEvidenceCandidateMetadataPlan(input){
  const plan=MetadataPlan.parse(input),tables=new Set(["tenx_candidates","tenx_market_history","tenx_proofs","tenx_evidence","tenx_account_evidence"]);let bytes=0;
  for(const [index,op] of plan.operations.entries()){
    if(op.kind!=="sql")throw Error("publication_metadata_sql_required");
    const table=op.sql.match(/^(?:INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM) (\w+)\b/i)?.[1];
    if(!tables.has(table)||/[;]|--|\/\*|\bRETURNING\b/i.test(op.sql)||index>0&&(table==="tenx_candidates"||!op.sql.startsWith(table==="tenx_proofs"?"INSERT INTO tenx_proofs(":`INSERT OR IGNORE INTO ${table}(`)))throw Error("publication_metadata_sql_not_allowed");
    bytes+=Buffer.byteLength(op.sql)+op.bindings.reduce((n,b)=>n+(typeof b==="string"?Buffer.byteLength(b):8),0);
  }
  if(bytes>10*1024**2)throw Error("publication_plan_byte_bound");
  const first=plan.operations[0];
  if(!first.sql.startsWith("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?1,?2,?3,?4,?5)")||first.bindings.length!==5||first.bindings[4]!=="live"||typeof first.bindings[2]!=="string")throw Error("publication_metadata_candidate_required");
  const candidate=JSON.parse(first.bindings[2]);
  if(candidate.address!==first.bindings[0]||candidate.pool!==first.bindings[1]||candidate.checked_at!==first.bindings[3]||candidate.mode!=="live")throw Error("publication_metadata_candidate_mismatch");
  return plan;
}
export function validateEvidenceWalletCachedPlan(input){
  const plan=WalletCachedPlan.parse(input),ops=plan.operations,Text=z.string().min(1).max(4096),Time=z.string().datetime();
  for(const op of ops)if(op.kind!=="sql"||op.expect_changes!==undefined||op.bindings.some(b=>typeof b!=="string"&&typeof b!=="number"))throw Error("publication_wallet_cached_shape");
  if(ops.length===1){
    const {sql,bindings:b}=ops[0];if(sql!==cachedCheckpointSql||b.length!==9)throw Error("publication_wallet_cached_sql");
    for(const i of [3,4,5,8])Text.parse(b[i]);for(const i of [1,6,7])Hash.parse(b[i]);Time.parse(b[2]);
    if(typeof b[0]!=="string"||Buffer.byteLength(b[0])>250000)throw Error("publication_wallet_cached_bytes");
    const scan=JSON.parse(b[0]);
    if(digest(scan)!==b[1]||scan.wallet!==b[4]||scan.anchor?.wallet!==b[4]||scan.anchor?.signature!==b[5]||scan.attempted_at!==b[2])throw Error("publication_wallet_cached_identity");
  }else{
    if(ops.length!==4||ops.some((op,i)=>op.sql!==cachedFinishSql[i]))throw Error("publication_wallet_cached_sql");
    const [work,run,attempt,control]=ops.map(op=>op.bindings),base=work.slice(0,4);
    if(work.length!==5||run.length!==6||attempt.length!==6||control.length!==5||[run,attempt,control].some(b=>!isDeepStrictEqual(b.slice(0,4),base)))throw Error("publication_wallet_cached_scope");
    Text.parse(base[0]);Time.parse(base[1]);Text.parse(base[2]);Hash.parse(base[3]);Time.parse(run[4]);Time.parse(attempt[4]);Time.parse(attempt[5]);Time.parse(control[4]);z.number().int().nonnegative().max(20).parse(run[5]);
    if(run[4]!==attempt[4]||attempt[5]!==control[4]||Date.parse(control[4])!==Date.parse(base[1])+60000||typeof work[4]!=="string"||Buffer.byteLength(work[4])>250000)throw Error("publication_wallet_cached_finish");
    const payload=JSON.parse(work[4]);if(payload.address!==base[2]||payload.source_evidence_hash!==base[3]||payload.rpc_calls!==0)throw Error("publication_wallet_cached_work");
  }
  return plan;
}
export function validateEvidenceWalletQuotaPlan(input){
  const plan=WalletQuotaPlan.parse(input),op=plan.operations[0];
  if(op.kind!=="sql"||op.expect_changes!==undefined)throw Error("publication_wallet_quota_shape");
  const wallet=op.sql===walletQuotaSql,rpc=op.sql===rpcQuotaSql,b=op.bindings;
  if(!wallet&&!rpc||b.length!==(wallet?2:3)||rpc&&b[0]!=="rpc")throw Error("publication_wallet_quota_sql");
  const r=plan.reservation,day=r.day;if(r.wallet===r.rpc||plan.publication_id!==(wallet?r.wallet:r.rpc)||b[wallet?0:1]!==day||b[wallet?1:2]!==r[wallet?"wallet_limit":"rpc_limit"])throw Error("publication_wallet_quota_identity");
  if(new Date(day+"T00:00:00.000Z").toISOString().slice(0,10)!==day)throw Error("publication_wallet_quota_day");
  return plan;
}
export function validateEvidenceTargetPlan(input){return input?.kind==="candidate_metadata"?validateEvidenceCandidateMetadataPlan(input):input?.kind==="wallet_cached_progress"?validateEvidenceWalletCachedPlan(input):input?.kind==="wallet_quota"?validateEvidenceWalletQuotaPlan(input):normalizedPlan(input);}
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
async function executePublication(options,grant,input,afterCommit,allowNew,metadataOnly=false){
  if(metadataOnly){grant=Grant.parse(grant);options=structuredClone(options);}
  const plan=metadataOnly==="wallet_quota"?validateEvidenceWalletQuotaPlan(input):metadataOnly==="wallet_cached_progress"?validateEvidenceWalletCachedPlan(input):metadataOnly?validateEvidenceCandidateMetadataPlan(input):normalizedPlan(input),planHash=digest(plan),verified=metadataOnly?null:await readStagedEvidenceAppend(options.stage,plan.ticket),{db,body}=await opened(options,!allowNew);let publication,commitAttempted=false;
  try{
    db.exec(allowNew?"BEGIN IMMEDIATE":"BEGIN");fenced(db,body,grant);
    const prior=db.prepare("SELECT plan_sha256,results_json,generation,owner,epoch FROM tenx_append_publications WHERE publication_id=?").get(plan.publication_id);
    if(prior){
      if(prior.plan_sha256!==planHash)throw Error("publication_identity_conflict");
      if(metadataOnly==="wallet_quota"&&plan.operations[0].sql===rpcQuotaSql){if(prior.generation!==body.generation)throw Error("publication_wallet_quota_generation");walletQuotaParent(db,plan,{generation:prior.generation,owner:prior.owner,epoch:prior.epoch});}
      if(!metadataOnly)append(db,verified,plan.ticket,plan.publication_id,false);
      const results=publicationResults(plan,JSON.parse(prior.results_json));
      publication={results,reconciled:true};
    }
    else{
      if(!allowNew)throw Error("publication_reconciliation_requires_commit");
      const results=plan.operations.map(op=>{
        if(metadataOnly==="wallet_quota"){
          if(op.sql===rpcQuotaSql)walletQuotaParent(db,plan,grant);
          const returned=db.prepare(op.sql).all(...op.bindings).map(row=>({...row}));return {success:true,results:returned,meta:{changes:returned.length}};
        }
        let changes;if(op.kind==="receipt")changes=append(db,verified,plan.ticket,plan.publication_id);
        else{changes=Number(db.prepare(op.sql).run(...op.bindings).changes);if(op.expect_changes!==undefined&&changes!==op.expect_changes)throw Error("publication_expected_changes_mismatch");}
        return {success:true,results:[],meta:{changes}};
      });
      publicationResults(plan,results);db.prepare("INSERT INTO tenx_append_publications VALUES(?,?,?,?,?,?)").run(plan.publication_id,planHash,grant.generation,grant.owner,grant.epoch,JSON.stringify(results));publication={results,reconciled:false};
    }
    commitAttempted=true;db.exec("COMMIT");
  }catch(error){const uncertain=commitAttempted&&!db.isTransaction;if(db.isTransaction)db.exec("ROLLBACK");if(uncertain)throw Error("publication_commit_acknowledgement_unknown");throw error;}finally{db.close();}
  const outcome={state:"committed",publication_id:plan.publication_id,...publication,post_commit:"not_requested",...inactive()};
  if(afterCommit){try{await afterCommit(structuredClone(outcome));outcome.post_commit="completed";}catch{outcome.post_commit="failed";outcome.post_commit_error="publication_post_commit_work_failed";}}
  return outcome;
}
export async function publishEvidenceAppend(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,true);}
// Read-only reconciliation can never execute an uncommitted former-owner plan.
export async function reconcileEvidenceAppend(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,false);}
export async function publishEvidenceCandidateMetadata(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,true,true);}
export async function reconcileEvidenceCandidateMetadata(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,false,true);}
export async function publishEvidenceWalletCached(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,true,"wallet_cached_progress");}
export async function reconcileEvidenceWalletCached(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,false,"wallet_cached_progress");}
export async function publishEvidenceWalletQuota(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,true,"wallet_quota");}
export async function reconcileEvidenceWalletQuota(options,grant,input,afterCommit){return executePublication(options,grant,input,afterCommit,false,"wallet_quota");}
function publicationResults(plan,input){
  // Only this exact quota domain can retain RETURNING rows. All older domains
  // still require empty result arrays and preserve their original bytes.
  const quota=plan.kind==="wallet_quota",rows=quota?z.object({used:z.number().int().safe().positive()}).strict().array().max(1):z.tuple([]);
  const result=z.object({success:z.literal(true),results:rows,meta:z.object({changes:z.number().int().nonnegative()}).strict()}).strict().array().length(plan.operations.length).parse(input);
  if(quota&&result.some(r=>r.meta.changes!==r.results.length||r.results.some(row=>row.used>plan.reservation[plan.operations[0].sql===walletQuotaSql?"wallet_limit":"rpc_limit"])))throw Error("publication_wallet_quota_result");return result;
}
function walletQuotaParent(db,plan,expectedGrant){
  const r=plan.reservation,parentPlan=validateEvidenceWalletQuotaPlan({publication_id:r.wallet,kind:"wallet_quota",reservation:r,operations:[{kind:"sql",sql:walletQuotaSql,bindings:[r.day,r.wallet_limit]}]}),parent=db.prepare("SELECT plan_sha256,results_json,generation,owner,epoch FROM tenx_append_publications WHERE publication_id=?").get(r.wallet);
  if(!parent||parent.plan_sha256!==digest(parentPlan)||!isDeepStrictEqual({generation:parent.generation,owner:parent.owner,epoch:parent.epoch},expectedGrant))throw Error("publication_wallet_quota_parent_required");
  const result=publicationResults(parentPlan,JSON.parse(parent.results_json))[0];if(result.results.length!==1)throw Error("publication_wallet_quota_parent_declined");
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

// Narrow non-receipt paths for the offline original candidate-save workflow.
// No caller SQL, raw database handle, runtime D1 proxy or authority mutations.
export async function readEvidenceCandidateMetadata(options,grant,input){
  grant=Grant.parse(grant);options=structuredClone(options);
  const Text=z.string().max(4096),request=z.discriminatedUnion("kind",[
    z.object({kind:z.literal("candidate"),address:Text}).strict(),
    z.object({kind:z.literal("proof"),address:Text,proof_kind:z.enum(["creation","graduation"])}).strict(),
  ]).parse(input),{db,body}=await opened(options,true);
  try{
    db.exec("BEGIN");fenced(db,body,grant);let row=null;
    const candidate=request.kind==="candidate",column=candidate?"payload":"payload_hash",from=candidate?"tenx_candidates WHERE mode='live' AND address=?":"tenx_proofs WHERE address=? AND kind=?",bindings=candidate?[request.address]:[request.address,request.proof_kind];
    const saved=db.prepare(`SELECT length(CAST(${column} AS BLOB)) AS bytes FROM ${from}`).get(...bindings);
    if(saved){if(!Number.isSafeInteger(saved.bytes)||saved.bytes<0||saved.bytes>(candidate?2000000:4096))throw Error("publication_candidate_metadata_byte_bound");const bytes=db.prepare(`SELECT CAST(${column} AS BLOB) AS value FROM ${from}`).get(...bindings).value,value=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);row=candidate?{payload:value}:{payload_hash:value};}
    fenced(db,body,grant);db.exec("COMMIT");return {row,...inactive()};
  }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
// Cache/checkpoint reads for the offline cached-wallet replay. No SQL input,
// writes, cache repair, quota reservations or historical owner activation.
export async function readEvidenceWalletMetadata(options,grant,input){
  grant=Grant.parse(grant);options=structuredClone(options);
  const Text=z.string().max(4096),request=z.discriminatedUnion("kind",[
    z.object({kind:z.literal("candidates")}).strict(),
    z.object({kind:z.literal("transaction"),signature:Text}).strict(),
    z.object({kind:z.literal("checkpoint"),hop:z.enum(["direct","second"]),address:Text,wallet:Text,anchor_signature:Text}).strict(),
  ]).parse(input),{db,body}=await opened(options,true),decode=bytes=>new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
  try{
    db.exec("BEGIN");fenced(db,body,grant);let rows=[],row=null;
    if(request.kind==="candidates"){
      const selected=db.prepare("SELECT address,length(CAST(payload AS BLOB)) AS bytes FROM tenx_active_candidates WHERE mode='live' ORDER BY checked_at DESC,address LIMIT 500").all();let bytes=0;
      for(const item of selected){if(!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>2000000||(bytes+=item.bytes)>16*1024**2)throw Error("publication_wallet_index_byte_bound");}
      rows=selected.map(item=>({payload:decode(db.prepare("SELECT CAST(payload AS BLOB) AS payload FROM tenx_active_candidates WHERE mode='live' AND address=?").get(item.address).payload)}));
    }else{
      const transaction=request.kind==="transaction",from=transaction?"tenx_wallet_transactions WHERE signature=?":`${request.hop==="direct"?"tenx_funding_scans":"tenx_second_hop_scans"} WHERE address=? AND wallet=? AND anchor_signature=?`,bindings=transaction?[request.signature]:[request.address,request.wallet,request.anchor_signature],fields=transaction?["payload","payload_hash","fetched_at"]:["payload","payload_hash"];
      const sizes=db.prepare(`SELECT ${fields.map(field=>`length(CAST(${field} AS BLOB)) AS ${field}`).join(",")} FROM ${from}`).get(...bindings);
      if(sizes){for(const field of fields)if(!Number.isSafeInteger(sizes[field])||sizes[field]<0||sizes[field]>(field==="payload"?250000:4096))throw Error("publication_wallet_cache_byte_bound");const saved=db.prepare(`SELECT ${fields.map(field=>`CAST(${field} AS BLOB) AS ${field}`).join(",")} FROM ${from}`).get(...bindings);row=Object.fromEntries(fields.map(field=>[field,decode(saved[field])]));}
    }
    fenced(db,body,grant);db.exec("COMMIT");return {row,rows,...inactive()};
  }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
const CohortText=z.string().max(4096),CohortPayload=z.string().max(2000000);
const CohortRow=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("cohort"),day:CohortText,address:CohortText,selected_at:CohortText,recommended:z.union([z.literal(0),z.literal(1)]),input_hash:Hash,payload:CohortPayload}).strict(),
  z.object({kind:z.literal("wallet"),day:CohortText,address:CohortText,selected_at:CohortText,input_hash:Hash,payload:CohortPayload}).strict(),
  z.object({kind:z.literal("selection"),day:CohortText,address:CohortText,selected_at:CohortText,input_hash:Hash,payload:CohortPayload}).strict(),
]);
export async function writeEvidenceCandidateCohorts(options,grant,input){
  grant=Grant.parse(grant);options=structuredClone(options);
  const request=z.object({publication_id:Id,rows:CohortRow.array().min(1).max(3)}).strict().parse(input),first=request.rows[0];
  if(first.kind!=="cohort"||new Set(request.rows.map(row=>row.kind)).size!==request.rows.length)throw Error("publication_cohort_shape_invalid");
  for(const row of request.rows){
    if(row.address!==first.address||row.day!==first.day||row.selected_at!==first.selected_at||Buffer.byteLength(row.payload)>2000000)throw Error("publication_cohort_scope_invalid");
    const payload=JSON.parse(row.payload);
    if(createHash("sha256").update(row.payload).digest("hex")!==row.input_hash||payload.candidate?.address!==row.address||payload.selected_at!==row.selected_at||(row.kind==="wallet"&&payload.cohort_kind!=="first_wallet_sample")||(row.kind==="selection"&&payload.candidate?.eligibility!=="eligible")||(row.kind==="cohort"&&row.recommended!==(payload.candidate?.eligibility==="eligible"?1:0)))throw Error("publication_cohort_payload_mismatch");
  }
  const {db,body}=await opened(options);let attempted=false;
  try{
    db.exec("BEGIN IMMEDIATE");fenced(db,body,grant);
    if(!db.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(request.publication_id))throw Error("publication_cohort_parent_uncommitted");
    const results=request.rows.map(row=>{
      const table=row.kind==="cohort"?"tenx_cohorts":row.kind==="wallet"?"tenx_wallet_cohorts":"tenx_selections",columns=row.kind==="cohort"?"day,address,selected_at,recommended,input_hash,payload":"day,address,selected_at,input_hash,payload",bindings=row.kind==="cohort"?[row.day,row.address,row.selected_at,row.recommended,row.input_hash,row.payload]:[row.day,row.address,row.selected_at,row.input_hash,row.payload];
      const result=db.prepare(`INSERT OR IGNORE INTO ${table}(${columns}) VALUES(${bindings.map(()=>"?").join(",")})`).run(...bindings);
      return {success:true,results:[],meta:{changes:Number(result.changes)}};
    });
    attempted=true;db.exec("COMMIT");return {state:"committed",results,...inactive()};
  }catch(error){const uncertain=attempted&&!db.isTransaction;if(db.isTransaction)db.exec("ROLLBACK");if(uncertain)throw Error("publication_cohort_acknowledgement_unknown");throw error;}finally{db.close();}
}
