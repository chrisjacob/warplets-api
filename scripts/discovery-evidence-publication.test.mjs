import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createHash,randomUUID} from "node:crypto";
import {exportArchive} from "./discovery-archive.mjs";
import {packEvidenceObjects} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects} from "./discovery-evidence-sealed.mjs";
import {buildEvidenceIndex} from "./discovery-evidence-index.mjs";
import {buildEvidenceReferences} from "./discovery-evidence-references.mjs";
import {studyMetadataCapacity} from "./discovery-metadata-capacity.mjs";
import {createEvidenceAppendStage,stageEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {createEvidencePublicationTarget,publishEvidenceAppend,transferEvidencePublicationOwner,readPublishedEvidenceAppend} from "./discovery-evidence-publication.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex"),at="2026-10-22T02:00:00.000Z";
function receipt(kind="holder",memo="new"){
  const payload=JSON.stringify(kind==="holder"?{mint:"mint",inventory:{context:{slot:42}},memo}:{asset:{address:"mint"},observed_at:at,memo});
  return {table:`tenx_${kind}_evidence`,row:kind==="holder"?{payload_hash:sha(payload),address:"mint",slot:42,payload,observed_at:at}:{payload_hash:sha(payload),address:"mint",payload,observed_at:at}};
}
async function fixture(work){
  await fs.mkdir(".tmp",{recursive:true});const root=await fs.mkdtemp(path.resolve(".tmp","publication-test-")),target=path.resolve(".tmp","publication-target-test-"+randomUUID()),sourceFile=path.join(root,"source.sqlite"),db=new DatabaseSync(sourceFile),network=mock.method(globalThis,"fetch",()=>{throw Error("provider_forbidden");});let copy;
  try{
    db.exec("CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)");for(const name of (await fs.readdir("discovery/migrations")).filter(n=>n.endsWith(".sql")).sort())db.exec(await fs.readFile("discovery/migrations/"+name,"utf8"));
    const baseHolder=receipt("holder","base"),baseWallet=receipt("wallet","base");
    for(const item of [baseHolder,baseWallet]){const r=item.row;if("slot" in r)db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(r.payload_hash,r.address,r.slot,r.payload,r.observed_at);else db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(r.payload_hash,r.address,r.payload,r.observed_at);}
    db.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES('mint','pool','{}',?,'live')").run(at);
    db.prepare("INSERT INTO tenx_wallet_work VALUES('mint',?,'{}',?)").run(baseWallet.row.payload_hash,at);db.prepare("INSERT INTO tenx_usage VALUES('rpc','test',3)").run();db.prepare("INSERT INTO tenx_wallet_usage VALUES('test',3)").run();
    const archive=path.join(root,"archive"),a=await exportArchive(sourceFile,archive),objects=path.join(root,"objects"),o=await packEvidenceObjects(archive,a.manifest_sha256,objects),keyFile=path.join(root,"key.bin");await createEvidenceKey(keyFile);
    const sealedDirectory=path.join(root,"sealed"),s=await sealEvidenceObjects(objects,o.catalog_manifest_sha256,keyFile,sealedDirectory),index=path.join(root,"index"),i=await buildEvidenceIndex(sealedDirectory,s.sealed_manifest_sha256,keyFile,index),referenceDirectory=path.join(root,"references"),r=await buildEvidenceReferences(index,i.index_manifest_sha256,referenceDirectory),capacityDirectory=path.join(root,"capacity"),c=await studyMetadataCapacity(archive,a.manifest_sha256,referenceDirectory,r.reference_manifest_sha256,capacityDirectory);
    const source={capacityDirectory,capacityPin:c.capacity_manifest_sha256,referenceDirectory,referencePin:r.reference_manifest_sha256,sealedDirectory,keyFile},createdStage=await createEvidenceAppendStage({target:path.join(root,"stage"),keyFile,generation:randomUUID(),sourceArchivePin:a.manifest_sha256,baseReferencePin:r.reference_manifest_sha256}),stage={directory:path.join(root,"stage"),contextPin:createdStage.context_pin,keyFile},created=await createEvidencePublicationTarget({target,source,stage,owner:randomUUID()}),options={directory:target,targetPin:created.target_pin,stage};
    copy=new DatabaseSync(path.join(target,"metadata.sqlite"));await work({root,target,db,copy,source,stage,options,grant:created.grant,baseHolder,baseWallet});assert.equal(network.mock.callCount(),0);
  }finally{mock.restoreAll();copy?.close();db.close();for(const file of [target,root]){let actual;try{actual=await fs.realpath(file);}catch(e){if(e.code==="ENOENT")continue;throw e;}const base=await fs.realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&/^publication-(target-)?test-/.test(path.basename(actual)));await fs.rm(actual,{recursive:true,force:true});}}
}
async function planFor(f,item=receipt()){
  const staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item}),publication_id=randomUUID();
  return {publication_id,ticket:staged.ticket,operations:[
    {kind:"sql",sql:"INSERT INTO tenx_wallet_runs(id,address,source_evidence_hash,kind,state,started_at,finished_at,rpc_calls,completed_windows,new_buyers,error_code) VALUES(?1,'mint',NULL,'snapshot','succeeded',?2,?2,3,0,0,NULL)",bindings:[publication_id,at]},
    {kind:"receipt"},
    {kind:"sql",sql:"UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis',json(?1)) WHERE address='mint' AND mode='live'",bindings:[JSON.stringify({evidence_hash:item.row.payload_hash,observed_at:at})],expect_changes:1},
    {kind:"sql",sql:"DELETE FROM tenx_wallet_work WHERE address='mint'",bindings:[]},
    {kind:"sql",sql:"INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) VALUES('mint','wallet',?1,'{}',?2)",bindings:[item.row.payload_hash,at]},
  ]};
}
function snapshot(db,publication=true){return ["tenx_candidates","tenx_wallet_work","tenx_wallet_profiles","tenx_wallet_runs","tenx_holder_evidence","tenx_wallet_evidence",...(publication?["tenx_append_publications","tenx_append_references"]:[])].map(t=>db.prepare(`SELECT * FROM ${t}`).all());}
for(const kind of ["holder","wallet"])test(`${kind} publication commits original producer writes and a readable encrypted reference in order`,()=>fixture(async f=>{
  const item=receipt(kind),plan=await planFor(f,item),before=snapshot(f.db,false),result=await publishEvidenceAppend(f.options,f.grant,plan);
  assert.equal(result.state,"committed");assert.equal(result.reconciled,false);assert.deepEqual(result.results.map(r=>r.meta.changes),[1,1,1,1,1]);assert.equal(result.runtime_activated,false);assert.equal(result.evidence_qualified,false);
  assert.deepEqual((await readPublishedEvidenceAppend(f.options,f.grant,item.table,item.row.payload_hash)).row,item.row);assert.equal(f.copy.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get().used,3);assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage").get().used,3);assert.deepEqual(snapshot(f.db,false),before);
}));
test("an identical publication retry returns recorded results without reapplying producer mutations",()=>fixture(async f=>{
  const plan=await planFor(f),first=await publishEvidenceAppend(f.options,f.grant,plan),before=snapshot(f.copy),second=await publishEvidenceAppend(f.options,f.grant,plan);
  assert.equal(second.reconciled,true);assert.deepEqual(second.results,first.results);assert.deepEqual(snapshot(f.copy),before);
}));
test("published metadata retains exact NUL and multibyte text rather than SQLite text truncation",()=>fixture(async f=>{
  const item=receipt(),address="mint\u0000漢😀";item.row.address=address;item.row.payload=JSON.stringify({...JSON.parse(item.row.payload),mint:address});item.row.payload_hash=sha(item.row.payload);
  const staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item}),plan={publication_id:randomUUID(),ticket:staged.ticket,operations:[{kind:"receipt"}]};await publishEvidenceAppend(f.options,f.grant,plan);assert.deepEqual((await readPublishedEvidenceAppend(f.options,f.grant,item.table,item.row.payload_hash)).row,item.row);assert.equal((await publishEvidenceAppend(f.options,f.grant,plan)).reconciled,true);
}));
test("same publication identity with a changed plan holds without writes",()=>fixture(async f=>{
  const plan=await planFor(f);await publishEvidenceAppend(f.options,f.grant,plan);const before=snapshot(f.copy);plan.operations[2].bindings[0]='{"changed":true}';await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/identity_conflict/);assert.deepEqual(snapshot(f.copy),before);
}));
for(const kind of ["holder","wallet"])test(`${kind} exact base receipt remains bound to its original frozen reference`,()=>fixture(async f=>{
  const item=kind==="holder"?f.baseHolder:f.baseWallet,staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item}),result=await publishEvidenceAppend(f.options,f.grant,{publication_id:randomUUID(),ticket:staged.ticket,operations:[{kind:"receipt"}]});
  assert.equal(result.results[0].meta.changes,0);assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_references").get().n,0);await assert.rejects(readPublishedEvidenceAppend(f.options,f.grant,item.table,item.row.payload_hash),/dynamic_reference_unavailable/);
}));
test("holder repeats from another stage preserve first metadata time and original reference",()=>fixture(async f=>{
  const item=receipt(),first=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item});await publishEvidenceAppend(f.options,f.grant,{publication_id:randomUUID(),ticket:first.ticket,operations:[{kind:"receipt"}]});const before=f.copy.prepare("SELECT * FROM tenx_append_references").all();
  const later=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),table:item.table,row:{...item.row,observed_at:"2026-10-22T02:05:00.000Z"}}),result=await publishEvidenceAppend(f.options,f.grant,{publication_id:randomUUID(),ticket:later.ticket,operations:[{kind:"receipt"}]});assert.equal(result.results[0].meta.changes,0);assert.deepEqual(f.copy.prepare("SELECT * FROM tenx_append_references").all(),before);assert.deepEqual((await readPublishedEvidenceAppend(f.options,f.grant,item.table,item.row.payload_hash)).row,item.row);
}));
test("a mismatched immutable metadata row aborts all preceding producer writes",()=>fixture(async f=>{
  f.copy.prepare("UPDATE tenx_holder_evidence SET slot=43").run();const plan=await planFor(f,f.baseHolder),before=snapshot(f.copy);await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/immutable_collision/);assert.deepEqual(snapshot(f.copy),before);
}));
test("an unreferenced metadata row holds rather than becoming admitted evidence",()=>fixture(async f=>{
  const item=receipt(),plan=await planFor(f,item);f.copy.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?)").run(item.row.payload_hash,item.row.address,item.row.slot,item.row.observed_at);const before=snapshot(f.copy);await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/existing_reference_missing/);assert.deepEqual(snapshot(f.copy),before);
}));
test("a later SQL failure rolls back receipt, run, candidate, work and profiles without refunding quotas",()=>fixture(async f=>{
  const plan=await planFor(f);plan.operations.push({...plan.operations.at(-1)});const before=snapshot(f.copy);await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/UNIQUE/);assert.deepEqual(snapshot(f.copy),before);assert.equal(f.copy.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get().used,3);assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage").get().used,3);
}));
test("caller compare-and-swap expectations roll back on zero changed rows",()=>fixture(async f=>{
  const plan=await planFor(f);plan.operations[2].sql+=" AND json_extract(payload,'$.missing')='expected'";const before=snapshot(f.copy);await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/expected_changes_mismatch/);assert.deepEqual(snapshot(f.copy),before);
}));
test("wrong generation, owner and epoch cannot publish or read committed references",()=>fixture(async f=>{
  const item=receipt(),plan=await planFor(f,item);await publishEvidenceAppend(f.options,f.grant,plan);const before=snapshot(f.copy);
  for(const change of [{generation:randomUUID()},{owner:randomUUID()},{epoch:2}]){const stale={...f.grant,...change};await assert.rejects(publishEvidenceAppend(f.options,stale,plan),/owner_fenced/);await assert.rejects(readPublishedEvidenceAppend(f.options,stale,item.table,item.row.payload_hash),/owner_fenced/);}assert.deepEqual(snapshot(f.copy),before);
}));
test("ownership epochs prevent old grants from reviving when the same owner returns",()=>fixture(async f=>{
  const plan=await planFor(f),next=await transferEvidencePublicationOwner(f.options,f.grant,randomUUID()),returned=await transferEvidencePublicationOwner(f.options,next.grant,f.grant.owner);assert.equal(returned.grant.epoch,3);await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/owner_fenced/);assert.equal((await publishEvidenceAppend(f.options,returned.grant,plan)).state,"committed");await assert.rejects(transferEvidencePublicationOwner(f.options,f.grant,randomUUID()),/owner_fenced/);
}));
test("ownership changed after staged-object verification is checked again inside the transaction",()=>fixture(async f=>{
  const plan=await planFor(f),open=fs.open;let next;
  const hook=mock.method(fs,"open",async(file,mode,...args)=>{const handle=await open(file,mode,...args);if(mode==="r"&&String(file).endsWith("object.bin")&&!next){const close=handle.close.bind(handle);handle.close=async()=>{await close();next=await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());};}return handle;});
  try{await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/owner_fenced/);}finally{hook.mock.restore();}assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get().n,0);assert.equal((await publishEvidenceAppend(f.options,next.grant,plan)).state,"committed");
}));
test("a read in flight cannot release a published row after ownership changes",()=>fixture(async f=>{
  const item=receipt(),plan=await planFor(f,item);await publishEvidenceAppend(f.options,f.grant,plan);const open=fs.open;let next;
  const hook=mock.method(fs,"open",async(file,mode,...args)=>{const handle=await open(file,mode,...args);if(mode==="r"&&String(file).endsWith("object.bin")&&!next){const close=handle.close.bind(handle);handle.close=async()=>{await close();next=await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());};}return handle;});
  try{await assert.rejects(readPublishedEvidenceAppend(f.options,f.grant,item.table,item.row.payload_hash),/owner_fenced/);}finally{hook.mock.restore();}assert.deepEqual((await readPublishedEvidenceAppend(f.options,next.grant,item.table,item.row.payload_hash)).row,item.row);
}));
test("commit succeeded but acknowledgement was lost reconciles once under the current owner",()=>fixture(async f=>{
  const plan=await planFor(f),exec=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(sql){const value=exec.call(this,sql);if(sql==="COMMIT"&&!lost){lost=true;throw Error("lost_ack");}return value;});
  try{await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/commit_acknowledgement_unknown/);}finally{hook.mock.restore();}
  const before=snapshot(f.copy),next=await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/owner_fenced/);const result=await publishEvidenceAppend(f.options,next.grant,plan);assert.equal(result.reconciled,true);assert.deepEqual(snapshot(f.copy),before);
}));
test("cohort callback failure remains a committed publication with an explicit post-commit failure",()=>fixture(async f=>{
  const plan=await planFor(f),result=await publishEvidenceAppend(f.options,f.grant,plan,async()=>{throw Error("private callback detail");});assert.equal(result.state,"committed");assert.equal(result.post_commit,"failed");assert.equal(result.post_commit_error,"publication_post_commit_work_failed");assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get().n,1);let calls=0;const retry=await publishEvidenceAppend(f.options,f.grant,plan,async()=>{calls++;});assert.equal(retry.reconciled,true);assert.equal(retry.post_commit,"completed");assert.equal(calls,1);
}));
test("post-commit callbacks cannot mutate the returned commit state or results",()=>fixture(async f=>{
  const result=await publishEvidenceAppend(f.options,f.grant,await planFor(f),async copy=>{copy.state="failed";copy.results.length=0;});assert.equal(result.state,"committed");assert.equal(result.results.length,5);assert.equal(result.post_commit,"completed");
}));
test("missing committed receipt metadata is held on reconciliation without reconstruction",()=>fixture(async f=>{
  const item=receipt(),plan=await planFor(f,item);await publishEvidenceAppend(f.options,f.grant,plan);f.copy.prepare("DELETE FROM tenx_holder_evidence WHERE payload_hash=?").run(item.row.payload_hash);const before=snapshot(f.copy);await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/existing_reference_missing/);assert.deepEqual(snapshot(f.copy),before);
}));
for(const sql of ["UPDATE tenx_usage SET used=0","DELETE FROM tenx_append_control","UPDATE tenx_candidates SET payload='{}'; COMMIT","UPDATE tenx_candidates SET payload='{}' -- escape","UPDATE tenx_candidates SET payload='{}' RETURNING payload","PRAGMA journal_mode=OFF"])test(`disallowed publication SQL holds: ${sql}`,()=>fixture(async f=>{
  const plan=await planFor(f),before=snapshot(f.copy);plan.operations.push({kind:"sql",sql,bindings:[]});await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/sql_not_allowed/);assert.deepEqual(snapshot(f.copy),before);
}));
test("wrong target pins and changed schema fail before metadata mutation",()=>fixture(async f=>{
  const plan=await planFor(f);await assert.rejects(publishEvidenceAppend({...f.options,targetPin:"f".repeat(64)},f.grant,plan),/target_pin_mismatch/);f.copy.exec("CREATE TABLE unexpected(id INTEGER)");await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/schema_changed/);
}));
test("invalid plans and existing targets cannot bypass bounds or reset ownership",()=>fixture(async f=>{
  const plan=await planFor(f),before=snapshot(f.copy);
  for(const operations of [[],[{kind:"receipt"},{kind:"receipt"}],Array.from({length:129},()=>({kind:"receipt"})),[{kind:"receipt"},{kind:"sql",sql:"UPDATE tenx_candidates SET payload=?1",bindings:Array(101).fill(0)}],[{kind:"receipt"},{kind:"sql",sql:"UPDATE tenx_candidates SET payload=?1",bindings:Array(6).fill("x".repeat(2000000))}]])await assert.rejects(publishEvidenceAppend(f.options,f.grant,{...plan,operations}));
  await assert.rejects(createEvidencePublicationTarget({target:f.target,source:f.source,stage:f.stage,owner:randomUUID()}));assert.deepEqual(snapshot(f.copy),before);assert.equal((await publishEvidenceAppend(f.options,f.grant,plan)).state,"committed");
}));
test("corrupt committed ciphertext holds on reconciliation and reads without relabeling its SQL commit",()=>fixture(async f=>{
  const item=receipt(),plan=await planFor(f,item);await publishEvidenceAppend(f.options,f.grant,plan);const file=path.join(f.stage.directory,"pending",plan.ticket.stage_id,"object.bin"),bytes=await fs.readFile(file);bytes[0]^=1;await fs.writeFile(file,bytes);const before=snapshot(f.copy);await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan));await assert.rejects(readPublishedEvidenceAppend(f.options,f.grant,item.table,item.row.payload_hash));assert.deepEqual(snapshot(f.copy),before);
}));
