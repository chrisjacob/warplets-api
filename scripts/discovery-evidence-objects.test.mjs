import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,writeFile,rm,rename,symlink,stat,realpath} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {exportArchive,hashFile} from "./discovery-archive.mjs";
import {packEvidenceObjects,verifyEvidenceObjects,readEvidenceObjectRow,objectSummary} from "./discovery-evidence-objects.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const holder="tenx_holder_evidence",wallet="tenx_wallet_evidence";
async function fixture(run,change=()=>{}){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","evidence-objects-test-")),file=path.join(root,"source.sqlite"),db=new DatabaseSync(file);
  db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);
    CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY);
    CREATE TABLE tenx_holder_evidence(payload_hash TEXT PRIMARY KEY,address TEXT NOT NULL,slot INTEGER NOT NULL,payload TEXT NOT NULL,observed_at TEXT NOT NULL);
    CREATE TABLE tenx_wallet_evidence(payload_hash TEXT PRIMARY KEY,address TEXT NOT NULL,payload TEXT NOT NULL,observed_at TEXT NOT NULL);
    CREATE TABLE private_sessions(secret TEXT);INSERT INTO private_sessions VALUES('DO-NOT-COPY-SESSION');`);
  const payload=' {"owners":["漢",null],"amount":1e3,"text":"not normalized"} ';
  db.prepare(`INSERT INTO ${holder} VALUES(?,?,?,?,?)`).run("h1","mint\0tail",7,payload,"original-time");
  db.prepare(`INSERT INTO ${holder} VALUES(?,?,?,?,?)`).run("h2","mint",8,payload,"later-time");
  db.prepare(`INSERT INTO ${holder} VALUES(?,?,?,?,?)`).run("h3","mint",9,"","empty-time");
  db.prepare(`INSERT INTO ${wallet} VALUES(?,?,?,?)`).run("w1","mint","\ufeffnot-json\0漢","unchanged-time");
  const archive=path.join(root,"archive"),target=path.join(root,"objects");
  try{await change(db);const original=Object.fromEntries([holder,wallet].map(t=>{const cols=db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name);return [t,db.prepare(`SELECT ${cols.map(c=>c==="slot"?c:`CAST(${c} AS BLOB) AS ${c}`).join(",")} FROM ${t} ORDER BY payload_hash`).all().map(row=>Object.fromEntries(cols.map(c=>[c,c==="slot"?row[c]:row[c]===null?null:Buffer.from(row[c]).toString("utf8")])))]})),source=await exportArchive(file,archive);
    await run({root,archive,target,source,original});
  }finally{db.close();const absolute=await realpath(root),base=await realpath(".tmp");assert.ok(absolute.startsWith(base+path.sep)&&path.basename(absolute).startsWith("evidence-objects-test-"));await rm(absolute,{recursive:true,force:true});}
}
async function repin(target,mutate){const file=path.join(target,"objects.json"),value=JSON.parse(await readFile(file,"utf8"));mutate(value);const {catalog_manifest_sha256:ignored,...body}=value;value.catalog_manifest_sha256=sha(JSON.stringify(body));await writeFile(file,JSON.stringify(value));return value.catalog_manifest_sha256;}
const objectFile=(target,manifest,index=0)=>path.join(target,"objects",manifest.objects[index].sha256+".gz");

test("exact rows, empty/BOM/NUL/Unicode payloads and original times survive; equal payloads deduplicate without copying sessions",()=>fixture(async({archive,target,source,original})=>{
  const before=await hashFile(path.join(archive,"discovery.sqlite")),manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),pin=manifest.catalog_manifest_sha256;
  assert.deepEqual(objectSummary(manifest),{catalog_manifest_sha256:pin,source_manifest_sha256:source.manifest_sha256,rows:4,objects:3,duplicate_payload_references:1,
    raw_payload_bytes:manifest.entries.reduce((n,e)=>n+manifest.objects.find(o=>o.sha256===e.object_sha256).bytes,0),unique_payload_bytes:manifest.objects.reduce((n,o)=>n+o.bytes,0),compressed_object_bytes:manifest.objects.reduce((n,o)=>n+o.gzip_bytes,0),encrypted:false,full_database_archive:false,runtime_activated:false,network_requests:0,action_authority:false});
  for(const table of [holder,wallet])for(const row of original[table]){const restored=await readEvidenceObjectRow(target,pin,table,row.payload_hash);assert.deepEqual(restored.row,{...row});assert.equal(restored.row_sha256,sha(JSON.stringify(row)));assert.equal(restored.objects_read,1);assert.equal(restored.other_objects_verified,false);}
  assert.equal((await verifyEvidenceObjects(target,pin)).entries.length,4);assert.equal(await hashFile(path.join(archive,"discovery.sqlite")),before);
  assert.ok(!(await readFile(path.join(target,"objects.json"),"utf8")).includes("DO-NOT-COPY-SESSION"));
}));
test("one-row lookup needs no source archive or unrelated object; full verification still rejects the incomplete pack",()=>fixture(async({root,archive,target,source})=>{
  const manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),pin=manifest.catalog_manifest_sha256;
  const retained=path.join(root,"retained-archive");assert.ok([archive,retained].every(p=>path.resolve(p).startsWith(root+path.sep)));await rename(archive,retained);
  const unrelated=objectFile(target,manifest,2),held=path.join(root,"retained-object.gz");assert.ok([unrelated,held].every(p=>path.resolve(p).startsWith(root+path.sep)));await rename(unrelated,held);
  assert.equal((await readEvidenceObjectRow(target,pin,holder,"h1")).row.slot,7);await assert.rejects(verifyEvidenceObjects(target,pin));
}));
test("existing outputs and wrong independently retained pins never replace evidence",()=>fixture(async({archive,target,source})=>{
  const manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),file=path.join(target,"objects.json"),before=await readFile(file);
  await assert.rejects(packEvidenceObjects(archive,source.manifest_sha256,target),/EEXIST/);assert.deepEqual(await readFile(file),before);
  await assert.rejects(verifyEvidenceObjects(target,"0".repeat(64)),/checksum/);await assert.rejects(packEvidenceObjects(archive,"0".repeat(64),target+"-wrong"),/checksum/);
}));
test("changed compressed bytes, repinned raw identity and row metadata cannot pass verification",()=>fixture(async({archive,target,source})=>{
  const manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),file=objectFile(target,manifest),original=await readFile(file),changed=Buffer.from(original);changed[12]^=1;await writeFile(file,changed);
  await assert.rejects(verifyEvidenceObjects(target,manifest.catalog_manifest_sha256),/checksum/);await writeFile(file,original);
  const pin=await repin(target,m=>{m.entries[0].metadata[1]="changed mint";});await assert.rejects(verifyEvidenceObjects(target,pin),/row checksum/);
  const rawPin=await repin(target,m=>{const prior=m.objects[0].sha256;m.objects[0].sha256="a".repeat(64);for(const e of m.entries)if(e.object_sha256===prior)e.object_sha256="a".repeat(64);});
  const moved=path.join(target,"objects","a".repeat(64)+".gz");assert.ok([file,moved].every(p=>path.resolve(p).startsWith(target+path.sep)));await rename(file,moved);await assert.rejects(verifyEvidenceObjects(target,rawPin),/raw checksum/);
}));
test("repinning truncated gzip or an understated expansion bound cannot bypass decompression checks",()=>fixture(async({archive,target,source})=>{
  const manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),file=objectFile(target,manifest),original=await readFile(file),truncated=original.subarray(0,-5);await writeFile(file,truncated);
  const pin=await repin(target,m=>{m.objects[0].gzip_bytes=truncated.length;m.objects[0].gzip_sha256=sha(truncated);});await assert.rejects(verifyEvidenceObjects(target,pin));
  await writeFile(file,original);const small=await repin(target,m=>{m.objects[0].gzip_bytes=original.length;m.objects[0].gzip_sha256=sha(original);m.objects[0].bytes=1;});await assert.rejects(verifyEvidenceObjects(target,small),/larger|length|size/i);
}));
test("repinned missing/duplicate rows, orphan objects, path fields and unsupported contracts are rejected",()=>fixture(async({archive,target,source})=>{
  const manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),saved=await readFile(path.join(target,"objects.json"));
  for(const mutate of [m=>m.entries.pop(),m=>m.entries.push(m.entries[0]),m=>m.objects.push({...m.objects[0],sha256:"a".repeat(64)}),m=>{m.objects[0].sha256="../escape";},m=>{m.objects[0].file="../escape";},m=>{m.version="future";},m=>{m.encrypted=true;}]){
    await writeFile(path.join(target,"objects.json"),saved);const pin=await repin(target,mutate);await assert.rejects(verifyEvidenceObjects(target,pin));
  }
}));
test("oversized or unknown-layout source populations fail without producing a completion marker",()=>fixture(async({archive,target,source})=>{
  await assert.rejects(packEvidenceObjects(archive,source.manifest_sha256,target),/offline bounds/);await assert.rejects(stat(path.join(target,"objects.json")),/ENOENT/);
},db=>db.prepare(`UPDATE ${holder} SET payload=? WHERE payload_hash='h1'`).run("x".repeat(2000001))));
test("unrepresentable original text is held, never normalized or marked complete",()=>fixture(async({archive,target,source})=>{
  await assert.rejects(packEvidenceObjects(archive,source.manifest_sha256,target),/exact UTF-8/);await assert.rejects(stat(path.join(target,"objects.json")),/ENOENT/);
},db=>db.exec(`UPDATE ${holder} SET payload=CAST(x'ff' AS TEXT) WHERE payload_hash='h1'`)));
test("new source columns are held instead of silently omitted",()=>fixture(async({archive,target,source})=>{
  await assert.rejects(packEvidenceObjects(archive,source.manifest_sha256,target),/table layout/);
},db=>db.exec(`ALTER TABLE ${wallet} ADD COLUMN future_field TEXT`)));
test("Wrangler paths, junction aliases and object-file links are refused",()=>fixture(async({root,archive,target,source})=>{
  const live=path.join(root,".wrangler");await mkdir(live);await symlink(live,path.join(root,"alias"),"junction");
  for(const dest of [path.join(live,"pack"),path.join(root,"alias","pack")])await assert.rejects(packEvidenceObjects(archive,source.manifest_sha256,dest),/private/);
  const manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),file=objectFile(target,manifest),retained=path.join(root,"retained.gz");assert.ok([file,retained].every(p=>path.resolve(p).startsWith(root+path.sep)));await rename(file,retained);await symlink(retained,file,"file");await assert.rejects(verifyEvidenceObjects(target,manifest.catalog_manifest_sha256),/links/);
}));
test("CLI lookup writes only a new private JSON export and prints no row payload",()=>fixture(async({root,archive,target,source})=>{
  const manifest=await packEvidenceObjects(archive,source.manifest_sha256,target),out=path.join(root,"selected.json"),args=["scripts/discovery-evidence-objects.mjs","lookup",target,manifest.catalog_manifest_sha256,holder,"h1",out];
  const first=spawnSync(process.execPath,args,{encoding:"utf8"});assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).objects_read,1);assert.ok(!first.stdout.includes("not normalized"));
  const before=await readFile(out),again=spawnSync(process.execPath,args,{encoding:"utf8"});assert.equal(again.status,1);assert.match(again.stderr,/EEXIST/);assert.deepEqual(await readFile(out),before);
}));
