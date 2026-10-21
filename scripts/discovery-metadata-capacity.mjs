// Private offline allocation study. Its deliberately incomplete schema is NEVER a runtime store.
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {copyFile,constants,chmod,lstat,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";
import {verifyArchive,hashFile} from "./discovery-archive.mjs";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {verifyEvidenceReferences} from "./discovery-evidence-references.mjs";
import {admittedManifest} from "./lib/evidence-reference-proof.mjs";

const VERSION="discovery-metadata-capacity-v1",FILE="capacity.sqlite",REPORT="capacity.json";
const MAX_DB=2*1024**3,MAX_ROWS=1000000,ROW_LIMIT=2000000,DB_LIMIT=500000000;
const COLUMNS={tenx_holder_evidence:["payload_hash","address","slot","payload","observed_at"],tenx_wallet_evidence:["payload_hash","address","payload","observed_at"]};
const quote=s=>'"'+s.replaceAll('"','""')+'"',sha=v=>createHash("sha256").update(v).digest("hex"),digest=v=>sha(JSON.stringify(v));
const inside=(a,b)=>a===b||b.startsWith(a+path.sep);
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
const columns=(db,table)=>db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all();
const exact=b=>new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(b);
async function standalone(file){for(const suffix of ["-wal","-shm","-journal"]){try{await lstat(file+suffix);}catch(e){if(e.code==="ENOENT")continue;throw e;}throw Error("Frozen standalone database required");}}
async function separate(file){
  const root=await realpath(".tmp");
  for(let parent=path.dirname(file);inside(root,parent);parent=path.dirname(parent)){
    for(const marker of ["manifest.json","pack.json","objects.json","sealed.json","index.json","references.json",REPORT]){
      try{await lstat(path.join(parent,marker));}catch(e){if(e.code==="ENOENT")continue;throw e;}throw Error("Separate output outside existing artifacts required");
    }if(parent===root)break;
  }
}
function integrity(db){if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok"||db.prepare("PRAGMA foreign_key_check").all().length)throw Error("Capacity database integrity/foreign keys failed");}
// Multiset fingerprints use exact stored types and bytes, independent of scan order/VACUUM rowids.
function inventory(db,deadline,omitPayload=false){
  const entries=schema(db),alloc=new Map(db.prepare("SELECT name,sum(pgsize) AS bytes,max(mx_payload) AS max_record FROM dbstat GROUP BY name").all().map(r=>[r.name,r]));
  let total=0;
  return entries.filter(r=>r.type==="table").map(({name,sql})=>{
    if(/CREATE\s+VIRTUAL\s+TABLE/i.test(sql??""))throw Error("Virtual tables need a separate capacity contract");
    const names=columns(db,name).map(c=>c.name).filter(c=>!(omitPayload&&Object.hasOwn(COLUMNS,name)&&c==="payload"));
    const query=names.flatMap((c,i)=>[`typeof(${quote(c)}) AS t${i}`,`CASE WHEN typeof(${quote(c)}) IN ('text','blob') THEN CAST(${quote(c)} AS BLOB) ELSE ${quote(c)} END AS v${i}`]);
    const statement=db.prepare(`SELECT ${query.join(",")} FROM ${quote(name)}`);statement.setReadBigInts(true);
    const hashes=[];let largestValue=0,largestRow=0,logical=0;
    for(const row of statement.iterate()){
      if(++total>MAX_ROWS||performance.now()>deadline)throw Error("Capacity row/deadline bound exceeded");
      const h=createHash("sha256");let bytes=0;
      names.forEach((_,i)=>{
        const type=row['t'+i],v=row['v'+i];let raw;
        if(type==="text"||type==="blob")raw=Buffer.from(v);
        else if(type==="null")raw=Buffer.alloc(0);
        else if(type==="integer")raw=Buffer.from(String(v));
        else if(type==="real"){raw=Buffer.alloc(8);raw.writeDoubleBE(v);}
        else throw Error("Unknown stored value type");
        h.update(type+":"+raw.length+":");h.update(raw);bytes+=raw.length;largestValue=Math.max(largestValue,raw.length);
      });hashes.push(h.digest("hex"));largestRow=Math.max(largestRow,bytes);logical+=bytes;
    }
    return {table:name,columns:names,rows:hashes.length,values_sha256:digest(hashes.sort()),logical_value_bytes:logical,max_value_bytes:largestValue,max_row_value_bytes:largestRow,
      table_bytes:alloc.get(name)?.bytes??0,index_bytes:entries.filter(r=>r.type==="index"&&r.tbl_name===name).reduce((n,r)=>n+(alloc.get(r.name)?.bytes??0),0),max_table_record_bytes:alloc.get(name)?.max_record??0};
  });
}
function preservation(rows){return rows.map(({table,columns,rows,values_sha256})=>({table,columns,rows,values_sha256}));}
function evidenceMatches(source,refs){
  let count=0,rawBytes=0;const objects=new Map();
  for(const [table,names] of Object.entries(COLUMNS)){
    if(columns(source,table).map(c=>c.name).join("|")!==names.join("|"))throw Error("Unsupported original evidence layout");
    for(const saved of source.prepare(`SELECT ${names.map(c=>c==="slot"?quote(c):`CAST(${quote(c)} AS BLOB) AS ${quote(c)}`).join(",")} FROM ${quote(table)}`).iterate()){
      if(++count>10000)throw Error("Evidence population bound exceeded");
      const row=Object.fromEntries(names.map(c=>[c,c==="slot"?saved[c]:exact(saved[c])])),identity=row.payload_hash;
      const found=refs.prepare("SELECT reference_json FROM evidence_references WHERE table_name=? AND identity=?").get(table,identity);
      if(!found)throw Error("Missing original reference");const ref=JSON.parse(found.reference_json),raw=Buffer.from(saved.payload);
      if(!isDeepStrictEqual(ref.entry.metadata,names.filter(c=>c!=="payload").map(c=>row[c]))||ref.entry.row_sha256!==digest(row)||ref.object.sha256!==sha(raw)||ref.object.bytes!==raw.length)throw Error("Original row/reference mismatch");
      rawBytes+=raw.length;objects.set(ref.object.sha256,ref.sealed.bytes);
    }
  }
  if(refs.prepare("SELECT count(*) AS n FROM evidence_references").get().n!==count)throw Error("Reference population mismatch");
  return {rows:count,raw_payload_bytes:rawBytes,unique_objects:objects.size,encrypted_object_bytes:[...objects.values()].reduce((n,b)=>n+b,0),ciphertext_objects_verified:false};
}
export async function studyMetadataCapacity(archiveDirectory,archivePin,referenceDirectory,referencePin,target){
  const sourceFolder=await evidencePrivatePath(archiveDirectory),refFolder=await evidencePrivatePath(referenceDirectory),output=await evidencePrivatePath(target,true);
  if([sourceFolder,refFolder].some(f=>inside(f,output)||inside(output,f)))throw Error("Separate output required");await separate(output);
  const sourceFile=await evidenceRegularFile(path.join(sourceFolder,"discovery.sqlite"),MAX_DB);await standalone(sourceFile.file);
  const archive=await verifyArchive(sourceFolder,archivePin);await verifyEvidenceReferences(refFolder,referencePin);
  const manifest=admittedManifest(JSON.parse(await readFile(path.join(refFolder,"references.json"),"utf8")),referencePin);
  if(manifest.context.source_archive_manifest_sha256!==archivePin)throw Error("Reference source archive mismatch");
  const source=new DatabaseSync(sourceFile.file,{readOnly:true}),refs=new DatabaseSync(path.join(refFolder,"references.sqlite"),{readOnly:true});let before,evidence,originalSchema;
  const deadline=performance.now()+300000;
  try{source.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");refs.exec("PRAGMA query_only=ON; BEGIN");evidence=evidenceMatches(source,refs);before=inventory(source,deadline,true);originalSchema=schema(source);}finally{source.close();refs.close();}
  await mkdir(output,{mode:0o700});const file=path.join(output,FILE);
  await copyFile(sourceFile.file,file,constants.COPYFILE_EXCL);await chmod(file,0o600);
  const db=new DatabaseSync(file);let after,pageSize,pageCount,freePages,allocations,projectedSchema;
  try{
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    for(const table of Object.keys(COLUMNS))db.exec(`ALTER TABLE ${quote(table)} DROP COLUMN payload`);
    db.exec("COMMIT; VACUUM");integrity(db);projectedSchema=schema(db);
    const untouched=s=>s.filter(r=>!(r.type==="table"&&Object.hasOwn(COLUMNS,r.name)));
    if(!isDeepStrictEqual(untouched(originalSchema),untouched(projectedSchema)))throw Error("Unexpected schema change");
    after=inventory(db,deadline);if(!isDeepStrictEqual(preservation(before),preservation(after)))throw Error("Original metadata/non-evidence values changed");
    pageSize=db.prepare("PRAGMA page_size").get().page_size;pageCount=db.prepare("PRAGMA page_count").get().page_count;freePages=db.prepare("PRAGMA freelist_count").get().freelist_count;
    allocations=db.prepare("SELECT name,pagetype,count(*) AS pages,sum(pgsize) AS bytes FROM dbstat GROUP BY name,pagetype ORDER BY name,pagetype").all().map(r=>({...r}));
  }finally{db.close();}
  await standalone(file);await standalone(sourceFile.file);
  if(await hashFile(sourceFile.file)!==archive.database.sha256||await hashFile(path.join(refFolder,"references.sqlite"))!==manifest.database.sha256)throw Error("Frozen inputs changed");
  const bytes=(await lstat(file)).size,combined=bytes+manifest.database.bytes;
  const blockers=after.filter(r=>Math.max(r.max_value_bytes,r.max_row_value_bytes,r.max_table_record_bytes)>ROW_LIMIT).map(r=>r.table);
  const body={version:VERSION,confidentiality:"private_full_metadata_including_sessions_and_research",source_archive_manifest_sha256:archivePin,reference_manifest_sha256:referencePin,
    snapshot_started_at:archive.snapshot_started_at,snapshot_completed_at:archive.snapshot_completed_at,source_database_sha256:archive.database.sha256,source_schema_sha256:archive.storage.schema_sha256,
    source_database_bytes:archive.database.bytes,reference_database_bytes:manifest.database.bytes,database:{file:FILE,bytes,sha256:await hashFile(file)},
    projected_schema_sha256:digest(projectedSchema),page_size:pageSize,page_count:pageCount,free_pages:freePages,allocations,inventory:after,evidence,
    all_original_metadata_verified:true,all_non_evidence_values_verified:true,combined_two_database_bytes:combined,
    capacity_screen:{database_limit_bytes:DB_LIMIT,row_limit_bytes:ROW_LIMIT,conservative_combined_headroom_bytes:DB_LIMIT-combined,combined_below_limit:combined<=DB_LIMIT,row_blocker_tables:blockers,
      d1_import_accepted:false,account_entitlement_verified:false,shared_costs_accepted:false},
    growth:{chronological_snapshots:1,observed_growth:null,forecast:null},raw_resolution_replay_accepted:false,free_acceptance:false,runtime_activated:false,network_requests:0,action_authority:false};
  const report={...body,capacity_manifest_sha256:digest(body)};await writeFile(path.join(output,REPORT),JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});return report;
}
export async function verifyMetadataCapacity(directory,pin){
  const folder=await evidencePrivatePath(directory),saved=await evidenceRegularFile(path.join(folder,REPORT),1024**2),report=JSON.parse(await readFile(saved.file,"utf8")),{capacity_manifest_sha256,...body}=report;
  if(!/^[a-f0-9]{64}$/.test(pin??"")||capacity_manifest_sha256!==pin||digest(body)!==pin||body.version!==VERSION||body.database?.file!==FILE||body.runtime_activated!==false||body.free_acceptance!==false)throw Error("Capacity report pin/contract mismatch");
  const file=await evidenceRegularFile(path.join(folder,FILE),MAX_DB);await standalone(file.file);
  if(file.bytes!==body.database.bytes||await hashFile(file.file)!==body.database.sha256)throw Error("Capacity database pin mismatch");
  const db=new DatabaseSync(file.file,{readOnly:true});try{db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");integrity(db);
    if(digest(schema(db))!==body.projected_schema_sha256||!isDeepStrictEqual(inventory(db,performance.now()+300000),body.inventory))throw Error("Capacity inventory mismatch");
  }finally{db.close();}if(await hashFile(file.file)!==body.database.sha256)throw Error("Capacity database changed");return report;
}
export async function compareMetadataCapacity(beforeDirectory,beforePin,afterDirectory,afterPin){
  const a=await verifyMetadataCapacity(beforeDirectory,beforePin),b=await verifyMetadataCapacity(afterDirectory,afterPin),elapsed=Date.parse(b.snapshot_started_at)-Date.parse(a.snapshot_completed_at);
  if(!Number.isFinite(elapsed)||elapsed<=0)throw Error("Growth needs nonoverlapping chronological admitted archives");
  const aa=new Map(a.inventory.map(r=>[r.table,r])),bb=new Map(b.inventory.map(r=>[r.table,r]));
  return {version:"discovery-metadata-growth-v1",before_capacity_manifest_sha256:beforePin,after_capacity_manifest_sha256:afterPin,minimum_elapsed_ms:elapsed,
    lineage:"operator_selected_same_store_not_independently_verified",source_schema_changed:a.source_schema_sha256!==b.source_schema_sha256,
    metadata_bytes_delta:b.database.bytes-a.database.bytes,reference_bytes_delta:b.reference_database_bytes-a.reference_database_bytes,
    combined_bytes_delta:b.combined_two_database_bytes-a.combined_two_database_bytes,encrypted_object_bytes_delta:b.evidence.encrypted_object_bytes-a.evidence.encrypted_object_bytes,
    tables:[...new Set([...aa.keys(),...bb.keys()])].sort().map(table=>({table,state:!aa.has(table)?"added":!bb.has(table)?"removed":"retained",rows_delta:(bb.get(table)?.rows??0)-(aa.get(table)?.rows??0),
      allocated_bytes_delta:(bb.get(table)?.table_bytes??0)+(bb.get(table)?.index_bytes??0)-(aa.get(table)?.table_bytes??0)-(aa.get(table)?.index_bytes??0)})),
    forecast:null,retention_approved:false,free_acceptance:false,runtime_activated:false,network_requests:0};
}
async function main([action,...args]){
  if(action==="study"&&args.length===5){const r=await studyMetadataCapacity(...args);return {capacity_manifest_sha256:r.capacity_manifest_sha256,database_bytes:r.database.bytes,combined_two_database_bytes:r.combined_two_database_bytes,evidence_rows:r.evidence.rows,row_blocker_tables:r.capacity_screen.row_blocker_tables,runtime_activated:false,free_acceptance:false};}
  if(action==="verify"&&args.length===2){const r=await verifyMetadataCapacity(...args);return {capacity_manifest_sha256:r.capacity_manifest_sha256,verified:true,runtime_activated:false};}
  if(action==="compare"&&args.length===5){const out=await evidencePrivatePath(args[4],true);await separate(out);if(!out.endsWith(".json"))throw Error("New private JSON output required");const r=await compareMetadataCapacity(...args.slice(0,4));await writeFile(out,JSON.stringify(r,null,2)+"\n",{flag:"wx",mode:0o600});return {file_sha256:await hashFile(out),runtime_activated:false,forecast:null};}
  throw Error("Usage: study ARCHIVE ARCHIVE_PIN REFERENCES REFERENCE_PIN NEW_PRIVATE_DIRECTORY | verify STUDY STUDY_PIN | compare BEFORE PIN AFTER PIN NEW_PRIVATE_JSON");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error("Private capacity study held. Check frozen input pins, separate private paths, schema and preservation checks. Partial artifacts retained; no runtime activated.");process.exitCode=1;});
