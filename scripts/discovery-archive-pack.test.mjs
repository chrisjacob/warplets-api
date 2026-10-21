import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,mkdir,readFile,writeFile,rm,rename,symlink} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {exportArchive,verifyArchive,hashFile} from "./discovery-archive.mjs";
import {packArchive,verifyPack,unpackArchive,PACK_MAX_BYTES} from "./discovery-archive-pack.mjs";

const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function fixture(run){
  const root=await mkdtemp(path.join(os.tmpdir(),"tenx-pack-")),source=path.join(root,"source.sqlite"),db=new DatabaseSync(source);
  db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);INSERT INTO d1_migrations VALUES('0043_fixture.sql');
    CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);INSERT INTO tenx_candidates VALUES('original-mint');
    CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY,address TEXT REFERENCES tenx_candidates(address),payload BLOB);
    INSERT INTO tenx_score_cohorts VALUES('frozen-v4','original-mint',x'00ff01');
    CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY,state TEXT);INSERT INTO tenx_source_reservations VALUES('used-allowance','failed');
    CREATE TABLE private_sessions(id TEXT PRIMARY KEY,payload TEXT);INSERT INTO private_sessions VALUES('test-session','synthetic-private-value');
    CREATE TABLE large_evidence(id TEXT PRIMARY KEY,payload TEXT);`);
  db.prepare("INSERT INTO large_evidence VALUES('retained',?)").run('original evidence '.repeat(20000));
  try{
    const archive=path.join(root,"archive"),original=await exportArchive(source,archive);
    await run({root,source,db,archive,original,packed:path.join(root,"packed"),restored:path.join(root,"restored")});
  }finally{
    db.close();const absolute=path.resolve(root);
    assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(absolute).startsWith("tenx-pack-"));
    await rm(absolute,{recursive:true,force:true});
  }
}
async function repin(directory,mutate){
  const file=path.join(directory,"pack.json"),manifest=JSON.parse(await readFile(file,"utf8"));
  await mutate(manifest);
  const {manifest_sha256,...source}=manifest.source_manifest;
  manifest.source_manifest.manifest_sha256=digest(source);manifest.source_manifest_sha256=manifest.source_manifest.manifest_sha256;
  const {pack_manifest_sha256,...body}=manifest;manifest.pack_manifest_sha256=digest(body);
  await writeFile(file,JSON.stringify(manifest));return manifest.pack_manifest_sha256;
}

test("compressed standalone archive restores every exact byte, unknown private tables, frozen inputs and spent allowance without source writes",()=>fixture(async f=>{
  const before=await hashFile(path.join(f.archive,"discovery.sqlite")),changes=f.db.prepare("SELECT total_changes() n").get().n;
  const pack=await packArchive(f.archive,f.original.manifest_sha256,f.packed);
  assert(pack.compressed.bytes<pack.source_manifest.database.bytes/2);
  assert.equal((await verifyPack(f.packed,pack.pack_manifest_sha256)).source_manifest_sha256,f.original.manifest_sha256);
  await rename(f.archive,f.archive+"-kept"); // The pack does not depend on its source directory being present.
  const result=await unpackArchive(f.packed,pack.pack_manifest_sha256,f.restored);
  assert.equal(result.runtime_activated,false);assert.equal(result.network_requests,0);
  assert.equal(await hashFile(path.join(f.restored,"discovery.sqlite")),before);
  assert.deepEqual(await verifyArchive(f.restored,f.original.manifest_sha256),f.original);
  const restored=new DatabaseSync(path.join(f.restored,"discovery.sqlite"),{readOnly:true});
  try{
    assert.equal(restored.prepare("SELECT payload FROM private_sessions").get().payload,"synthetic-private-value");
    assert.equal(restored.prepare("SELECT state FROM tenx_source_reservations").get().state,"failed");
    assert.deepEqual([...restored.prepare("SELECT payload FROM tenx_score_cohorts").get().payload],[0,255,1]);
  }finally{restored.close();}
  assert.equal(f.db.prepare("SELECT total_changes() n").get().n,changes);
  assert.equal(f.db.prepare("PRAGMA journal_mode").get().journal_mode,"wal");
  assert.equal(await hashFile(path.join(f.archive+"-kept","discovery.sqlite")),before);
}));

test("requires independently pinned source/pack manifests and refuses existing pack/unpack outputs",()=>fixture(async f=>{
  await assert.rejects(packArchive(f.archive,"0".repeat(64),f.packed),/checksum/);
  const pack=await packArchive(f.archive,f.original.manifest_sha256,f.packed);
  await assert.rejects(verifyPack(f.packed,"0".repeat(64)),/checksum/);
  await assert.rejects(verifyPack(f.packed,"invalid"),/independently/);
  await assert.rejects(packArchive(f.archive,f.original.manifest_sha256,f.packed),/EEXIST/);
  await mkdir(f.restored);await writeFile(path.join(f.restored,"sentinel"),"keep");
  await assert.rejects(unpackArchive(f.packed,pack.pack_manifest_sha256,f.restored),/EEXIST/);
  assert.equal(await readFile(path.join(f.restored,"sentinel"),"utf8"),"keep");
}));

test("rejects changed or truncated gzip bytes and repinned invalid CRC streams",()=>fixture(async f=>{
  const pack=await packArchive(f.archive,f.original.manifest_sha256,f.packed),file=path.join(f.packed,"discovery.sqlite.gz"),bytes=await readFile(file);
  await writeFile(file,bytes.subarray(0,bytes.length-1));await assert.rejects(verifyPack(f.packed,pack.pack_manifest_sha256),/size/);
  const changed=Buffer.from(bytes);changed[changed.length-5]^=1;await writeFile(file,changed);
  await assert.rejects(verifyPack(f.packed,pack.pack_manifest_sha256));
  const pin=await repin(f.packed,m=>{m.compressed.sha256=createHash("sha256").update(changed).digest("hex");});
  await assert.rejects(verifyPack(f.packed,pin));
}));

test("enforces the declared decompressed byte ceiling even when all manifest pins are recomputed",()=>fixture(async f=>{
  await packArchive(f.archive,f.original.manifest_sha256,f.packed);
  const pin=await repin(f.packed,m=>{m.source_manifest.database.bytes=8;});
  await assert.rejects(verifyPack(f.packed,pin),/byte bound/);
  await assert.rejects(unpackArchive(f.packed,pin,f.restored),/byte bound/);
  await assert.rejects(readFile(path.join(f.restored,"discovery.sqlite")),/ENOENT/);
}));

test("rejects oversized declarations, path traversal, unknown codecs and inner checksum mismatch",()=>fixture(async f=>{
  const pack=await packArchive(f.archive,f.original.manifest_sha256,f.packed),manifestFile=path.join(f.packed,"pack.json"),original=await readFile(manifestFile);
  for(const mutate of [m=>{m.source_manifest.database.bytes=PACK_MAX_BYTES+1;},m=>{m.compressed.file="../../outside";},m=>{m.codec="zip";},m=>{m.source_manifest.database.sha256="0".repeat(64);}]){
    await writeFile(manifestFile,original);const pin=await repin(f.packed,mutate);await assert.rejects(verifyPack(f.packed,pin));
  }
  await writeFile(manifestFile,original);assert.equal((await verifyPack(f.packed,pack.pack_manifest_sha256)).version,pack.version);
}));

test("refuses live Wrangler destinations and parent-junction aliases without resetting or adopting a store",()=>fixture(async f=>{
  const wrangler=path.join(f.root,".wrangler");await mkdir(wrangler);
  await assert.rejects(packArchive(f.archive,f.original.manifest_sha256,path.join(wrangler,"packed")),/outside/);
  const pack=await packArchive(f.archive,f.original.manifest_sha256,f.packed);
  await assert.rejects(unpackArchive(f.packed,pack.pack_manifest_sha256,path.join(wrangler,"restored")),/outside/);
  const alias=path.join(f.root,"alias");await symlink(wrangler,alias,process.platform==="win32"?"junction":"dir");
  await assert.rejects(unpackArchive(f.packed,pack.pack_manifest_sha256,path.join(alias,"restored")),/outside/);
}));

test("whole-file stream verification is not a substitute for final SQLite/inventory verification",()=>fixture(async f=>{
  await packArchive(f.archive,f.original.manifest_sha256,f.packed);
  const raw=Buffer.from("not a SQLite database"),gzip=gzipSync(raw);await writeFile(path.join(f.packed,"discovery.sqlite.gz"),gzip);
  const pin=await repin(f.packed,m=>{m.compressed.bytes=gzip.length;m.compressed.sha256=createHash("sha256").update(gzip).digest("hex");m.source_manifest.database.bytes=raw.length;m.source_manifest.database.sha256=createHash("sha256").update(raw).digest("hex");});
  await verifyPack(f.packed,pin); // Exact bytes can match a caller's pin without being a valid database.
  await assert.rejects(unpackArchive(f.packed,pin,f.restored));
  await assert.rejects(verifyArchive(f.restored,JSON.parse(await readFile(path.join(f.packed,"pack.json"),"utf8")).source_manifest_sha256));
}));
