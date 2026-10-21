import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createHash,createDecipheriv,hkdfSync} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {mkdir,mkdtemp,readFile,writeFile,realpath,rm,rename,symlink,stat} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {exportArchive,hashFile} from "./discovery-archive.mjs";
import {packEvidenceObjects} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects} from "./discovery-evidence-sealed.mjs";
import {buildEvidenceIndex} from "./discovery-evidence-index.mjs";
import {buildEvidenceReferences} from "./discovery-evidence-references.mjs";
import {studyMetadataCapacity} from "./discovery-metadata-capacity.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {createEvidenceWrappingKey} from "./discovery-evidence-key-recovery.mjs";
import {packSealedMetadata,restoreSealedMetadata} from "./discovery-metadata-sealed.mjs";
const sha=v=>createHash("sha256").update(v).digest("hex"),sentinel="PRIVATE-SESSION-SENTINEL \ufeff\0漢";
async function fixture(work){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","metadata-sealed-test-")),db=new DatabaseSync(path.join(root,"source.sqlite"));
  try{
    db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY,state TEXT);
      CREATE TABLE tenx_holder_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);CREATE TABLE tenx_wallet_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);
      CREATE TABLE private_sessions(id TEXT PRIMARY KEY,payload TEXT);INSERT INTO tenx_source_reservations VALUES('spent','failed');`);
    db.prepare("INSERT INTO private_sessions VALUES(?,?)").run("session",sentinel);db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run("holder","mint\0tail",7,"\ufefforiginal\0payload","original-time");db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run("wallet","mint","","unchanged-time");
    const archive=path.join(root,"archive"),a=await exportArchive(path.join(root,"source.sqlite"),archive),objects=path.join(root,"objects"),o=await packEvidenceObjects(archive,a.manifest_sha256,objects),keys=path.join(root,"keys");await mkdir(keys);const key=path.join(keys,"key.bin");await createEvidenceKey(key);
    const sealed=path.join(root,"sealed"),s=await sealEvidenceObjects(objects,o.catalog_manifest_sha256,key,sealed),index=path.join(root,"index"),i=await buildEvidenceIndex(sealed,s.sealed_manifest_sha256,key,index),refs=path.join(root,"references"),r=await buildEvidenceReferences(index,i.index_manifest_sha256,refs),capacity=path.join(root,"capacity"),c=await studyMetadataCapacity(archive,a.manifest_sha256,refs,r.reference_manifest_sha256,capacity);
    const output=path.join(root,"pack"),restored=path.join(root,"restored"),args=[capacity,c.capacity_manifest_sha256,refs,r.reference_manifest_sha256,sealed,key,output];
    await work({root,key,sealed,refs,r,capacity,c,output,restored,args});assert.equal(await hashFile(path.join(archive,"discovery.sqlite")),a.database.sha256);
  }finally{db.close();const actual=await realpath(root),base=await realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("metadata-sealed-test-"));await rm(actual,{recursive:true,force:true});}
}
async function repin(folder,mutate){const file=path.join(folder,"metadata-sealed.json"),m=JSON.parse(await readFile(file,"utf8")),{metadata_sealed_manifest_sha256,...body}=m;mutate(body);const pin=sha(JSON.stringify(body));await writeFile(file,JSON.stringify({...body,metadata_sealed_manifest_sha256:pin}));return pin;}
test("independently decrypts all four roles and restores exact private metadata, sessions, failures and references",()=>fixture(async({key,sealed,capacity,refs,c,r,args,output,restored})=>{
  const before=await hashFile(path.join(capacity,"capacity.sqlite")),p=await packSealedMetadata(...args),m=JSON.parse(await readFile(path.join(output,"metadata-sealed.json"),"utf8")),root=await readFile(key);
  for(const f of m.files){
    const info=Buffer.from("discovery-metadata-sealed-v1|"+sha(JSON.stringify(m.context))+"|"+f.role),derived=Buffer.from(hkdfSync("sha256",root,Buffer.from(m.salt,"hex"),info,32)),d=createDecipheriv("aes-256-gcm",derived,Buffer.from(f.iv,"hex"),{authTagLength:16});d.setAAD(info);d.setAuthTag(Buffer.from(f.tag,"hex"));
    const ciphertext=await readFile(path.join(output,f.role+".bin")),raw=gunzipSync(Buffer.concat([d.update(ciphertext),d.final()]));assert.equal(raw.length,f.raw.bytes);assert.equal(sha(raw),f.raw.sha256);assert.ok(!ciphertext.includes(Buffer.from("PRIVATE-SESSION-SENTINEL")));assert.ok(!ciphertext.includes(root));derived.fill(0);
  }
  root.fill(0);const receipt=await restoreSealedMetadata(output,p.metadata_sealed_manifest_sha256,sealed,key,restored);assert.equal(receipt.version,"discovery-metadata-restore-v1");assert.equal(receipt.tables,7);assert.equal(receipt.runtime_activated,false);assert.equal(receipt.payload_objects_verified,false);
  for(const [from,to] of [[capacity,"capacity"],[refs,"references"]])for(const name of to==="capacity"?["capacity.json","capacity.sqlite"]:["references.json","references.sqlite"])assert.equal(await hashFile(path.join(from,name)),await hashFile(path.join(restored,to,name)));
  await withScratchEvidenceResolver({capacityDirectory:path.join(restored,"capacity"),capacityPin:c.capacity_manifest_sha256,referenceDirectory:path.join(restored,"references"),referencePin:r.reference_manifest_sha256,sealedDirectory:sealed,keyFile:key},async reader=>{
    assert.equal(reader.sqlite.prepare("SELECT hex(CAST(payload AS BLOB)) AS v FROM private_sessions").get().v,Buffer.from(sentinel).toString("hex").toUpperCase());assert.equal(reader.sqlite.prepare("SELECT state FROM tenx_source_reservations").get().state,"failed");assert.equal((await reader.resolve("tenx_holder_evidence","holder")).payload,"\ufefforiginal\0payload");return null;
  });assert.equal(await hashFile(path.join(capacity,"capacity.sqlite")),before);
}));
test("restore is independent of the original metadata/reference directories and uses only pinned encrypted files plus evidence dependencies",()=>fixture(async({root,key,sealed,capacity,refs,args,output,restored})=>{
  const p=await packSealedMetadata(...args);for(const source of [capacity,refs]){const held=path.join(root,"held-"+path.basename(source));assert.ok(source.startsWith(root+path.sep)&&held.startsWith(root+path.sep));await rename(source,held);}
  assert.equal((await restoreSealedMetadata(output,p.metadata_sealed_manifest_sha256,sealed,key,restored)).source_metadata_admitted,true);
}));
test("wrong roots, pins and repinned GCM context/tag corruption hold before any restored JSON/SQLite is written",()=>fixture(async({root,key,sealed,args,output,restored})=>{
  const p=await packSealedMetadata(...args),wrong=path.join(root,"wrong.bin");await createEvidenceKey(wrong);await assert.rejects(restoreSealedMetadata(output,p.metadata_sealed_manifest_sha256,sealed,wrong,restored));await assert.rejects(stat(restored),/ENOENT/);
  await assert.rejects(restoreSealedMetadata(output,"0".repeat(64),sealed,key,restored));
  const manifest=path.join(output,"metadata-sealed.json"),saved=await readFile(manifest);let n=0;
  for(const mutate of [m=>{m.context.capacity_manifest_sha256="f".repeat(64);},m=>{m.salt="0".repeat(64);},m=>{m.files[3].tag="0".repeat(32);}]){
    await writeFile(manifest,saved);const pin=await repin(output,mutate),target=restored+"-"+(n++);await assert.rejects(restoreSealedMetadata(output,pin,sealed,key,target));await assert.rejects(stat(path.join(target,"capacity")),/ENOENT/);await assert.rejects(stat(path.join(target,"metadata-restored.json")),/ENOENT/);
  }
}));
test("corrupted encrypted bytes fail even with a repaired outer checksum, and authenticated expansion declarations remain bounded",()=>fixture(async({key,sealed,args,output,restored})=>{
  const p=await packSealedMetadata(...args),file=path.join(output,"reference_database.bin"),original=await readFile(file),bad=Buffer.from(original);bad[0]^=1;await writeFile(file,bad);
  const manifest=path.join(output,"metadata-sealed.json"),saved=await readFile(manifest),pin=await repin(output,m=>{m.files[3].encrypted.sha256=sha(bad);});await assert.rejects(restoreSealedMetadata(output,pin,sealed,key,restored));await assert.rejects(stat(path.join(restored,"capacity")),/ENOENT/);
  await writeFile(file,original);await writeFile(manifest,saved);const smaller=await repin(output,m=>{m.files[0].raw.bytes=1;});await assert.rejects(restoreSealedMetadata(output,smaller,sealed,key,restored+"-bounded"),/bound|size/);await assert.rejects(stat(path.join(restored+"-bounded","metadata-restored.json")),/ENOENT/);
}));
test("role/path/schema/nonce and size substitution cannot bypass the fixed four-file contract",()=>fixture(async({key,sealed,args,output,restored})=>{
  await packSealedMetadata(...args);const file=path.join(output,"metadata-sealed.json"),saved=await readFile(file);
  for(const mutate of [m=>{m.files[0].path="../escape";},m=>{m.files.reverse();},m=>{m.files.pop();},m=>{m.files[1].iv=m.files[0].iv;},m=>{m.files[1].raw.bytes=2147483649;},m=>{m.kdf="unknown";}]){
    await writeFile(file,saved);const pin=await repin(output,mutate);await assert.rejects(restoreSealedMetadata(output,pin,sealed,key,restored));await assert.rejects(stat(restored),/ENOENT/);
  }
}));
test("unsafe/existing/nested paths and key co-location preserve original/private artifacts",()=>fixture(async({root,key,sealed,capacity,args,output,restored})=>{
  const p=await packSealedMetadata(...args);await assert.rejects(packSealedMetadata(...args),/EEXIST/);await mkdir(restored);await writeFile(path.join(restored,"retained"),"partial");await assert.rejects(restoreSealedMetadata(output,p.metadata_sealed_manifest_sha256,sealed,key,restored),/EEXIST/);assert.equal(await readFile(path.join(restored,"retained"),"utf8"),"partial");
  const live=path.join(root,".wrangler");await mkdir(live);await symlink(live,path.join(root,"alias"),"junction");for(const target of [path.join(live,"restore"),path.join(root,"alias","restore"),path.join(output,"restore"),path.join(capacity,"restore"),path.join(path.dirname(key),"restore")])await assert.rejects(restoreSealedMetadata(output,p.metadata_sealed_manifest_sha256,sealed,key,target));
  await assert.rejects(createEvidenceWrappingKey(path.join(output,"wrapping")));const link=path.join(root,"linked-key.bin");await symlink(key,link,"file");await assert.rejects(restoreSealedMetadata(output,p.metadata_sealed_manifest_sha256,sealed,link,restored+"-linked"));
}));
test("CLI writes private exclusive packs/restores and prints no keys, session values or payloads",()=>fixture(async({root,key,sealed,args})=>{
  const cli=(...a)=>spawnSync(process.execPath,["scripts/discovery-metadata-sealed.mjs",...a],{encoding:"utf8"}),pack=cli("pack",...args);assert.equal(pack.status,0);const pin=JSON.parse(pack.stdout).metadata_sealed_manifest_sha256,restored=path.join(root,"cli-restored"),result=cli("restore",args[6],pin,sealed,key,restored);assert.equal(result.status,0);
  const secret=await readFile(key);for(const value of ["PRIVATE-SESSION-SENTINEL",secret.toString("hex"),secret.toString("base64")])assert.ok(!pack.stdout.includes(value)&&!result.stdout.includes(value));assert.notEqual(cli("restore",args[6],pin,sealed,key,restored).status,0);
}));
