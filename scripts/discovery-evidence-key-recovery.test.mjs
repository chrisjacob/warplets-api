import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createHash,createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {mkdir,mkdtemp,readFile,writeFile,realpath,rm,symlink,stat,rename} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {exportArchive,hashFile} from "./discovery-archive.mjs";
import {packEvidenceObjects} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects,verifySealedEvidence,verifySealedKeyBytes} from "./discovery-evidence-sealed.mjs";
import {createEvidenceWrappingKey,protectEvidenceKey,verifyEvidenceKeyBackup,restoreEvidenceKey} from "./discovery-evidence-key-recovery.mjs";
const sha=v=>createHash("sha256").update(v).digest("hex"),aad=pin=>Buffer.from("discovery-evidence-key-backup-v1|evidence-key|"+pin);
async function fixture(work){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","key-recovery-test-")),db=new DatabaseSync(path.join(root,"source.sqlite"));
  try{
    db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY);
      CREATE TABLE tenx_holder_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);CREATE TABLE tenx_wallet_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);`);
    db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run("original","private-mint",7,"\ufefforiginal\0漢","original-time");db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run("wallet","private-mint","","unchanged-time");
    const archive=path.join(root,"archive"),a=await exportArchive(path.join(root,"source.sqlite"),archive),objects=path.join(root,"objects"),o=await packEvidenceObjects(archive,a.manifest_sha256,objects),keyFolder=path.join(root,"original-key");
    await mkdir(keyFolder);const key=path.join(keyFolder,"key.bin");await createEvidenceKey(key);const sealed=path.join(root,"sealed"),s=await sealEvidenceObjects(objects,o.catalog_manifest_sha256,key,sealed);
    const wrapping=path.join(root,"wrapping"),backup=path.join(root,"backup"),restored=path.join(root,"restored");await createEvidenceWrappingKey(wrapping);
    await work({root,key,sealed,s,wrapping,backup,restored});assert.equal(await hashFile(path.join(archive,"discovery.sqlite")),a.database.sha256);
  }finally{db.close();const actual=await realpath(root),base=await realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("key-recovery-test-"));await rm(actual,{recursive:true,force:true});}
}
async function repin(folder,mutate){const file=path.join(folder,"key-backup.json"),m=JSON.parse(await readFile(file,"utf8")),{key_backup_manifest_sha256,...body}=m;mutate(body);const pin=sha(JSON.stringify(body));await writeFile(file,JSON.stringify({...body,key_backup_manifest_sha256:pin}));return pin;}
test("independent authenticated wrapping/restore preserves the original key and every encrypted evidence row",()=>fixture(async({key,sealed,s,wrapping,backup,restored})=>{
  const original=await readFile(key),p=await protectEvidenceKey(sealed,s.sealed_manifest_sha256,key,wrapping,backup),m=JSON.parse(await readFile(path.join(backup,"key-backup.json"),"utf8")),wrap=await readFile(path.join(wrapping,"key.bin"));
  const d=createDecipheriv("aes-256-gcm",wrap,Buffer.from(m.iv,"hex"),{authTagLength:16});d.setAAD(aad(s.sealed_manifest_sha256));d.setAuthTag(Buffer.from(m.tag,"hex"));assert.deepEqual(Buffer.concat([d.update(Buffer.from(m.ciphertext,"hex")),d.final()]),original);
  const held=path.join(path.dirname(key),"retained-original.bin");assert.equal(path.dirname(held),path.dirname(key));await rename(key,held);
  const verified=await verifyEvidenceKeyBackup(backup,p.key_backup_manifest_sha256,sealed,wrapping);assert.equal(verified.catalog_authenticated,true);assert.equal(verified.payload_objects_verified,false);
  const receipt=await restoreEvidenceKey(backup,p.key_backup_manifest_sha256,sealed,wrapping,restored);assert.equal(receipt.key_printed,false);assert.equal(receipt.runtime_activated,false);assert.deepEqual(await readFile(path.join(restored,"key.bin")),original);
  await assert.rejects(stat(key),/ENOENT/);assert.deepEqual(await readFile(held),original);await rename(held,key);assert.deepEqual(await readFile(key),original);
  assert.equal((await verifySealedEvidence(sealed,s.sealed_manifest_sha256,path.join(restored,"key.bin"))).all_catalog_rows_verified,true);
  for(const secret of [original,Buffer.from(original.toString("hex")),Buffer.from(original.toString("base64")),wrap])assert.ok(!(await readFile(path.join(backup,"key-backup.json"))).includes(secret));
}));
test("wrong wrapping keys, trusted pins and repinned ciphertext/context fail before plaintext output",()=>fixture(async({root,key,sealed,s,wrapping,backup,restored})=>{
  const p=await protectEvidenceKey(sealed,s.sealed_manifest_sha256,key,wrapping,backup),wrong=path.join(root,"wrong-wrap");await createEvidenceWrappingKey(wrong);
  await assert.rejects(restoreEvidenceKey(backup,p.key_backup_manifest_sha256,sealed,wrong,restored));await assert.rejects(restoreEvidenceKey(backup,"0".repeat(64),sealed,wrapping,restored));
  const file=path.join(backup,"key-backup.json"),saved=await readFile(file);
  for(const mutate of [m=>{m.ciphertext="0".repeat(64);},m=>{m.source_sealed_manifest_sha256="f".repeat(64);},m=>{m.tag="0".repeat(32);},m=>{m.iv="0".repeat(24);}]){
    await writeFile(file,saved);const pin=await repin(backup,mutate);await assert.rejects(restoreEvidenceKey(backup,pin,sealed,wrapping,restored));await assert.rejects(stat(restored),/ENOENT/);
  }
}));
test("even a correctly authenticated backup of a wrong data key cannot release a key before full source catalog admission",()=>fixture(async({key,sealed,s,wrapping,backup,restored})=>{
  await protectEvidenceKey(sealed,s.sealed_manifest_sha256,key,wrapping,backup);const wrap=await readFile(path.join(wrapping,"key.bin")),bad=randomBytes(32),iv=randomBytes(12),c=createCipheriv("aes-256-gcm",wrap,iv,{authTagLength:16});c.setAAD(aad(s.sealed_manifest_sha256));const bytes=Buffer.concat([c.update(bad),c.final()]);
  const pin=await repin(backup,m=>{m.iv=iv.toString("hex");m.tag=c.getAuthTag().toString("hex");m.ciphertext=bytes.toString("hex");});
  await assert.rejects(restoreEvidenceKey(backup,pin,sealed,wrapping,restored));await assert.rejects(stat(restored),/ENOENT/);
  await assert.rejects(verifySealedKeyBytes(sealed,s.sealed_manifest_sha256,bad));
}));
test("malformed backup contracts and corrupt catalogs never create restored keys",()=>fixture(async({key,sealed,s,wrapping,backup,restored})=>{
  await protectEvidenceKey(sealed,s.sealed_manifest_sha256,key,wrapping,backup);const file=path.join(backup,"key-backup.json"),saved=await readFile(file);
  for(const mutate of [m=>{m.version="future";},m=>{m.cipher="unknown";},m=>{m.ciphertext="00";},m=>{m.tag="ff";},m=>{m.extra=true;}]){
    await writeFile(file,saved);const pin=await repin(backup,mutate);await assert.rejects(restoreEvidenceKey(backup,pin,sealed,wrapping,restored));await assert.rejects(stat(restored),/ENOENT/);
  }
  await writeFile(file,saved);const pin=JSON.parse(saved).key_backup_manifest_sha256,catalog=path.join(sealed,"catalog.bin"),bytes=await readFile(catalog);bytes[0]^=1;await writeFile(catalog,bytes);
  await assert.rejects(restoreEvidenceKey(backup,pin,sealed,wrapping,restored));await assert.rejects(stat(restored),/ENOENT/);
}));
test("existing/partial targets, nested artifacts, Wrangler aliases and linked keys remain untouched",()=>fixture(async({root,key,sealed,s,wrapping,backup,restored})=>{
  await assert.rejects(createEvidenceWrappingKey(wrapping),/EEXIST/);const p=await protectEvidenceKey(sealed,s.sealed_manifest_sha256,key,wrapping,backup);await assert.rejects(protectEvidenceKey(sealed,s.sealed_manifest_sha256,key,wrapping,backup),/EEXIST/);
  const live=path.join(root,".wrangler");await mkdir(live);await symlink(live,path.join(root,"alias"),"junction");
  for(const out of [path.join(live,"key"),path.join(root,"alias","key"),path.join(sealed,"key"),path.join(backup,"key"),path.join(wrapping,"key")])await assert.rejects(restoreEvidenceKey(backup,p.key_backup_manifest_sha256,sealed,wrapping,out));
  await mkdir(restored);await writeFile(path.join(restored,"retained"),"partial bytes");await assert.rejects(restoreEvidenceKey(backup,p.key_backup_manifest_sha256,sealed,wrapping,restored),/EEXIST/);assert.equal(await readFile(path.join(restored,"retained"),"utf8"),"partial bytes");
  const link=path.join(root,"linked-key.bin");await symlink(key,link,"file");await assert.rejects(protectEvidenceKey(sealed,s.sealed_manifest_sha256,link,wrapping,path.join(root,"another-backup")));
}));
test("key roles and directory separation prevent reusing the data key as its own wrapping key",()=>fixture(async({root,key,sealed,s,wrapping,backup})=>{
  await writeFile(path.join(wrapping,"key.bin"),await readFile(key));await assert.rejects(protectEvidenceKey(sealed,s.sealed_manifest_sha256,key,wrapping,backup),/separate/);await assert.rejects(stat(backup),/ENOENT/);
  const wrong=path.join(root,"wrong-key");await mkdir(wrong);await createEvidenceKey(path.join(wrong,"key.bin"));const other=path.join(root,"other-wrap");await createEvidenceWrappingKey(other);
  await assert.rejects(protectEvidenceKey(sealed,s.sealed_manifest_sha256,path.join(wrong,"key.bin"),other,backup));await assert.rejects(stat(backup),/ENOENT/);
}));
test("CLI recovery prints only aggregate receipts and never overwrites a key or exports its bytes",()=>fixture(async({root,key,sealed,s})=>{
  const cli=(...args)=>spawnSync(process.execPath,["scripts/discovery-evidence-key-recovery.mjs",...args],{encoding:"utf8"}),wrap=path.join(root,"cli-wrap"),backup=path.join(root,"cli-backup"),restored=path.join(root,"cli-restored");
  const generated=cli("generate",wrap),protectedKey=cli("protect",sealed,s.sealed_manifest_sha256,key,wrap,backup);assert.equal(generated.status,0);assert.equal(protectedKey.status,0);
  const pin=JSON.parse(protectedKey.stdout).key_backup_manifest_sha256,verified=cli("verify",backup,pin,sealed,wrap),recovered=cli("restore",backup,pin,sealed,wrap,restored);assert.equal(verified.status,0);assert.equal(recovered.status,0);assert.equal(JSON.parse(recovered.stdout).key_printed,false);
  const original=await readFile(key);for(const r of [generated,protectedKey,verified,recovered])for(const v of [original.toString("hex"),original.toString("base64")])assert.ok(!r.stdout.includes(v)&&!r.stderr.includes(v));
  assert.notEqual(cli("restore",backup,pin,sealed,wrap,restored).status,0);assert.deepEqual(await readFile(path.join(restored,"key.bin")),original);
}));
