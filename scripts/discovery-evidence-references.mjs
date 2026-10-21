// Private offline Merkle references. No runtime adoption, remote IO or new keys.
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {lstat,mkdir,open,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createReferenceTree,verifyReferenceProof,admittedManifest,canonicalContext,canonicalLeaf,MAX_REFERENCE,MAX_PROOF} from "./lib/evidence-reference-proof.mjs";
export {createReferenceTree,verifyReferenceProof} from "./lib/evidence-reference-proof.mjs";
import {hashFile} from "./discovery-archive.mjs";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {EvidenceEntry,EvidenceObject,EvidenceCipherDescriptor,canonicalEvidenceReference,readEvidenceIndexMaterial,recoverEvidenceReference} from "./discovery-evidence-index.mjs";

const VERSION="discovery-evidence-references-v1",ALGORITHM="sha256-domain-separated-duplicate-last-v1";
const DB="references.sqlite",MAX_DB=64*1024**2;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),digest=value=>sha(JSON.stringify(value));
const SCHEMA=`CREATE TABLE evidence_references(table_name TEXT NOT NULL,identity TEXT NOT NULL,ordinal INTEGER PRIMARY KEY,reference_json TEXT NOT NULL,proof_json TEXT NOT NULL,UNIQUE(table_name,identity)) STRICT`;
export const REFERENCE_LOOKUP_SQL=`SELECT ordinal,length(CAST(reference_json AS BLOB)) AS reference_bytes,length(CAST(proof_json AS BLOB)) AS proof_bytes,CASE WHEN length(CAST(reference_json AS BLOB))<=${MAX_REFERENCE} THEN reference_json END AS reference_json,CASE WHEN length(CAST(proof_json AS BLOB))<=${MAX_PROOF} THEN proof_json END AS proof_json FROM evidence_references WHERE table_name=? AND identity=?`;
const inside=(folder,file)=>file===folder||file.startsWith(folder+path.sep);

async function separateOutput(output){
  const root=await realpath(".tmp");
  for(let parent=path.dirname(output);inside(root,parent);parent=path.dirname(parent)){
    for(const marker of ["sealed.json","objects.json","index.json","references.json","manifest.json","pack.json"]){
      try{await lstat(path.join(parent,marker));}catch(error){if(error.code==="ENOENT")continue;throw error;}
      throw Error("Reference output cannot be nested inside an existing evidence artifact");
    }
    if(parent===root)break;
  }
}

async function noSidecars(file){
  for(const suffix of ["-wal","-shm","-journal"]){try{await lstat(file+suffix);}catch(error){if(error.code==="ENOENT")continue;throw error;}throw Error("Reference index must be standalone");}
}
function schemaCheck(db){
  const rows=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
  if(rows.length!==1||rows[0].type!=="table"||rows[0].name!=="evidence_references"||rows[0].sql!==SCHEMA)throw Error("Unsupported reference database schema");
}
async function opened(directory,pin,full=false){
  const folder=await evidencePrivatePath(directory),file=await evidenceRegularFile(path.join(folder,"references.json"),4096),manifest=admittedManifest(JSON.parse(await readFile(file.file,"utf8")),pin);
  const saved=await evidenceRegularFile(path.join(folder,DB),MAX_DB);await noSidecars(saved.file);
  if(full&&(saved.bytes!==manifest.database.bytes||await hashFile(saved.file)!==manifest.database.sha256))throw Error("Reference database checksum/size mismatch");
  const db=new DatabaseSync(saved.file,{readOnly:true});try{db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");schemaCheck(db);return {folder,file:saved.file,db,manifest};}catch(error){db.close();throw error;}
}
function selected(db,table,identity){
  const saved=db.prepare(REFERENCE_LOOKUP_SQL).get(table,identity);
  if(!saved)throw Error("Reference absent; no proof of original absence");
  if(!saved.reference_json||!saved.proof_json||saved.reference_bytes>MAX_REFERENCE||saved.proof_bytes>MAX_PROOF)throw Error("Oversized reference/proof data");
  const reference=JSON.parse(saved.reference_json),proof=JSON.parse(saved.proof_json);
  if(reference.ordinal!==saved.ordinal)throw Error("Indexed reference ordinal mismatch");
  return {reference,proof,reference_bytes:saved.reference_bytes,proof_bytes:saved.proof_bytes};
}
function verifyAll(db,manifest,pin){
  if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok"||db.prepare("SELECT count(*) AS n FROM evidence_references").get().n!==manifest.context.rows)throw Error("Reference database integrity/population mismatch");
  const references=[],rawObjects=new Set(),deadline=performance.now()+300000;
  for(const row of db.prepare("SELECT table_name,CAST(identity AS BLOB) AS identity FROM evidence_references ORDER BY ordinal").iterate()){
    if(performance.now()>deadline)throw Error("Full reference verification deadline exceeded");
    const identity=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(row.identity),saved=selected(db,row.table_name,identity),value=verifyReferenceProof(manifest,pin,saved.reference,saved.proof,row.table_name,identity);
    if(value.ordinal!==references.length)throw Error("Reference order incomplete");references.push(value);rawObjects.add(value.object.sha256);
  }
  if(rawObjects.size!==manifest.context.objects||createReferenceTree(manifest.context,references).root_sha256!==manifest.root_sha256)throw Error("Reference root/population mismatch");
}
function stats(db){
  return {page_size:db.prepare("PRAGMA page_size").get().page_size,page_count:db.prepare("PRAGMA page_count").get().page_count,
    allocations:db.prepare("SELECT name,pagetype,count(*) AS pages,sum(pgsize) AS bytes FROM dbstat GROUP BY name,pagetype ORDER BY name,pagetype").all(),
    largest_cell_payload_bytes:db.prepare("SELECT max(mx_payload) AS n FROM dbstat").get().n,
    max_reference_bytes:db.prepare("SELECT max(length(CAST(reference_json AS BLOB))) AS n FROM evidence_references").get().n??0,
    max_proof_bytes:db.prepare("SELECT max(length(CAST(proof_json AS BLOB))) AS n FROM evidence_references").get().n??0,
    lookup_plan:db.prepare("EXPLAIN QUERY PLAN "+REFERENCE_LOOKUP_SQL).all("tenx_holder_evidence","probe").map(r=>r.detail)};
}

export async function buildEvidenceReferences(indexDirectory,indexPin,target){
  const source=await evidencePrivatePath(indexDirectory),output=await evidencePrivatePath(target,true);
  if(inside(source,output)||inside(output,source))throw Error("Reference output must be separate from source");
  await separateOutput(output);
  const {manifest:original,references}=await readEvidenceIndexMaterial(source,indexPin),context=canonicalContext({version:VERSION,source_index_manifest_sha256:indexPin,
    source_sealed_manifest_sha256:original.source_sealed_manifest_sha256,source_catalog_manifest_sha256:original.source_catalog_manifest_sha256,source_archive_manifest_sha256:original.source_archive_manifest_sha256,rows:original.rows,objects:original.objects});
  const tree=createReferenceTree(context,references),provisional=temporaryManifest(context,tree.root_sha256),deadline=performance.now()+300000;await mkdir(output,{mode:0o700});const file=path.join(output,DB),handle=await open(file,"wx",0o600);await handle.close();
  const db=new DatabaseSync(file);let measurements,inserted;
  try{
    db.exec("PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE");db.exec(SCHEMA);const add=db.prepare("INSERT INTO evidence_references VALUES(?,?,?,?,?)");
    references.forEach((value,i)=>{if(performance.now()>deadline)throw Error("Reference construction deadline exceeded");const proof=tree.proofs[i];verifyReferenceProof(provisional,provisional.reference_manifest_sha256,value,proof,value.entry.table,value.entry.metadata[0]);add.run(value.entry.table,value.entry.metadata[0],i,JSON.stringify(canonicalLeaf(value)),JSON.stringify(proof));});
    inserted=db.prepare("SELECT total_changes() AS n").get().n;db.exec("COMMIT");schemaCheck(db);measurements=stats(db);
    verifyAll(db,provisional,provisional.reference_manifest_sha256);
  }finally{db.close();}
  await noSidecars(file);const saved=await evidenceRegularFile(file,MAX_DB),body={context,confidentiality:"private_plaintext_metadata",algorithm:ALGORITHM,root_sha256:tree.root_sha256,database:{file:DB,bytes:saved.bytes,sha256:await hashFile(file)}};
  const manifest={...body,reference_manifest_sha256:digest(body)};admittedManifest(manifest,manifest.reference_manifest_sha256);
  await writeFile(path.join(output,"references.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
  return {reference_manifest_sha256:manifest.reference_manifest_sha256,source_index_manifest_sha256:indexPin,root_sha256:tree.root_sha256,rows:context.rows,objects:context.objects,database_bytes:saved.bytes,
    sql_rows_inserted:inserted,...measurements,all_reference_metadata_verified:true,payload_objects_verified:false,plaintext_metadata:true,network_requests:0,runtime_activated:false,action_authority:false};
}
// Used only before a fresh database's final byte pin exists; never published.
function temporaryManifest(context,root){const body={context,confidentiality:"private_plaintext_metadata",algorithm:ALGORITHM,root_sha256:root,database:{file:DB,bytes:1,sha256:"0".repeat(64)}};return {...body,reference_manifest_sha256:digest(body)};}

export async function verifyEvidenceReferences(directory,pin){
  const index=await opened(directory,pin,true);
  try{verifyAll(index.db,index.manifest,pin);const measurements=stats(index.db);await noSidecars(index.file);if(await hashFile(index.file)!==index.manifest.database.sha256)throw Error("Reference database changed during verification");
    return {reference_manifest_sha256:pin,rows:index.manifest.context.rows,objects:index.manifest.context.objects,...measurements,all_reference_metadata_verified:true,payload_objects_verified:false,network_requests:0,runtime_activated:false,action_authority:false};
  }finally{index.db.close();}
}
export async function readProvenEvidenceRow(directory,pin,sealedDirectory,keyFile,table,identity){
  if(!["tenx_holder_evidence","tenx_wallet_evidence"].includes(table)||typeof identity!=="string"||!identity.length||identity.length>4096)throw Error("Unsupported reference identity");
  const index=await opened(directory,pin);
  try{
    const saved=selected(index.db,table,identity),reference=verifyReferenceProof(index.manifest,pin,saved.reference,saved.proof,table,identity),{ordinal:ignored,...value}=reference;
    const recovered=await recoverEvidenceReference(sealedDirectory,index.manifest.context.source_sealed_manifest_sha256,keyFile,value,index.folder);
    await noSidecars(index.file);
    return {reference_manifest_sha256:pin,source_index_manifest_sha256:index.manifest.context.source_index_manifest_sha256,source_sealed_manifest_sha256:index.manifest.context.source_sealed_manifest_sha256,
      catalog_manifest_sha256:index.manifest.context.source_catalog_manifest_sha256,source_manifest_sha256:index.manifest.context.source_archive_manifest_sha256,
      ...recovered,table,objects_read:1,reference_bytes_read:saved.reference_bytes,proof_bytes_read:saved.proof_bytes,proof_hashes:saved.proof.length,index_bytes_hashed:0,encrypted_catalog_bytes_read:0,
      other_references_verified:false,other_objects_verified:false,action_authority:false,runtime_activated:false};
  }finally{index.db.close();}
}
async function main([action,...args]){
  if(action==="build"&&args.length===3)return buildEvidenceReferences(...args);
  if(action==="verify"&&args.length===2)return verifyEvidenceReferences(...args);
  if(action==="lookup"&&args.length===7){
    const output=await evidencePrivatePath(args[6],true),folder=await evidencePrivatePath(args[0]),sealed=await evidencePrivatePath(args[2]);
    if(!output.endsWith(".json")||inside(folder,output)||inside(sealed,output))throw Error("Separate new private JSON output required");
    const row=await readProvenEvidenceRow(...args.slice(0,6)),text=JSON.stringify(row,null,2)+"\n";await writeFile(output,text,{flag:"wx",mode:0o600});
    return {file_sha256:sha(text),objects_read:1,index_bytes_hashed:0,encrypted_catalog_bytes_read:0,other_references_verified:false,other_objects_verified:false,plaintext_export:true,network_requests:0,runtime_activated:false,action_authority:false};
  }
  throw Error("Usage: build INDEX INDEX_PIN NEW_PRIVATE_DIRECTORY | verify REFERENCES ROOT_PIN | lookup REFERENCES ROOT_PIN SEALED KEY TABLE PAYLOAD_HASH NEW_PRIVATE_JSON");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value,null,2)))
  .catch(()=>{console.error("Private evidence reference operation failed; no runtime activated. Check retained pins, private paths, proofs, separate key and object integrity.");process.exitCode=1;});
