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
import {buildEvidenceIndex,verifyEvidenceIndex,readIndexedEvidenceRow} from "./discovery-evidence-index.mjs";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),holder="tenx_holder_evidence",wallet="tenx_wallet_evidence";
async function fixture(run){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","evidence-index-test-")),source=path.join(root,"plain"),sealed=path.join(root,"sealed"),index=path.join(root,"index"),key=path.join(root,"key.bin"),db=new DatabaseSync(path.join(root,"source.sqlite"));
  try{
    db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);
      CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY);
      CREATE TABLE ${holder}(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);
      CREATE TABLE ${wallet}(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);`);
    const insert=db.prepare(`INSERT INTO ${holder} VALUES(?,?,?,?,?)`),payload="PRIVATE-PAYLOAD-SENTINEL \ufeffnot-json\0漢";
    insert.run("h1\0tail","PRIVATE-MINT\0tail",7,payload,"original\0time");insert.run("h2","PRIVATE-MINT",8,"second-payload","later-time");insert.run("h3","PRIVATE-MINT",9,payload,"duplicate-time");
    db.prepare(`INSERT INTO ${wallet} VALUES(?,?,?,?)`).run("w1","PRIVATE-MINT",payload,"unchanged-time");db.prepare(`INSERT INTO ${wallet} VALUES(?,?,?,?)`).run("w2","PRIVATE-MINT","","empty-time");
    const archive=path.join(root,"archive"),original=await exportArchive(path.join(root,"source.sqlite"),archive),catalog=await packEvidenceObjects(archive,original.manifest_sha256,source);
    await createEvidenceKey(key);const encryption=await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,sealed);
    await run({root,source,sealed,index,key,catalog,encryption});
  }finally{db.close();const actual=await realpath(root),base=await realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("evidence-index-test-"));await rm(actual,{recursive:true,force:true});}
}
async function repin(index,mutate){
  const db=new DatabaseSync(path.join(index,"evidence-index.sqlite"));try{mutate(db);}finally{db.close();}
  const file=path.join(index,"index.json"),manifest=JSON.parse(await readFile(file,"utf8"));manifest.database.bytes=(await stat(path.join(index,"evidence-index.sqlite"))).size;manifest.database.sha256=await hashFile(path.join(index,"evidence-index.sqlite"));
  const {index_manifest_sha256:ignored,...body}=manifest;manifest.index_manifest_sha256=sha(JSON.stringify(body));await writeFile(file,JSON.stringify(manifest));return manifest.index_manifest_sha256;
}

test("full original catalog reconstruction and indexed exact-row recovery preserve metadata and shared/empty payloads",()=>fixture(async({source,sealed,index,key,catalog,encryption})=>{
  const sourceBefore=await readFile(path.join(sealed,"sealed.json")),result=await buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),pin=result.index_manifest_sha256;
  assert.equal(result.rows,5);assert.equal(result.objects,3);assert.equal(result.sql_rows_inserted,9);assert.equal(result.source_payloads_verified_at_build,true);assert.equal(result.payload_objects_verified,false);
  assert.equal(result.database_bytes,result.page_size*result.page_count);assert.ok(result.allocations.length>=4);assert.ok(result.lookup_plan.every(s=>s.includes("SEARCH")&&!s.includes("SCAN")));assert.ok(result.address_history_plan.every(s=>s.includes("evidence_rows_by_address")&&!s.includes("SCAN")));
  const before=await hashFile(path.join(index,"evidence-index.sqlite"));
  for(const entry of catalog.entries){const original=await readEvidenceObjectRow(source,catalog.catalog_manifest_sha256,entry.table,entry.metadata[0]),row=await readIndexedEvidenceRow(index,pin,sealed,key,entry.table,entry.metadata[0]);assert.deepEqual(row.row,original.row);assert.equal(row.row_sha256,original.row_sha256);assert.equal(row.objects_read,1);assert.equal(row.encrypted_catalog_bytes_read,0);assert.equal(row.index_bytes_hashed,2*result.database_bytes);assert.equal(row.other_objects_verified,false);}
  assert.equal((await verifyEvidenceIndex(index,pin)).all_index_metadata_verified,true);assert.equal(await hashFile(path.join(index,"evidence-index.sqlite")),before);assert.deepEqual(await readFile(path.join(sealed,"sealed.json")),sourceBefore);
  const bytes=await readFile(path.join(index,"evidence-index.sqlite"));assert.ok(!bytes.includes(Buffer.from("PRIVATE-PAYLOAD-SENTINEL")));assert.ok(bytes.includes(Buffer.from("PRIVATE-MINT")));assert.ok(!bytes.includes(await readFile(key)));
}));

test("lookup reads no encrypted catalog and requires no original archive; pure index verification needs no key",()=>fixture(async({root,source,sealed,index,key,catalog,encryption})=>{
  const result=await buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),moves=[[path.join(sealed,"catalog.bin"),path.join(root,"held-catalog.bin")],[source,path.join(root,"held-plain")],[path.join(root,"archive"),path.join(root,"held-archive")]];
  for(const [from,to] of moves){assert.ok([from,to].every(p=>p.startsWith(root+path.sep)));await rename(from,to);}
  assert.equal((await verifyEvidenceIndex(index,result.index_manifest_sha256)).payload_objects_verified,false);
  const row=await readIndexedEvidenceRow(index,result.index_manifest_sha256,sealed,key,holder,"h1\0tail");assert.equal(row.row.address,"PRIVATE-MINT\0tail");assert.equal(row.encrypted_catalog_bytes_read,0);
}));

test("wrong pins/keys, missing identities, changed ciphertext and key co-location are held",()=>fixture(async({root,sealed,index,key,encryption})=>{
  const result=await buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),pin=result.index_manifest_sha256;
  await assert.rejects(verifyEvidenceIndex(index,"0".repeat(64)),/manifest checksum/);
  await assert.rejects(readIndexedEvidenceRow(index,pin,sealed,key,holder,"missing"),/not in pinned/);
  const wrong=path.join(root,"wrong.bin");await createEvidenceKey(wrong);await assert.rejects(readIndexedEvidenceRow(index,pin,sealed,wrong,holder,"h2"));
  const internal=path.join(index,"key.bin");await writeFile(internal,await readFile(key));await assert.rejects(readIndexedEvidenceRow(index,pin,sealed,internal,holder,"h2"),/separate/);
  const db=new DatabaseSync(path.join(index,"evidence-index.sqlite"),{readOnly:true});let descriptor;try{descriptor=JSON.parse(db.prepare("SELECT sealed_json FROM evidence_objects WHERE raw_sha256=(SELECT raw_sha256 FROM evidence_rows WHERE identity='h2')").get().sealed_json);}finally{db.close();}
  const object=path.join(sealed,"objects",descriptor.sha256+".bin"),bytes=await readFile(object);bytes[0]^=1;await writeFile(object,bytes);await assert.rejects(readIndexedEvidenceRow(index,pin,sealed,key,holder,"h2"),/checksum/);
  assert.equal((await verifyEvidenceIndex(index,pin)).all_index_metadata_verified,true); // metadata-only scope remains explicit
}));

test("changed index bytes and caller-repinned missing rows, schema drift and metadata inconsistencies fail",()=>fixture(async({sealed,index,key,encryption})=>{
  const result=await buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),file=path.join(index,"evidence-index.sqlite"),saved=await readFile(file),manifest=await readFile(path.join(index,"index.json"));
  const changed=new DatabaseSync(file);try{changed.exec("DELETE FROM evidence_rows WHERE identity='h2'");}finally{changed.close();}
  await assert.rejects(verifyEvidenceIndex(index,result.index_manifest_sha256),/database checksum/);
  let pin=await repin(index,()=>{});await assert.rejects(verifyEvidenceIndex(index,pin),/order|population|checksum/);
  for(const mutate of [db=>db.exec("DROP INDEX evidence_rows_by_address"),db=>db.exec("CREATE TABLE future_secret(value TEXT)"),db=>db.exec("UPDATE evidence_rows SET address='altered' WHERE identity='h2'"),db=>{const value=JSON.parse(db.prepare("SELECT entry_json FROM evidence_rows WHERE identity='h2'").get().entry_json);value.metadata[1]="altered";db.prepare("UPDATE evidence_rows SET entry_json=? WHERE identity='h2'").run(JSON.stringify(value));}]){
    await writeFile(file,saved);await writeFile(path.join(index,"index.json"),manifest);pin=await repin(index,mutate);await assert.rejects(verifyEvidenceIndex(index,pin));
  }
  await assert.rejects(readIndexedEvidenceRow(index,pin,sealed,key,holder,"h2"),/row checksum/);
}));

test("unsafe destinations, file links and journal sidecars cannot create or adopt an index",()=>fixture(async({root,sealed,index,key,encryption})=>{
  const live=path.join(root,".wrangler");await mkdir(live);await symlink(live,path.join(root,"alias"),"junction");
  for(const target of [path.join(live,"index"),path.join(root,"alias","index"),path.join(sealed,"index")])await assert.rejects(buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,target));
  await assert.rejects(buildEvidenceIndex(sealed,"0".repeat(64),key,index));await assert.rejects(stat(path.join(index,"index.json")),/ENOENT/);
  const result=await buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),sidecar=path.join(index,"evidence-index.sqlite-wal");await writeFile(sidecar,"");await assert.rejects(verifyEvidenceIndex(index,result.index_manifest_sha256),/standalone/);
  const held=path.join(root,"held-sidecar");assert.ok([sidecar,held].every(p=>p.startsWith(root+path.sep)));await rename(sidecar,held);
  const file=path.join(index,"evidence-index.sqlite"),retained=path.join(root,"retained.sqlite");assert.ok([file,retained].every(p=>p.startsWith(root+path.sep)));await rename(file,retained);await symlink(retained,file,"file");await assert.rejects(verifyEvidenceIndex(index,result.index_manifest_sha256),/links/);
}));

test("index destinations and manifest contracts remain exclusive and pinned",()=>fixture(async({sealed,index,key,encryption})=>{
  const result=await buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),file=path.join(index,"index.json"),saved=await readFile(file);
  await assert.rejects(buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),/EEXIST/);assert.deepEqual(await readFile(file),saved);
  for(const mutate of [m=>{m.version="future";},m=>{m.database.file="../escape";},m=>{m.confidentiality="public";},m=>{m.database.bytes=64*1024**2+1;}]){
    const manifest=JSON.parse(saved);mutate(manifest);const {index_manifest_sha256:ignored,...body}=manifest;manifest.index_manifest_sha256=sha(JSON.stringify(body));await writeFile(file,JSON.stringify(manifest));await assert.rejects(verifyEvidenceIndex(index,manifest.index_manifest_sha256));
  }
}));

test("CLI output omits private metadata and exports only to a new separate private JSON",()=>fixture(async({root,sealed,index,key,encryption})=>{
  const result=await buildEvidenceIndex(sealed,encryption.sealed_manifest_sha256,key,index),output=path.join(root,"selected.json"),cli=args=>spawnSync(process.execPath,["scripts/discovery-evidence-index.mjs",...args],{encoding:"utf8"}),args=["lookup",index,result.index_manifest_sha256,sealed,key,holder,"h2",output];
  const first=cli(args);assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).encrypted_catalog_bytes_read,0);assert.ok(!first.stdout.includes("PRIVATE-MINT"));
  const before=await readFile(output);assert.equal(JSON.parse(before).row.address,"PRIVATE-MINT");assert.equal(cli(args).status,1);assert.deepEqual(await readFile(output),before);
  assert.equal(cli([...args.slice(0,-1),path.join(index,"unsafe.json")]).status,1);
}));
