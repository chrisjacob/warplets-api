import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,writeFile,realpath,rm,rename,symlink,stat} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {exportArchive,hashFile} from "./discovery-archive.mjs";
import {packEvidenceObjects,readEvidenceObjectRow} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects} from "./discovery-evidence-sealed.mjs";
import {buildEvidenceIndex} from "./discovery-evidence-index.mjs";
import {createReferenceTree,verifyReferenceProof,buildEvidenceReferences,verifyEvidenceReferences,readProvenEvidenceRow} from "./discovery-evidence-references.mjs";

const sha=b=>createHash("sha256").update(b).digest("hex"),holder="tenx_holder_evidence",wallet="tenx_wallet_evidence";
const context=rows=>({version:"discovery-evidence-references-v1",source_index_manifest_sha256:"1".repeat(64),source_sealed_manifest_sha256:"2".repeat(64),source_catalog_manifest_sha256:"3".repeat(64),source_archive_manifest_sha256:"4".repeat(64),rows,objects:rows?1:0});
const leaf=i=>({ordinal:i,entry:{table:holder,metadata:["h"+i,"mint",7,"original-time"],object_sha256:"a".repeat(64),row_sha256:"d".repeat(64)},object:{sha256:"a".repeat(64),bytes:10,gzip_bytes:10,gzip_sha256:"b".repeat(64)},sealed:{sha256:"c".repeat(64),bytes:10,iv:"0".repeat(24),tag:"0".repeat(32)}});
function manifest(ctx,root){const body={context:ctx,confidentiality:"private_plaintext_metadata",algorithm:"sha256-domain-separated-duplicate-last-v1",root_sha256:root,database:{file:"references.sqlite",bytes:1,sha256:"0".repeat(64)}};return {...body,reference_manifest_sha256:sha(JSON.stringify(body))};}

test("three-leaf independent domain/order vector and odd duplication are exact",()=>{
  const ctx=context(3),refs=[leaf(0),leaf(1),leaf(2)],tree=createReferenceTree(ctx,refs),ctxHash=Buffer.from(sha(JSON.stringify(ctx)),"hex");
  const hashes=refs.map(r=>sha(Buffer.concat([Buffer.from([0]),ctxHash,Buffer.from(JSON.stringify(r))]))),parent=(a,b)=>sha(Buffer.concat([Buffer.from([1]),Buffer.from(a,"hex"),Buffer.from(b,"hex")])),left=parent(hashes[0],hashes[1]),right=parent(hashes[2],hashes[2]);
  assert.equal(tree.root_sha256,parent(left,right));assert.deepEqual(tree.proofs[2],[hashes[2],left]);
  const root=manifest(ctx,tree.root_sha256);assert.deepEqual(verifyReferenceProof(root,root.reference_manifest_sha256,refs[2],tree.proofs[2],holder,"h2"),refs[2]);
  assert.throws(()=>verifyReferenceProof(root,root.reference_manifest_sha256,refs[2],[hashes[0],left],holder,"h2"),/odd/);
});
test("empty, single, odd, power-of-two and 10,000-leaf bounds hold with context replay and malformed-proof rejection",()=>{
  for(const size of [0,1,2,3,5,8,17,10000]){
    const ctx=context(size),refs=Array.from({length:size},(_,i)=>leaf(i)),tree=createReferenceTree(ctx,refs),root=manifest(ctx,tree.root_sha256);
    if(!size){assert.equal(tree.root_sha256,sha(Buffer.concat([Buffer.from([2]),Buffer.from(sha(JSON.stringify(ctx)),"hex")])));continue;}
    for(const i of new Set([0,Math.floor(size/2),size-1])){
      assert.ok(tree.proofs[i].length<=14);assert.equal(verifyReferenceProof(root,root.reference_manifest_sha256,refs[i],tree.proofs[i],holder,"h"+i).ordinal,i);
      assert.throws(()=>verifyReferenceProof(root,"0".repeat(64),refs[i],tree.proofs[i],holder,"h"+i),/manifest checksum/);
      const replay=manifest({...ctx,source_archive_manifest_sha256:"f".repeat(64)},tree.root_sha256);assert.throws(()=>verifyReferenceProof(replay,replay.reference_manifest_sha256,refs[i],tree.proofs[i],holder,"h"+i),/root mismatch|odd reference/);
      for(const change of [r=>{r.entry.metadata[1]="changed";},r=>{r.sealed.tag="f".repeat(32);},r=>{r.ordinal=size;},r=>{r.extra=true;}]){const altered=structuredClone(refs[i]);change(altered);assert.throws(()=>verifyReferenceProof(root,root.reference_manifest_sha256,altered,tree.proofs[i],holder,"h"+i));}
      assert.throws(()=>verifyReferenceProof(root,root.reference_manifest_sha256,refs[i],[...tree.proofs[i],"0".repeat(64)],holder,"h"+i));
      assert.throws(()=>verifyReferenceProof(root,root.reference_manifest_sha256,refs[i],tree.proofs[i],wallet,"h"+i));
    }
  }
  assert.throws(()=>createReferenceTree(context(10001),[]));
});

async function fixture(run){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","evidence-references-test-")),source=path.join(root,"plain"),sealed=path.join(root,"sealed"),index=path.join(root,"index"),references=path.join(root,"references"),key=path.join(root,"key.bin"),db=new DatabaseSync(path.join(root,"source.sqlite"));
  try{
    db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY);
      CREATE TABLE ${holder}(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);CREATE TABLE ${wallet}(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);`);
    const insert=db.prepare(`INSERT INTO ${holder} VALUES(?,?,?,?,?)`),payload="PRIVATE-PAYLOAD-SENTINEL \ufeffnot-json\0漢";
    insert.run("h1\0tail","PRIVATE-MINT\0tail",7,payload,"original\0time");insert.run("h2","PRIVATE-MINT",8,"second-payload","later-time");insert.run("h3","PRIVATE-MINT",9,payload,"duplicate-time");
    db.prepare(`INSERT INTO ${wallet} VALUES(?,?,?,?)`).run("w1","PRIVATE-MINT",payload,"unchanged-time");db.prepare(`INSERT INTO ${wallet} VALUES(?,?,?,?)`).run("w2","PRIVATE-MINT","","empty-time");
    const archive=path.join(root,"archive"),original=await exportArchive(path.join(root,"source.sqlite"),archive),catalog=await packEvidenceObjects(archive,original.manifest_sha256,source);await createEvidenceKey(key);
    const encrypted=await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,sealed),indexed=await buildEvidenceIndex(sealed,encrypted.sealed_manifest_sha256,key,index);
    await run({root,source,sealed,index,references,key,catalog,indexed});
  }finally{db.close();const actual=await realpath(root),base=await realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("evidence-references-test-"));await rm(actual,{recursive:true,force:true});}
}
function update(directory,run){const db=new DatabaseSync(path.join(directory,"references.sqlite"));try{run(db);}finally{db.close();}}

test("all exact source rows recover with bounded proofs, no database hashing and unchanged source pins",()=>fixture(async({source,sealed,index,references,key,catalog,indexed})=>{
  const before=await hashFile(path.join(index,"evidence-index.sqlite")),built=await buildEvidenceReferences(index,indexed.index_manifest_sha256,references),pin=built.reference_manifest_sha256;
  assert.equal(built.rows,5);assert.equal(built.objects,3);assert.equal(built.sql_rows_inserted,5);assert.ok(built.lookup_plan.every(p=>p.includes("SEARCH")&&!p.includes("SCAN")));assert.ok(built.max_proof_bytes<=1024);
  for(const entry of catalog.entries){const expected=await readEvidenceObjectRow(source,catalog.catalog_manifest_sha256,entry.table,entry.metadata[0]),actual=await readProvenEvidenceRow(references,pin,sealed,key,entry.table,entry.metadata[0]);assert.deepEqual(actual.row,expected.row);assert.equal(actual.row_sha256,expected.row_sha256);assert.equal(actual.objects_read,1);assert.equal(actual.index_bytes_hashed,0);assert.equal(actual.encrypted_catalog_bytes_read,0);assert.equal(actual.other_references_verified,false);}
  assert.equal((await verifyEvidenceReferences(references,pin)).all_reference_metadata_verified,true);assert.equal(await hashFile(path.join(index,"evidence-index.sqlite")),before);
  assert.ok(!(await readFile(path.join(references,"references.sqlite"))).includes(Buffer.from("PRIVATE-PAYLOAD-SENTINEL")));
}));
test("selected proof succeeds after unrelated mutation, while full verification fails and original absence is never inferred",()=>fixture(async({sealed,index,references,key,indexed})=>{
  const built=await buildEvidenceReferences(index,indexed.index_manifest_sha256,references),pin=built.reference_manifest_sha256;
  update(references,db=>db.prepare("UPDATE evidence_references SET proof_json=? WHERE identity='h2'").run('["'+"0".repeat(64)+'"]'));
  assert.equal((await readProvenEvidenceRow(references,pin,sealed,key,holder,"h1\0tail")).row.address,"PRIVATE-MINT\0tail");
  await assert.rejects(readProvenEvidenceRow(references,pin,sealed,key,holder,"h2"));await assert.rejects(verifyEvidenceReferences(references,pin),/database checksum/);
  update(references,db=>db.exec("DELETE FROM evidence_references WHERE identity='h2'"));await assert.rejects(readProvenEvidenceRow(references,pin,sealed,key,holder,"h2"),/no proof of original absence/);
}));
test("metadata/descriptors/ordinal/proof substitution and oversized selected fields are rejected without trusting file hashes",()=>fixture(async({sealed,index,references,key,indexed})=>{
  const built=await buildEvidenceReferences(index,indexed.index_manifest_sha256,references),pin=built.reference_manifest_sha256,file=path.join(references,"references.sqlite"),saved=await readFile(file);
  for(const mutate of [r=>{r.entry.metadata[1]="altered";},r=>{r.entry.row_sha256="f".repeat(64);},r=>{r.sealed.sha256="f".repeat(64);},r=>{r.ordinal=2;}]){
    await writeFile(file,saved);update(references,db=>{const row=JSON.parse(db.prepare("SELECT reference_json FROM evidence_references WHERE identity='h2'").get().reference_json);mutate(row);db.prepare("UPDATE evidence_references SET reference_json=? WHERE identity='h2'").run(JSON.stringify(row));});await assert.rejects(readProvenEvidenceRow(references,pin,sealed,key,holder,"h2"));
  }
  for(const [column,value] of [["proof_json","x".repeat(1025)],["reference_json","x".repeat(128*1024+1)]]){
    await writeFile(file,saved);update(references,db=>db.prepare(`UPDATE evidence_references SET ${column}=? WHERE identity='h2'`).run(value));await assert.rejects(readProvenEvidenceRow(references,pin,sealed,key,holder,"h2"),/Oversized/);
  }
}));
test("lookup requires no source index/catalog, but wrong keys, ciphertext and key co-location still fail",()=>fixture(async({root,sealed,index,references,key,indexed})=>{
  const built=await buildEvidenceReferences(index,indexed.index_manifest_sha256,references),pin=built.reference_manifest_sha256;
  for(const [from,to] of [[index,path.join(root,"held-index")],[path.join(sealed,"catalog.bin"),path.join(root,"held-catalog.bin")]]){assert.ok([from,to].every(p=>p.startsWith(root+path.sep)));await rename(from,to);}
  assert.equal((await readProvenEvidenceRow(references,pin,sealed,key,wallet,"w2")).row.payload,"");
  const wrong=path.join(root,"wrong.bin");await createEvidenceKey(wrong);await assert.rejects(readProvenEvidenceRow(references,pin,sealed,wrong,wallet,"w2"));
  const internal=path.join(references,"key.bin");await writeFile(internal,await readFile(key));await assert.rejects(readProvenEvidenceRow(references,pin,sealed,internal,wallet,"w2"),/separate/);
  const db=new DatabaseSync(path.join(references,"references.sqlite"),{readOnly:true});let ref;try{ref=JSON.parse(db.prepare("SELECT reference_json FROM evidence_references WHERE identity='w2'").get().reference_json);}finally{db.close();}
  const file=path.join(sealed,"objects",ref.sealed.sha256+".bin"),bytes=await readFile(file);bytes[0]^=1;await writeFile(file,bytes);await assert.rejects(readProvenEvidenceRow(references,pin,sealed,key,wallet,"w2"),/checksum/);
}));
test("unsafe paths/links/sidecars, existing targets and wrong source pins never activate a new reference store",()=>fixture(async({root,sealed,index,references,key,indexed})=>{
  const live=path.join(root,".wrangler");await mkdir(live);await symlink(live,path.join(root,"alias"),"junction");
  for(const target of [path.join(live,"refs"),path.join(root,"alias","refs"),path.join(index,"refs"),path.join(sealed,"refs")])await assert.rejects(buildEvidenceReferences(index,indexed.index_manifest_sha256,target));
  await assert.rejects(buildEvidenceReferences(index,"0".repeat(64),references));await assert.rejects(stat(path.join(references,"references.json")),/ENOENT/);
  const built=await buildEvidenceReferences(index,indexed.index_manifest_sha256,references);await assert.rejects(buildEvidenceReferences(index,indexed.index_manifest_sha256,references),/EEXIST/);
  const sidecar=path.join(references,"references.sqlite-wal");await writeFile(sidecar,"");await assert.rejects(readProvenEvidenceRow(references,built.reference_manifest_sha256,sealed,key,holder,"h2"),/standalone/);
  const held=path.join(root,"held-sidecar");assert.ok([sidecar,held].every(p=>p.startsWith(root+path.sep)));await rename(sidecar,held);
  const file=path.join(references,"references.sqlite"),retained=path.join(root,"retained.sqlite");assert.ok([file,retained].every(p=>p.startsWith(root+path.sep)));await rename(file,retained);await symlink(retained,file,"file");await assert.rejects(verifyEvidenceReferences(references,built.reference_manifest_sha256),/links/);
}));
test("malformed manifests/schema and source-context replay are held; CLI exports only separate new private plaintext",()=>fixture(async({root,sealed,index,references,key,indexed})=>{
  const built=await buildEvidenceReferences(index,indexed.index_manifest_sha256,references),pin=built.reference_manifest_sha256,file=path.join(references,"references.json"),saved=await readFile(file);
  for(const mutate of [m=>{m.algorithm="future";},m=>{m.database.file="../escape";},m=>{m.context.rows=10001;},m=>{m.context.source_index_manifest_sha256="0".repeat(64);}]){
    const value=JSON.parse(saved);mutate(value);const {reference_manifest_sha256:ignored,...body}=value;value.reference_manifest_sha256=sha(JSON.stringify(body));await writeFile(file,JSON.stringify(value));await assert.rejects(readProvenEvidenceRow(references,value.reference_manifest_sha256,sealed,key,holder,"h2"));
  }
  await writeFile(file,saved);const output=path.join(root,"selected.json"),args=["scripts/discovery-evidence-references.mjs","lookup",references,pin,sealed,key,holder,"h2",output],first=spawnSync(process.execPath,args,{encoding:"utf8"});assert.equal(first.status,0,first.stderr);assert.ok(!first.stdout.includes("PRIVATE-MINT"));assert.equal(JSON.parse(first.stdout).index_bytes_hashed,0);
  const before=await readFile(output);assert.equal(JSON.parse(before).row.address,"PRIVATE-MINT");assert.equal(spawnSync(process.execPath,args,{encoding:"utf8"}).status,1);assert.deepEqual(await readFile(output),before);
  update(references,db=>db.exec("CREATE TABLE unsupported(value TEXT)"));await assert.rejects(readProvenEvidenceRow(references,pin,sealed,key,holder,"h2"),/schema/);
}));
