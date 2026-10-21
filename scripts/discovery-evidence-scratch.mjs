// Offline only. This session never makes a stripped capacity copy a runtime store.
import {DatabaseSync} from "node:sqlite";
import {readFile,lstat} from "node:fs/promises";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import {hashFile} from "./discovery-archive.mjs";
import {verifyMetadataCapacity} from "./discovery-metadata-capacity.mjs";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {readSealedIndexMaterial,readSealedEnvelope} from "./discovery-evidence-sealed.mjs";
import {verifyEvidenceReferences,readProvenEvidenceRow} from "./discovery-evidence-references.mjs";
import {admittedManifest} from "./lib/evidence-reference-proof.mjs";
import {canonicalEvidenceReference} from "./lib/evidence-reference-contract.mjs";

const names={tenx_holder_evidence:["payload_hash","address","slot","observed_at"],tenx_wallet_evidence:["payload_hash","address","observed_at"]};
const inside=(a,b)=>a===b||b.startsWith(a+path.sep),exact=b=>new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(b);
const identity=(table,key)=>JSON.stringify([table,key]);
function metadata(db,table,key){
  const fields=names[table];if(!Object.hasOwn(names,table))throw Error("scratch_table_unsupported");
  const row=db.prepare(`SELECT ${fields.map(c=>c==="slot"?c:`CAST(${c} AS BLOB) AS ${c}`).join(",")} FROM ${table} WHERE payload_hash=?`).get(key);
  if(!row)throw Error("scratch_metadata_missing_no_absence_proof");return fields.map(c=>c==="slot"?row[c]:exact(row[c]));
}
export async function withScratchEvidenceResolver(options,work){
  const {capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile}=options;
  const capacityFolder=await evidencePrivatePath(capacityDirectory),referenceFolder=await evidencePrivatePath(referenceDirectory),sealedFolder=await evidencePrivatePath(sealedDirectory);
  const keyInfo=await evidenceRegularFile(keyFile,32);
  if(keyInfo.bytes!==32||[capacityFolder,referenceFolder,sealedFolder].some(f=>inside(f,keyInfo.file)))throw Error("scratch_separate_key_required");
  const capacity=await verifyMetadataCapacity(capacityFolder,capacityPin);await verifyEvidenceReferences(referenceFolder,referencePin);
  const manifest=admittedManifest(JSON.parse(await readFile(path.join(referenceFolder,"references.json"),"utf8")),referencePin);
  if(capacity.reference_manifest_sha256!==referencePin||capacity.source_archive_manifest_sha256!==manifest.context.source_archive_manifest_sha256)throw Error("scratch_source_pin_mismatch");
  const sealedPin=manifest.context.source_sealed_manifest_sha256,material=await readSealedIndexMaterial(sealedFolder,sealedPin,keyInfo.file),catalog=material.source_catalog;
  if(catalog.catalog_manifest_sha256!==manifest.context.source_catalog_manifest_sha256||catalog.source_manifest_sha256!==capacity.source_archive_manifest_sha256||catalog.source_manifest.database.sha256!==capacity.source_database_sha256)throw Error("scratch_catalog_source_mismatch");
  const originalObjects=new Map(catalog.objects.map(o=>[o.sha256,o])),encryptedObjects=new Map(material.objects.map(o=>[o.raw_sha256,o.sealed]));
  const expected=new Map(catalog.entries.map(entry=>[identity(entry.table,entry.metadata[0]),canonicalEvidenceReference({entry,object:originalObjects.get(entry.object_sha256),sealed:encryptedObjects.get(entry.object_sha256)})]));
  const keyHash=await hashFile(keyInfo.file),file=path.join(capacityFolder,"capacity.sqlite"),refFile=path.join(referenceFolder,"references.sqlite"),db=new DatabaseSync(file,{readOnly:true});let refs;
  const stats={resolved_rows:0,resolution_attempts:0,raw_payload_bytes:0,ciphertext_bytes_read:0,plaintext_payloads_cached:0};
  try{
    refs=new DatabaseSync(refFile,{readOnly:true});db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");refs.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");
    let count=0;for(const saved of refs.prepare("SELECT reference_json FROM evidence_references ORDER BY ordinal").iterate()){
      const {ordinal,...r}=JSON.parse(saved.reference_json),value=canonicalEvidenceReference(r),key=identity(value.entry.table,value.entry.metadata[0]);
      if(!isDeepStrictEqual(value,expected.get(key))||!isDeepStrictEqual(metadata(db,value.entry.table,value.entry.metadata[0]),value.entry.metadata))throw Error("scratch_reference_metadata_mismatch");count++;
    }
    const population=Object.keys(names).reduce((n,t)=>n+db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n,0);
    if(count!==expected.size||count!==population||count!==manifest.context.rows)throw Error("scratch_complete_population_mismatch");
    const resolve=async(table,key)=>{
      if(!Object.hasOwn(names,table)||typeof key!=="string")throw Error("scratch_identity_unsupported");
      const ref=expected.get(identity(table,key));if(!ref)throw Error("scratch_reference_missing_no_absence_proof");
      if(++stats.resolution_attempts>10000||stats.raw_payload_bytes+ref.object.bytes>2*1024**3)throw Error("scratch_resolution_bound");
      const recovered=await readProvenEvidenceRow(referenceFolder,referencePin,sealedFolder,keyInfo.file,table,key);
      if(recovered.source_manifest_sha256!==capacity.source_archive_manifest_sha256||recovered.row_sha256!==ref.entry.row_sha256||!isDeepStrictEqual(metadata(db,table,key),ref.entry.metadata))throw Error("scratch_recovered_source_mismatch");
      stats.resolved_rows++;stats.raw_payload_bytes+=ref.object.bytes;stats.ciphertext_bytes_read+=recovered.encrypted_object_bytes_read;
      return recovered.row;
    };
    // Values returned by work are released only after the end-of-session pin checks.
    const value=await work({sqlite:db,resolve,capacity,statistics:()=>({...stats})});
    for(const [f,pin,max] of [[file,capacity.database.sha256,2*1024**3],[refFile,manifest.database.sha256,64*1024**2],[path.join(sealedFolder,"catalog.bin"),(await readSealedEnvelope(sealedFolder,sealedPin)).value.catalog.sha256,20*1024**2]]){
      const saved=await evidenceRegularFile(f,max);if(await hashFile(saved.file)!==pin)throw Error("scratch_frozen_input_changed");
      for(const suffix of ["-wal","-shm","-journal"]){try{await lstat(f+suffix);}catch(e){if(e.code==="ENOENT")continue;throw e;}throw Error("scratch_sidecar_changed");}
    }
    if(await hashFile(keyInfo.file)!==keyHash||db.prepare("SELECT total_changes() AS n").get().n!==0||refs.prepare("SELECT total_changes() AS n").get().n!==0)throw Error("scratch_session_changed");
    return {value,statistics:{...stats},complete_metadata_admitted:true,full_catalog_admitted:true,selected_payload_scope:true,all_payload_objects_verified:false,database_writes:0,provider_requests:0,runtime_activated:false,action_authority:false};
  }finally{refs?.close();db.close();}
}
