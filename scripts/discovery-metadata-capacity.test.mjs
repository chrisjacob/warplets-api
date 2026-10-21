import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdir,mkdtemp,readFile,writeFile,realpath,rm,symlink,stat} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {exportArchive,hashFile} from "./discovery-archive.mjs";
import {packEvidenceObjects} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects} from "./discovery-evidence-sealed.mjs";
import {buildEvidenceIndex} from "./discovery-evidence-index.mjs";
import {buildEvidenceReferences} from "./discovery-evidence-references.mjs";
import {studyMetadataCapacity,verifyMetadataCapacity,compareMetadataCapacity} from "./discovery-metadata-capacity.mjs";
const sha=v=>createHash("sha256").update(v).digest("hex");

async function fixture(run){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","metadata-capacity-test-")),source=path.join(root,"source.sqlite"),db=new DatabaseSync(source);
  db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);
    CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY,payload BLOB);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY,state TEXT);
    CREATE INDEX reservation_state ON tenx_source_reservations(state);INSERT INTO tenx_source_reservations VALUES('spent-failure','failed');
    CREATE TABLE tenx_holder_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);
    CREATE TABLE tenx_wallet_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);
    CREATE TABLE links(id TEXT PRIMARY KEY,hash TEXT REFERENCES tenx_holder_evidence(payload_hash));
    CREATE TABLE "odd""; DROP TABLE tenx_candidates; --"(text TEXT,bytes BLOB,n INTEGER,r REAL);
    CREATE TABLE no_rowid(id TEXT PRIMARY KEY,value BLOB) WITHOUT ROWID;
    CREATE TABLE __proto__(value TEXT);INSERT INTO __proto__ VALUES('preserved');
    CREATE TRIGGER audit AFTER INSERT ON tenx_candidates BEGIN INSERT INTO tenx_source_reservations VALUES(NEW.address,'reserved');END;
    CREATE VIEW retained_candidates AS SELECT address FROM tenx_candidates;
    INSERT INTO tenx_candidates VALUES('private-mint');`);
  db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run("holder","mint\0tail",17,"PAYLOAD-SENTINEL\ufeff\0漢","unchanged-time");
  db.exec("INSERT INTO links VALUES('link','holder')");
  db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run("wallet","mint","","original-time");
  db.prepare('INSERT INTO "odd""; DROP TABLE tenx_candidates; --" VALUES(?,?,?,?)').run("\ufeffunrelated\0tail",new Uint8Array([0,255,17]),9223372036854775807n,1.2345678901234567);
  db.prepare("INSERT INTO no_rowid VALUES(?,?)").run("k",new Uint8Array([1,0,2]));
  async function capture(name){
    const archive=path.join(root,name+"-archive"),a=await exportArchive(source,archive),objects=path.join(root,name+"-objects"),o=await packEvidenceObjects(archive,a.manifest_sha256,objects),key=path.join(root,name+".key");
    await createEvidenceKey(key);const sealed=path.join(root,name+"-sealed"),s=await sealEvidenceObjects(objects,o.catalog_manifest_sha256,key,sealed),index=path.join(root,name+"-index"),i=await buildEvidenceIndex(sealed,s.sealed_manifest_sha256,key,index);
    const refs=path.join(root,name+"-refs"),r=await buildEvidenceReferences(index,i.index_manifest_sha256,refs);return {archive,a,refs,r,study:path.join(root,name+"-study")};
  }
  const study=f=>studyMetadataCapacity(f.archive,f.a.manifest_sha256,f.refs,f.r.reference_manifest_sha256,f.study);
  try{await run({root,source,db,capture,study});}finally{db.close();const actual=await realpath(root),base=await realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("metadata-capacity-test-"));await rm(actual,{recursive:true,force:true});}
}

test("complete private metadata copy preserves all other values/types/schema, failures, foreign keys and source pins",()=>fixture(async({capture,study})=>{
  const f=await capture("first"),before=await hashFile(path.join(f.archive,"discovery.sqlite")),r=await study(f);
  assert.equal(r.evidence.rows,2);assert.equal(r.inventory.length,10);assert.equal(r.all_non_evidence_values_verified,true);assert.equal(r.free_acceptance,false);assert.equal(r.runtime_activated,false);
  assert.equal(r.growth.observed_growth,null);assert.equal(r.capacity_screen.d1_import_accepted,false);assert.deepEqual(r.capacity_screen.row_blocker_tables,[]);
  assert.equal(r.combined_two_database_bytes,r.database.bytes+f.r.database_bytes);assert.equal(await hashFile(path.join(f.archive,"discovery.sqlite")),before);
  assert.deepEqual(await verifyMetadataCapacity(f.study,r.capacity_manifest_sha256),r);
  const copy=new DatabaseSync(path.join(f.study,"capacity.sqlite"),{readOnly:true});try{
    assert.throws(()=>copy.prepare("SELECT payload FROM tenx_holder_evidence"));assert.equal(copy.prepare("SELECT state FROM tenx_source_reservations WHERE id='spent-failure'").get().state,"failed");
    assert.equal(copy.prepare("SELECT count(*) AS n FROM retained_candidates").get().n,1);assert.equal(copy.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{copy.close();}
  assert.ok(!(await readFile(path.join(f.study,"capacity.sqlite"))).includes(Buffer.from("PAYLOAD-SENTINEL")));
}));

test("remaining large rows become explicit blockers; schema/table additions and chronological deltas stay descriptive",()=>fixture(async({db,capture,study})=>{
  const f=await capture("before"),a=await study(f);
  db.exec("CREATE TABLE future_evidence(body BLOB); INSERT INTO future_evidence VALUES(zeroblob(2000001)); INSERT INTO tenx_candidates VALUES('later');");
  const g=await capture("after"),b=await study(g),comparison=await compareMetadataCapacity(f.study,a.capacity_manifest_sha256,g.study,b.capacity_manifest_sha256);
  assert.ok(b.capacity_screen.row_blocker_tables.includes("future_evidence"));assert.equal(comparison.source_schema_changed,true);assert.equal(comparison.forecast,null);assert.equal(comparison.free_acceptance,false);
  assert.ok(comparison.minimum_elapsed_ms>0);assert.equal(comparison.tables.find(t=>t.table==="future_evidence").state,"added");assert.equal(comparison.tables.find(t=>t.table==="tenx_candidates").rows_delta,1);
  assert.equal(comparison.tables.find(t=>t.table==="tenx_source_reservations").rows_delta,1);assert.equal(comparison.encrypted_object_bytes_delta,0);
  await assert.rejects(compareMetadataCapacity(g.study,b.capacity_manifest_sha256,f.study,a.capacity_manifest_sha256),/chronological/);
  await assert.rejects(compareMetadataCapacity(f.study,a.capacity_manifest_sha256,f.study,a.capacity_manifest_sha256),/chronological/);
}));

test("wrong source/reference pins or mismatched archive lineage hold before output",()=>fixture(async({db,capture,study})=>{
  const f=await capture("one");
  await assert.rejects(studyMetadataCapacity(f.archive,"0".repeat(64),f.refs,f.r.reference_manifest_sha256,f.study),/checksum/);
  await assert.rejects(studyMetadataCapacity(f.archive,f.a.manifest_sha256,f.refs,"0".repeat(64),f.study),/checksum/);
  db.exec("INSERT INTO tenx_candidates VALUES('next')");const g=await capture("two");
  await assert.rejects(studyMetadataCapacity(f.archive,f.a.manifest_sha256,g.refs,g.r.reference_manifest_sha256,f.study),/source archive mismatch/);
  await assert.rejects(stat(f.study),/ENOENT/);await study(f);
}));

test("partial/existing outputs, nested artifacts, live paths, junctions and sidecars never overwrite originals",()=>fixture(async({root,capture,study})=>{
  const f=await capture("one"),live=path.join(root,".wrangler");await mkdir(live);await symlink(live,path.join(root,"alias"),"junction");
  for(const out of [path.join(f.archive,"nested"),path.join(f.refs,"nested"),path.join(live,"study"),path.join(root,"alias","study")])await assert.rejects(studyMetadataCapacity(f.archive,f.a.manifest_sha256,f.refs,f.r.reference_manifest_sha256,out));
  const partial=path.join(root,"partial");await mkdir(partial);await writeFile(path.join(partial,"retained"),"failed bytes");
  await assert.rejects(studyMetadataCapacity(f.archive,f.a.manifest_sha256,f.refs,f.r.reference_manifest_sha256,partial),/EEXIST/);assert.equal(await readFile(path.join(partial,"retained"),"utf8"),"failed bytes");
  const r=await study(f);await assert.rejects(study(f),/EEXIST/);
  await writeFile(path.join(f.study,"capacity.sqlite-shm"),"");await assert.rejects(verifyMetadataCapacity(f.study,r.capacity_manifest_sha256),/standalone/);
}));

test("tampered or repinned study contents cannot pass inventory or database checks",()=>fixture(async({capture,study})=>{
  const f=await capture("one"),r=await study(f),file=path.join(f.study,"capacity.sqlite"),db=new DatabaseSync(file);
  db.exec("UPDATE tenx_source_reservations SET state='fresh'");db.close();await assert.rejects(verifyMetadataCapacity(f.study,r.capacity_manifest_sha256),/database pin/);
  const {capacity_manifest_sha256,...body}=r;body.database.sha256=await hashFile(file);const pin=sha(JSON.stringify(body));
  await writeFile(path.join(f.study,"capacity.json"),JSON.stringify({...body,capacity_manifest_sha256:pin}));await assert.rejects(verifyMetadataCapacity(f.study,pin),/inventory/);
}));

test("payload-dependent schema holds without a completion marker and retains its partial copy",()=>fixture(async({db,capture,study})=>{
  db.exec("CREATE VIEW original_raw_holder AS SELECT payload FROM tenx_holder_evidence");const f=await capture("dependent"),pin=f.a.database.sha256;
  await assert.rejects(study(f),/payload|view/);await assert.rejects(stat(path.join(f.study,"capacity.json")),/ENOENT/);
  assert.ok((await stat(path.join(f.study,"capacity.sqlite"))).size>0);assert.equal(await hashFile(path.join(f.archive,"discovery.sqlite")),pin);
}));

test("CLI verifies privately and writes comparison only to a new separate private JSON",()=>fixture(async({root,db,capture,study})=>{
  const f=await capture("before"),a=await study(f);db.exec("INSERT INTO tenx_candidates VALUES('later')");const g=await capture("after"),b=await study(g);
  const cli=(...args)=>spawnSync(process.execPath,["scripts/discovery-metadata-capacity.mjs",...args],{encoding:"utf8"});
  const verified=cli("verify",f.study,a.capacity_manifest_sha256);assert.equal(verified.status,0);assert.equal(JSON.parse(verified.stdout).verified,true);
  const out=path.join(root,"growth.json"),args=["compare",f.study,a.capacity_manifest_sha256,g.study,b.capacity_manifest_sha256,out],compared=cli(...args);
  assert.equal(compared.status,0);assert.equal(JSON.parse(compared.stdout).file_sha256,await hashFile(out));assert.equal(JSON.parse(await readFile(out,"utf8")).forecast,null);
  assert.ok(!compared.stdout.includes("private-mint"));assert.ok(!compared.stdout.includes("PAYLOAD-SENTINEL"));assert.notEqual(cli(...args).status,0);
  assert.notEqual(cli(...args.slice(0,-1),path.join(f.study,"nested.json")).status,0);
}));
