// Private, plaintext-metadata scratch index. No live adoption or remote IO.
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {lstat,mkdir,open,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {hashFile} from "./discovery-archive.mjs";
import {evidencePrivatePath,evidenceRegularFile,validateEvidenceCatalog,restoreEvidenceRow,decodeEvidenceBytes} from "./discovery-evidence-objects.mjs";
import {verifySealedEvidence,readSealedIndexMaterial,readSealedEnvelope,decryptEvidenceCiphertext} from "./discovery-evidence-sealed.mjs";

const VERSION="discovery-evidence-index-v1",DB="evidence-index.sqlite",MAX_DB=64*1024**2;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),digest=value=>sha(JSON.stringify(value));
const Hash=z.string().length(64).regex(/^[a-f0-9]{64}$/),Count=z.number().int().nonnegative().max(10000);
const Body=z.object({version:z.literal(VERSION),confidentiality:z.literal("private_plaintext_metadata"),
  source_sealed_manifest_sha256:Hash,source_catalog_manifest_sha256:Hash,source_archive_manifest_sha256:Hash,
  database:z.object({file:z.literal(DB),bytes:z.number().int().positive().max(MAX_DB),sha256:Hash}).strict(),rows:Count,objects:Count}).strict();
const Descriptor=z.object({sha256:Hash,bytes:z.number().int().positive().max(2100000),iv:z.string().length(24).regex(/^[a-f0-9]{24}$/),tag:z.string().length(32).regex(/^[a-f0-9]{32}$/)}).strict();
const Original=z.object({sha256:Hash,bytes:z.number().int().nonnegative().max(2000000),gzip_bytes:z.number().int().positive().max(2100000),gzip_sha256:Hash}).strict();
const Text=z.string().max(4096),Identity=Text.min(1);
const Entry=z.discriminatedUnion("table",[
  z.object({table:z.literal("tenx_holder_evidence"),metadata:z.tuple([Identity,Text,z.number().int().safe(),Text]),object_sha256:Hash,row_sha256:Hash}).strict(),
  z.object({table:z.literal("tenx_wallet_evidence"),metadata:z.tuple([Identity,Text,Text]),object_sha256:Hash,row_sha256:Hash}).strict(),
]);
const SCHEMA=[
  ["table","evidence_meta",`CREATE TABLE evidence_meta(id INTEGER PRIMARY KEY CHECK(id=1),header_json TEXT NOT NULL) STRICT`],
  ["table","evidence_objects",`CREATE TABLE evidence_objects(raw_sha256 TEXT PRIMARY KEY,ordinal INTEGER NOT NULL UNIQUE,original_json TEXT NOT NULL,sealed_json TEXT NOT NULL) WITHOUT ROWID, STRICT`],
  ["table","evidence_rows",`CREATE TABLE evidence_rows(table_name TEXT NOT NULL,identity TEXT NOT NULL,address TEXT NOT NULL,observed_at TEXT NOT NULL,raw_sha256 TEXT NOT NULL REFERENCES evidence_objects(raw_sha256),ordinal INTEGER NOT NULL UNIQUE,entry_json TEXT NOT NULL,PRIMARY KEY(table_name,identity)) WITHOUT ROWID, STRICT`],
  ["index","evidence_rows_by_address",`CREATE INDEX evidence_rows_by_address ON evidence_rows(table_name,address,observed_at,identity)`],
];
export const EVIDENCE_INDEX_LOOKUP_SQL=`SELECT r.entry_json,o.original_json,o.sealed_json FROM evidence_rows r JOIN evidence_objects o ON o.raw_sha256=r.raw_sha256 WHERE r.table_name=? AND r.identity=?`;
const HISTORY_SQL=`SELECT identity FROM evidence_rows WHERE table_name=? AND address=? ORDER BY observed_at,identity LIMIT ?`;
const inside=(folder,file)=>file===folder||file.startsWith(folder+path.sep);

function descriptorPair(object,sealed){
  Original.parse(object);Descriptor.parse(sealed);
  if(object.gzip_bytes!==sealed.bytes)throw Error("Indexed descriptor size mismatch");
}
function schemaCheck(db){
  const actual=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>[r.type,r.name,r.sql]);
  if(digest(actual)!==digest([...SCHEMA].sort((a,b)=>a[1]<b[1]?-1:1)))throw Error("Unsupported evidence index schema");
}
async function noSidecars(file){
  for(const suffix of ["-wal","-shm","-journal"]){
    try{await lstat(file+suffix);}catch(error){if(error.code==="ENOENT")continue;throw error;}
    throw Error("Evidence index must be a frozen standalone file");
  }
}
function metadata(db,m){
  const rows=db.prepare("SELECT header_json FROM evidence_meta").all();
  if(rows.length!==1)throw Error("Missing evidence index metadata");
  const value=JSON.parse(rows[0].header_json);
  const expected=z.object({source_header:z.unknown(),source_sealed_manifest_sha256:Hash,source_catalog_manifest_sha256:Hash}).strict().parse(value);
  if(expected.source_sealed_manifest_sha256!==m.source_sealed_manifest_sha256||expected.source_catalog_manifest_sha256!==m.source_catalog_manifest_sha256||expected.source_header?.source_manifest_sha256!==m.source_archive_manifest_sha256)throw Error("Evidence index source mismatch");
  return value;
}
async function opened(directory,pin){
  const folder=await evidencePrivatePath(directory),file=await evidenceRegularFile(path.join(folder,"index.json"),4096);
  const manifest=JSON.parse(await readFile(file.file,"utf8")),{index_manifest_sha256,...body}=manifest;
  if(!/^[a-f0-9]{64}$/.test(pin??"")||index_manifest_sha256!==pin||digest(body)!==pin)throw Error("Evidence index manifest checksum mismatch");
  Body.parse(body);
  const saved=await evidenceRegularFile(path.join(folder,DB),MAX_DB);await noSidecars(saved.file);
  if(saved.bytes!==manifest.database.bytes||await hashFile(saved.file)!==manifest.database.sha256)throw Error("Evidence index database checksum/size mismatch");
  const db=new DatabaseSync(saved.file,{readOnly:true});
  try{db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");schemaCheck(db);const header=metadata(db,manifest);return {folder,file:saved.file,db,manifest,header};}
  catch(error){db.close();throw error;}
}
async function unchanged(index){
  await noSidecars(index.file);
  if(await hashFile(index.file)!==index.manifest.database.sha256)throw Error("Evidence index changed during read");
}

function reconstructed(db,m,header){
  if(db.prepare("SELECT count(*) AS n FROM evidence_objects").get().n!==m.objects||db.prepare("SELECT count(*) AS n FROM evidence_rows").get().n!==m.rows)throw Error("Incomplete evidence index population");
  const objects=[],entries=[],nonces=new Set(),cipherHashes=new Set();
  for(const saved of db.prepare("SELECT * FROM evidence_objects ORDER BY ordinal").iterate()){
    const object=JSON.parse(saved.original_json),sealed=JSON.parse(saved.sealed_json);descriptorPair(object,sealed);
    if(saved.ordinal!==objects.length||saved.raw_sha256!==object.sha256||nonces.has(sealed.iv)||cipherHashes.has(sealed.sha256))throw Error("Invalid indexed object identity/order");
    nonces.add(sealed.iv);cipherHashes.add(sealed.sha256);objects.push(object);
  }
  // Indexed identity/address/time may contain NULs: compare SQLite bytes, never
  // ordinary Node SQLite text conversion, against complete JSON metadata.
  for(const saved of db.prepare("SELECT table_name,CAST(identity AS BLOB) AS identity,CAST(address AS BLOB) AS address,CAST(observed_at AS BLOB) AS observed_at,raw_sha256,ordinal,entry_json FROM evidence_rows ORDER BY ordinal").iterate()){
    const entry=JSON.parse(saved.entry_json);Entry.parse(entry);
    const matches=(bytes,value)=>Buffer.from(bytes).equals(Buffer.from(value));
    if(saved.ordinal!==entries.length)throw Error("Indexed row order mismatch");
    if(entry.table!==saved.table_name||entry.object_sha256!==saved.raw_sha256||!matches(saved.identity,entry.metadata[0])||!matches(saved.address,entry.metadata[1])||!matches(saved.observed_at,entry.metadata.at(-1)))throw Error("Indexed metadata mismatch");
    entries.push(entry);
  }
  if(objects.length!==m.objects||entries.length!==m.rows)throw Error("Incomplete evidence index population");
  const value={...header.source_header,objects,entries,catalog_manifest_sha256:m.source_catalog_manifest_sha256};
  validateEvidenceCatalog(value,m.source_catalog_manifest_sha256);
  return value;
}
function statistics(db,m){
  const pageSize=db.prepare("PRAGMA page_size").get().page_size,pageCount=db.prepare("PRAGMA page_count").get().page_count;
  const allocations=db.prepare("SELECT name,count(*) AS pages,sum(pgsize) AS bytes,sum(payload) AS record_payload_bytes,max(mx_payload) AS largest_cell_payload_bytes FROM dbstat GROUP BY name ORDER BY name").all();
  return {database_bytes:m.database.bytes,page_size:pageSize,page_count:pageCount,freelist_pages:db.prepare("PRAGMA freelist_count").get().freelist_count,allocations,
    largest_cell_payload_bytes:Math.max(...allocations.map(r=>r.largest_cell_payload_bytes)),
    lookup_plan:db.prepare("EXPLAIN QUERY PLAN "+EVIDENCE_INDEX_LOOKUP_SQL).all("tenx_holder_evidence","probe").map(r=>r.detail),
    address_history_plan:db.prepare("EXPLAIN QUERY PLAN "+HISTORY_SQL).all("tenx_holder_evidence","probe",25).map(r=>r.detail)};
}
export async function verifyEvidenceIndex(directory,pin){
  const index=await opened(directory,pin);
  try{
    if(index.db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok"||index.db.prepare("PRAGMA foreign_key_check").all().length)throw Error("Evidence index SQLite integrity failure");
    reconstructed(index.db,index.manifest,index.header);const stats=statistics(index.db,index.manifest);await unchanged(index);
    return {index_manifest_sha256:pin,rows:index.manifest.rows,objects:index.manifest.objects,...stats,all_index_metadata_verified:true,payload_objects_verified:false,plaintext_metadata:true,network_requests:0,runtime_activated:false,action_authority:false};
  }finally{index.db.close();}
}

export async function buildEvidenceIndex(directory,sealedPin,keyFile,target){
  const source=await evidencePrivatePath(directory),output=await evidencePrivatePath(target,true);
  if(inside(source,output)||inside(output,source))throw Error("Index destination must be separate from the sealed pack");
  await verifySealedEvidence(source,sealedPin,keyFile);
  const material=await readSealedIndexMaterial(source,sealedPin,keyFile),catalog=material.source_catalog;
  const {objects,entries,catalog_manifest_sha256,...source_header}=catalog,byRaw=new Map(material.objects.map(o=>[o.raw_sha256,o.sealed]));
  await mkdir(output,{mode:0o700});const file=path.join(output,DB),handle=await open(file,"wx",0o600);await handle.close();
  const db=new DatabaseSync(file),started=performance.now(),deadline=started+300000;let inserted,stats;
  try{
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE");for(const row of SCHEMA)db.exec(row[2]);
    db.prepare("INSERT INTO evidence_meta VALUES(1,?)").run(JSON.stringify({source_header,source_sealed_manifest_sha256:sealedPin,source_catalog_manifest_sha256:catalog_manifest_sha256}));
    const addObject=db.prepare("INSERT INTO evidence_objects VALUES(?,?,?,?)"),addRow=db.prepare("INSERT INTO evidence_rows VALUES(?,?,?,?,?,?,?)");
    objects.forEach((object,i)=>{descriptorPair(object,byRaw.get(object.sha256));addObject.run(object.sha256,i,JSON.stringify(object),JSON.stringify(byRaw.get(object.sha256)));});
    entries.forEach((entry,i)=>{if(performance.now()>deadline)throw Error("Index construction deadline exceeded");addRow.run(entry.table,entry.metadata[0],entry.metadata[1],entry.metadata.at(-1),entry.object_sha256,i,JSON.stringify(entry));});
    inserted=db.prepare("SELECT total_changes() AS n").get().n;db.exec("COMMIT");
    // Reconstruct the full original catalog before sealing this new index.
    const partial={rows:entries.length,objects:objects.length,source_catalog_manifest_sha256:catalog_manifest_sha256};
    reconstructed(db,partial,{source_header});schemaCheck(db);
    if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok"||db.prepare("PRAGMA foreign_key_check").all().length)throw Error("New evidence index integrity failure");
    const bytes=db.prepare("PRAGMA page_size").get().page_size*db.prepare("PRAGMA page_count").get().page_count;
    stats=statistics(db,{database:{bytes}});
  }finally{db.close();}
  await noSidecars(file);const info=await evidenceRegularFile(file,MAX_DB);
  if(info.bytes!==stats.database_bytes)throw Error("New index allocation changed");
  const body={version:VERSION,confidentiality:"private_plaintext_metadata",source_sealed_manifest_sha256:sealedPin,source_catalog_manifest_sha256:catalog_manifest_sha256,
    source_archive_manifest_sha256:catalog.source_manifest_sha256,database:{file:DB,bytes:info.bytes,sha256:await hashFile(file)},rows:entries.length,objects:objects.length};Body.parse(body);
  const manifest={...body,index_manifest_sha256:digest(body)};
  await writeFile(path.join(output,"index.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
  return {index_manifest_sha256:manifest.index_manifest_sha256,rows:entries.length,objects:objects.length,...stats,all_index_metadata_verified:true,payload_objects_verified:false,
    plaintext_metadata:true,network_requests:0,runtime_activated:false,action_authority:false,source_payloads_verified_at_build:true,sql_rows_inserted:inserted,
    index_build_elapsed_ms_excluding_source_verification:performance.now()-started};
}

export async function readIndexedEvidenceRow(indexDirectory,indexPin,sealedDirectory,keyFile,table,identity){
  const index=await opened(indexDirectory,indexPin);let key;
  try{
    if(!["tenx_holder_evidence","tenx_wallet_evidence"].includes(table)||typeof identity!=="string"||identity.length>4096)throw Error("Unsupported indexed evidence identity");
    const saved=index.db.prepare(EVIDENCE_INDEX_LOOKUP_SQL).get(table,identity);
    if(!saved)throw Error("Evidence row not in pinned index");
    const entry=JSON.parse(saved.entry_json),object=JSON.parse(saved.original_json),sealed=JSON.parse(saved.sealed_json);Entry.parse(entry);descriptorPair(object,sealed);
    if(entry.table!==table||entry.metadata[0]!==identity||entry.object_sha256!==object.sha256)throw Error("Selected evidence identity mismatch");
    const envelope=await readSealedEnvelope(sealedDirectory,index.manifest.source_sealed_manifest_sha256);
    const keyInfo=await evidenceRegularFile(keyFile,32);
    if(keyInfo.bytes!==32||inside(envelope.folder,keyInfo.file)||inside(index.folder,keyInfo.file))throw Error("A separate evidence key is required");
    key=await readFile(keyInfo.file);if(key.length!==32)throw Error("Evidence key length changed");
    const file=await evidenceRegularFile(path.join(envelope.folder,"objects",sealed.sha256+".bin"),2100000);
    if(file.bytes!==sealed.bytes)throw Error("Encrypted indexed object size mismatch");
    const compressed=decryptEvidenceCiphertext(await readFile(file.file),sealed,key,"object|"+object.sha256),payload=decodeEvidenceBytes(compressed,object),row=restoreEvidenceRow(entry,payload);
    await unchanged(index);
    return {index_manifest_sha256:indexPin,catalog_manifest_sha256:index.manifest.source_catalog_manifest_sha256,source_manifest_sha256:index.manifest.source_archive_manifest_sha256,
      row,row_sha256:entry.row_sha256,table,objects_read:1,encrypted_catalog_bytes_read:0,encrypted_object_bytes_read:file.bytes,index_bytes_hashed:2*index.manifest.database.bytes,
      other_objects_verified:false,action_authority:false,runtime_activated:false};
  }finally{key?.fill(0);index.db.close();}
}

async function main([action,...args]){
  if(action==="build"&&args.length===4)return buildEvidenceIndex(...args);
  if(action==="verify"&&args.length===2)return verifyEvidenceIndex(...args);
  if(action==="lookup"&&args.length===7){
    const output=await evidencePrivatePath(args[6],true),index=await evidencePrivatePath(args[0]),sealed=await evidencePrivatePath(args[2]);
    if(!output.endsWith(".json")||inside(index,output)||inside(sealed,output))throw Error("Separate new private JSON export required");
    const row=await readIndexedEvidenceRow(...args.slice(0,6)),text=JSON.stringify(row,null,2)+"\n";await writeFile(output,text,{flag:"wx",mode:0o600});
    return {file_sha256:sha(text),objects_read:1,encrypted_catalog_bytes_read:0,other_objects_verified:false,plaintext_export:true,network_requests:0,runtime_activated:false,action_authority:false};
  }
  throw Error("Usage: build SEALED SEALED_PIN KEY NEW_PRIVATE_DIRECTORY | verify INDEX INDEX_PIN | lookup INDEX INDEX_PIN SEALED KEY TABLE PAYLOAD_HASH NEW_PRIVATE_JSON");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2))
  .then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(()=>{console.error("Private evidence index operation failed; no runtime activated. Check independent pins, private paths, source integrity and separate key.");process.exitCode=1;});
