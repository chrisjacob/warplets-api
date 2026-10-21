import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {mkdir,mkdtemp,readFile,writeFile,realpath,rm,rename,symlink,readdir,stat} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {exportArchive,hashFile} from "./discovery-archive.mjs";
import {packEvidenceObjects,readEvidenceObjectRow} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects,verifySealedEvidence,readSealedEvidenceRow} from "./discovery-evidence-sealed.mjs";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),holder="tenx_holder_evidence",wallet="tenx_wallet_evidence";
const VERSION="discovery-evidence-sealed-v1";
async function fixture(run){
  await mkdir(".tmp",{recursive:true});
  const root=await mkdtemp(path.resolve(".tmp","evidence-sealed-test-")),db=new DatabaseSync(path.join(root,"source.sqlite"));
  const source=path.join(root,"plain"),output=path.join(root,"sealed"),key=path.join(root,"key.bin");
  try{
    db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);
      CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY);
      CREATE TABLE ${holder}(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);
      CREATE TABLE ${wallet}(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);`);
    const insert=db.prepare(`INSERT INTO ${holder} VALUES(?,?,?,?,?)`);
    insert.run("h1","PRIVATE-MINT\0tail",7,"aaa","original-time");
    insert.run("h2","PRIVATE-MINT",8,"bbb","later-time");
    insert.run("h3","PRIVATE-MINT",9,"aaa","duplicate-time");
    db.prepare(`INSERT INTO ${wallet} VALUES(?,?,?,?)`).run("w1","PRIVATE-MINT","\ufeffnot-json\0漢","unchanged-time");
    db.prepare(`INSERT INTO ${wallet} VALUES(?,?,?,?)`).run("w2","PRIVATE-MINT","","empty-time");
    const archive=path.join(root,"archive"),original=await exportArchive(path.join(root,"source.sqlite"),archive);
    const catalog=await packEvidenceObjects(archive,original.manifest_sha256,source);
    await createEvidenceKey(key);
    await run({root,source,output,key,catalog,archive});
  }finally{
    db.close();const actual=await realpath(root),base=await realpath(".tmp");
    assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("evidence-sealed-test-"));
    await rm(actual,{recursive:true,force:true});
  }
}
async function repinOuter(output,mutate){
  const file=path.join(output,"sealed.json"),outer=JSON.parse(await readFile(file,"utf8"));mutate(outer);
  const {sealed_manifest_sha256:ignored,...body}=outer;outer.sealed_manifest_sha256=sha(JSON.stringify(body));
  await writeFile(file,JSON.stringify(outer));return outer.sealed_manifest_sha256;
}
// Test adversaries may know the key and repin metadata; object AAD/row checks
// must still reject mismatched components. Caller-retained pins remain authority.
async function repinInner(output,keyFile,mutate){
  const file=path.join(output,"catalog.bin"),outer=JSON.parse(await readFile(path.join(output,"sealed.json"),"utf8")),key=await readFile(keyFile);
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(outer.catalog.iv,"hex"),{authTagLength:16});
  decipher.setAAD(Buffer.from(VERSION+"|catalog"));decipher.setAuthTag(Buffer.from(outer.catalog.tag,"hex"));
  const inner=JSON.parse(Buffer.concat([decipher.update(await readFile(file)),decipher.final()]).toString("utf8"));
  await mutate(inner);
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv,{authTagLength:16});cipher.setAAD(Buffer.from(VERSION+"|catalog"));
  const bytes=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(inner))),cipher.final()]);await writeFile(file,bytes);
  return repinOuter(output,m=>{m.catalog={sha256:sha(bytes),bytes:bytes.length,iv:iv.toString("hex"),tag:cipher.getAuthTag().toString("hex")};});
}

test("authenticated full/selective round-trip retains all exact rows and hides metadata and raw object names",()=>fixture(async({source,output,key,catalog,archive})=>{
  const sourceHash=await hashFile(path.join(archive,"discovery.sqlite")),before=await readFile(path.join(source,"objects.json"));
  const sealed=await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output);
  assert.equal(sealed.rows,5);assert.equal(sealed.objects,4);assert.equal(sealed.key_in_pack,false);
  assert.equal((await verifySealedEvidence(output,sealed.sealed_manifest_sha256,key)).all_catalog_rows_verified,true);
  for(const entry of catalog.entries){
    const plain=await readEvidenceObjectRow(source,catalog.catalog_manifest_sha256,entry.table,entry.metadata[0]);
    const restored=await readSealedEvidenceRow(output,sealed.sealed_manifest_sha256,key,entry.table,entry.metadata[0]);
    assert.deepEqual(restored.row,plain.row);assert.equal(restored.row_sha256,plain.row_sha256);assert.equal(restored.objects_read,1);assert.equal(restored.other_objects_verified,false);
  }
  const files=[path.join(output,"sealed.json"),path.join(output,"catalog.bin"),...(await readdir(path.join(output,"objects"))).map(n=>path.join(output,"objects",n))];
  for(const file of files){const bytes=await readFile(file);assert.ok(!bytes.includes(Buffer.from("PRIVATE-MINT")));assert.ok(!bytes.includes(await readFile(key)));}
  for(const object of catalog.objects)assert.ok(!(await readdir(path.join(output,"objects"))).some(n=>n.includes(object.sha256)));
  assert.deepEqual(await readFile(path.join(source,"objects.json")),before);assert.equal(await hashFile(path.join(archive,"discovery.sqlite")),sourceHash);
}));

test("separate random keys and exclusive outputs; wrong key and retained pin fail",()=>fixture(async({root,source,output,key,catalog})=>{
  const before=await readFile(key);assert.equal(before.length,32);await assert.rejects(createEvidenceKey(key),/EEXIST/);assert.deepEqual(await readFile(key),before);
  const wrong=path.join(root,"wrong.bin");await createEvidenceKey(wrong);assert.notDeepEqual(await readFile(wrong),before);
  const sealed=await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output),manifest=await readFile(path.join(output,"sealed.json"));
  await assert.rejects(verifySealedEvidence(output,"0".repeat(64),key),/checksum/);
  await assert.rejects(readSealedEvidenceRow(output,sealed.sealed_manifest_sha256,wrong,holder,"h1"));
  await assert.rejects(sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output),/EEXIST/);
  assert.deepEqual(await readFile(path.join(output,"sealed.json")),manifest);
  const internal=path.join(output,"key.bin");await writeFile(internal,before);
  await assert.rejects(verifySealedEvidence(output,sealed.sealed_manifest_sha256,internal),/separate/);
  await writeFile(wrong,Buffer.alloc(31));await assert.rejects(verifySealedEvidence(output,sealed.sealed_manifest_sha256,wrong),/32-byte/);
}));

test("repinned encrypted catalog bytes, nonce and authentication tag cannot bypass GCM",()=>fixture(async({source,output,key,catalog})=>{
  await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output);
  const file=path.join(output,"catalog.bin"),saved=await readFile(file),outer=await readFile(path.join(output,"sealed.json"));
  for(const kind of ["bytes","iv","tag"]){
    await writeFile(file,saved);await writeFile(path.join(output,"sealed.json"),outer);
    let changed=Buffer.from(saved);changed[0]^=1;
    if(kind==="bytes")await writeFile(file,changed);
    const pin=await repinOuter(output,m=>{if(kind==="bytes")m.catalog.sha256=sha(changed);else m.catalog[kind]="0".repeat(kind==="iv"?24:32);});
    await assert.rejects(verifySealedEvidence(output,pin,key));
  }
}));

test("swapping individually valid ciphertext descriptors between raw identities fails object AAD",()=>fixture(async({source,output,key,catalog})=>{
  await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output);
  assert.equal(catalog.objects[0].gzip_bytes,catalog.objects[1].gzip_bytes);
  const pin=await repinInner(output,key,m=>{[m.objects[0].sealed,m.objects[1].sealed]=[m.objects[1].sealed,m.objects[0].sealed];});
  await assert.rejects(verifySealedEvidence(output,pin,key));
}));

test("repinned object corruption and original row metadata changes fail; incomplete inner population fails",()=>fixture(async({source,output,key,catalog})=>{
  await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output);
  const manifest=await readFile(path.join(output,"sealed.json")),encryptedCatalog=await readFile(path.join(output,"catalog.bin"));
  const rowPin=await repinInner(output,key,m=>{m.source_catalog.entries[0].metadata[1]="changed";const {catalog_manifest_sha256:ignored,...body}=m.source_catalog;m.source_catalog.catalog_manifest_sha256=sha(JSON.stringify(body));});
  await assert.rejects(verifySealedEvidence(output,rowPin,key),/row checksum/);
  await writeFile(path.join(output,"sealed.json"),manifest);await writeFile(path.join(output,"catalog.bin"),encryptedCatalog);
  const missingPin=await repinInner(output,key,m=>m.objects.pop());await assert.rejects(verifySealedEvidence(output,missingPin,key),/population/);
  await writeFile(path.join(output,"sealed.json"),manifest);await writeFile(path.join(output,"catalog.bin"),encryptedCatalog);
  const corruptPin=await repinInner(output,key,async m=>{const object=m.objects[0],file=path.join(output,"objects",object.sealed.sha256+".bin"),bytes=await readFile(file);bytes[0]^=1;const replacement=path.join(output,"objects",sha(bytes)+".bin");await writeFile(replacement,bytes);object.sealed.sha256=sha(bytes);});
  await assert.rejects(verifySealedEvidence(output,corruptPin,key));
}));

test("selected lookup remains source independent and verifies one object; full verification detects missing other objects",()=>fixture(async({root,source,output,key,catalog})=>{
  const sealed=await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output);
  const restored=await readSealedEvidenceRow(output,sealed.sealed_manifest_sha256,key,holder,"h1");
  const retained=path.join(root,"retained-source");assert.ok([source,retained].every(p=>p.startsWith(root+path.sep)));await rename(source,retained);
  await repinInner(output,key,async m=>{const object=m.objects.find(o=>o.raw_sha256===catalog.entries.at(-1).object_sha256);const file=path.join(output,"objects",object.sealed.sha256+".bin"),held=path.join(root,"held.bin");assert.ok([file,held].every(p=>p.startsWith(root+path.sep)));await rename(file,held);});
  // repinInner preserves semantic metadata but randomizes catalog encryption.
  const pin=JSON.parse(await readFile(path.join(output,"sealed.json"),"utf8")).sealed_manifest_sha256;
  assert.deepEqual((await readSealedEvidenceRow(output,pin,key,holder,"h1")).row,restored.row);
  await assert.rejects(verifySealedEvidence(output,pin,key));
}));

test("unsafe destinations, key links, malformed contracts and altered source objects are held before completion",()=>fixture(async({root,source,output,key,catalog})=>{
  const live=path.join(root,".wrangler");await mkdir(live);await symlink(live,path.join(root,"alias"),"junction");
  for(const target of [path.join(live,"sealed"),path.join(root,"alias","sealed"),path.join(source,"sealed")])await assert.rejects(sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,target));
  const link=path.join(root,"key-link.bin");await symlink(key,link,"file");await assert.rejects(sealEvidenceObjects(source,catalog.catalog_manifest_sha256,link,output),/links/);
  const sealed=await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output),outer=await readFile(path.join(output,"sealed.json"));
  for(const mutate of [m=>{m.version="future";},m=>{m.catalog.file="../escape";},m=>{m.catalog.bytes=20*1024**2+1;},m=>{m.catalog.iv+="\n";}]){
    await writeFile(path.join(output,"sealed.json"),outer);const pin=await repinOuter(output,mutate);await assert.rejects(verifySealedEvidence(output,pin,key));
  }
  const object=path.join(source,"objects",catalog.objects[0].sha256+".gz");await writeFile(object,"corrupt");
  const failed=path.join(root,"failed");await assert.rejects(sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,failed));await assert.rejects(stat(path.join(failed,"sealed.json")),/ENOENT/);
}));

test("CLI creates no key/stdout leak, exports plaintext only to separate new private JSON and never overwrites",()=>fixture(async({root,source,output,key,catalog})=>{
  const cli=args=>spawnSync(process.execPath,["scripts/discovery-evidence-sealed.mjs",...args],{encoding:"utf8"});
  const newKey=path.join(root,"cli-key.bin"),created=cli(["key",newKey]);assert.equal(created.status,0);assert.equal(JSON.parse(created.stdout).key_printed,false);
  const sealed=await sealEvidenceObjects(source,catalog.catalog_manifest_sha256,key,output),file=path.join(root,"selected.json"),args=["lookup",output,sealed.sealed_manifest_sha256,key,holder,"h1",file];
  const result=cli(args);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).plaintext_export,true);assert.ok(!result.stdout.includes("PRIVATE-MINT"));
  const before=await readFile(file);assert.equal(JSON.parse(before).row.address,"PRIVATE-MINT\0tail");assert.equal(cli(args).status,1);assert.deepEqual(await readFile(file),before);
  const invalid=cli(["lookup",output,sealed.sealed_manifest_sha256,newKey,holder,"h1",path.join(root,"wrong.json")]);assert.equal(invalid.status,1);assert.ok(!invalid.stderr.includes((await readFile(key)).toString("hex")));await assert.rejects(stat(path.join(root,"wrong.json")),/ENOENT/);
}));
