import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,receipt} from "./discovery-evidence-publication-test-helper.mjs";
import {stageEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {transferEvidencePublicationOwner,reconcileEvidenceAppend} from "./discovery-evidence-publication.mjs";
import {createEvidenceIntentJournal,persistEvidencePublicationIntent,readEvidencePublicationIntent,publishStoredEvidenceIntent,reconcileStoredEvidenceIntent} from "./discovery-evidence-intents.mjs";
const exec=promisify(execFile),sha=bytes=>createHash("sha256").update(bytes).digest("hex");
async function setup(work,kind="holder"){
  const directory=path.resolve(".tmp","intent-test-"+randomUUID());
  try{await fixture(async f=>{
    const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant}),journal={directory,contextPin:created.context_pin},item=receipt(kind),staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item}),plan={publication_id:randomUUID(),ticket:staged.ticket,operations:[{kind:"sql",sql:"UPDATE tenx_candidates SET checked_at=checked_at||'x' WHERE address='mint'",bindings:[]},{kind:"receipt"}]};
    await work({...f,journal,item,plan});
  });}finally{try{const actual=await fs.realpath(directory),root=await fs.realpath(".tmp");assert.ok(actual.startsWith(root+path.sep)&&path.basename(actual).startsWith("intent-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if(error.code!=="ENOENT")throw error;}}
}
const files=f=>["intent.bin","ready.json"].map(name=>path.join(f.journal.directory,"pending",f.plan.publication_id,name));
const snapshot=f=>["tenx_candidates","tenx_append_publications","tenx_append_references","tenx_usage","tenx_wallet_usage"].map(table=>f.copy.prepare(`SELECT * FROM ${table}`).all());
async function persist(f){return persistEvidencePublicationIntent(f.options,f.journal,f.grant,f.plan);}
async function child(f,mode,code=0,grant=f.grant){
  const file=path.join(f.root,"restart.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant,id:f.plan.publication_id,...(["persist_stop","partial_cipher","before_ready"].includes(mode)?{plan:f.plan}:{})}),{mode:0o600});
  try{const result=await exec(process.execPath,["scripts/evidence-intent-restart-fixture.mjs",file,mode],{maxBuffer:100000,timeout:30000});assert.equal(code,0);return JSON.parse(result.stdout);}
  catch(error){assert.equal(error.code,code,error.stderr);return null;}
}
for(const kind of ["holder","wallet"])test(`${kind}: encrypted intent persists exact plan, retries immutably and does not write SQL`,()=>setup(async f=>{
  const before=snapshot(f),saved=await persist(f),first=await Promise.all(files(f).map(file=>fs.readFile(file))),restored=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.plan.publication_id);
  assert.deepEqual(restored.plan,f.plan);assert.deepEqual(restored.original_grant,f.grant);assert.equal(saved.reused,false);assert.equal((await persist(f)).reused,true);assert.deepEqual(await Promise.all(files(f).map(file=>fs.readFile(file))),first);assert.deepEqual(snapshot(f),before);
  for(const bytes of first)for(const privateText of ["tenx_candidates",f.item.row.payload,f.grant.owner])assert.equal(bytes.includes(Buffer.from(privateText)),false);
},kind));
test("a fresh process persists and exits after readiness; another publishes the same intent without original plan arguments",()=>setup(async f=>{
  await child(f,"persist_stop",71);assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get().n,0);
  const published=await child(f,"publish");assert.equal(published.reconciled,false);assert.deepEqual(published.results.map(r=>r.meta.changes),[1,1]);const before=snapshot(f);
  assert.equal((await child(f,"reconcile")).reconciled,true);assert.deepEqual(snapshot(f),before);
  assert.equal(f.copy.prepare("SELECT checked_at FROM tenx_candidates").get().checked_at.endsWith("xx"),false);
}));
test("a process exits after SQL commit before acknowledgement; a fresh process reconciles without a second mutation",()=>setup(async f=>{
  await persist(f);await child(f,"commit_stop",72);const before=snapshot(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));
  const restored=await child(f,"reconcile");assert.equal(restored.state,"committed");assert.equal(restored.reconciled,true);assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));
test("a replacement owner cannot publish a former owner's uncommitted intent or reconcile it as committed",()=>setup(async f=>{
  await persist(f);const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=snapshot(f);
  await assert.rejects(publishStoredEvidenceIntent(f.options,f.journal,next,f.plan.publication_id),/original_owner_required/);
  await assert.rejects(reconcileStoredEvidenceIntent(f.options,f.journal,next,f.plan.publication_id),/reconciliation_requires_commit/);assert.deepEqual(snapshot(f),before);
  await assert.rejects(publishStoredEvidenceIntent(f.options,f.journal,f.grant,f.plan.publication_id),/owner_fenced/);
}));
test("a replacement owner reconciles an existing commit read-only; changed plans cannot be relabeled",()=>setup(async f=>{
  await persist(f);await publishStoredEvidenceIntent(f.options,f.journal,f.grant,f.plan.publication_id);const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=sha(await fs.readFile(path.join(f.target,"metadata.sqlite")));
  assert.equal((await child(f,"reconcile",0,next)).reconciled,true);assert.equal(sha(await fs.readFile(path.join(f.target,"metadata.sqlite"))),before);
  await assert.rejects(reconcileEvidenceAppend(f.options,next,{...f.plan,operations:[{kind:"receipt"}]}),/identity_conflict/);
}));
test("returning the same owner UUID at a later epoch cannot revive its unpublished intent",()=>setup(async f=>{
  await persist(f);const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,returned=(await transferEvidencePublicationOwner(f.options,next,f.grant.owner)).grant;
  await assert.rejects(publishStoredEvidenceIntent(f.options,f.journal,returned,f.plan.publication_id),/original_owner_required/);await assert.rejects(reconcileStoredEvidenceIntent(f.options,f.journal,returned,f.plan.publication_id),/requires_commit/);
}));
for(const name of ["intent.bin","ready.json"])test(`corrupt ${name} withholds plan and publication instead of appearing absent`,()=>setup(async f=>{
  await persist(f);const file=files(f).find(file=>file.endsWith(name)),bytes=await fs.readFile(file);bytes[0]^=1;await fs.writeFile(file,bytes);const before=snapshot(f);
  await assert.rejects(readEvidencePublicationIntent(f.options,f.journal,f.grant,f.plan.publication_id));await assert.rejects(publishStoredEvidenceIntent(f.options,f.journal,f.grant,f.plan.publication_id));assert.deepEqual(snapshot(f),before);
}));
test("recomputed unkeyed cipher checksums do not forge intent GCM authentication",()=>setup(async f=>{
  await persist(f);const [object,ready]=files(f),bytes=await fs.readFile(object);bytes[0]^=1;await fs.writeFile(object,bytes);const value=JSON.parse(await fs.readFile(ready,"utf8"));value.sha256=sha(bytes);await fs.writeFile(ready,JSON.stringify(value));
  await assert.rejects(publishStoredEvidenceIntent(f.options,f.journal,f.grant,f.plan.publication_id));assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get().n,0);
}));
test("context, target, key and stage substitutions fail without changing SQL",()=>setup(async f=>{
  await persist(f);const before=snapshot(f);
  for(const [publication,journal,grant] of [[{...f.options,targetPin:"0".repeat(64)},f.journal,f.grant],[f.options,{...f.journal,contextPin:"0".repeat(64)},f.grant],[f.options,f.journal,{...f.grant,generation:randomUUID()}],[{...f.options,stage:{...f.stage,contextPin:"0".repeat(64)}},f.journal,f.grant]])await assert.rejects(readEvidencePublicationIntent(publication,journal,grant,f.plan.publication_id));
  const other=path.join(f.root,"wrong-key.bin");await fs.writeFile(other,Buffer.alloc(32,1));await assert.rejects(readEvidencePublicationIntent({...f.options,stage:{...f.stage,keyFile:other}},f.journal,f.grant,f.plan.publication_id));assert.deepEqual(snapshot(f),before);
}));
test("intent UUID reuse with a changed operation plan cannot overwrite durable intent files",()=>setup(async f=>{
  await persist(f);const before=await Promise.all(files(f).map(file=>fs.readFile(file)));
  await assert.rejects(persistEvidencePublicationIntent(f.options,f.journal,f.grant,{...f.plan,operations:[{kind:"receipt"}]}),/immutable_identity_conflict/);assert.deepEqual(await Promise.all(files(f).map(file=>fs.readFile(file))),before);
}));
test("invalid plans and corrupt staged receipts fail before creating pending intent files",()=>setup(async f=>{
  for(const plan of [{...f.plan,publication_id:"bad"},{...f.plan,operations:[{kind:"receipt"},{kind:"sql",sql:"UPDATE tenx_usage SET used=0",bindings:[]}]},{...f.plan,ticket:{...f.plan.ticket,context_pin:"0".repeat(64)}}])await assert.rejects(persistEvidencePublicationIntent(f.options,f.journal,f.grant,plan));
  const expansion="\u0000".repeat(1500000);await assert.rejects(persistEvidencePublicationIntent(f.options,f.journal,f.grant,{...f.plan,operations:[{kind:"receipt"},{kind:"sql",sql:"UPDATE tenx_candidates SET pool=?,checked_at=?",bindings:[expansion,expansion]}]}),/intent_plan_byte_bound/);
  await fs.writeFile(path.join(f.stage.directory,"pending",f.plan.ticket.stage_id,"object.bin"),"corrupt");await assert.rejects(persist(f));assert.deepEqual(await fs.readdir(path.join(f.journal.directory,"pending")),[]);
}));
for(const [mode,code] of [["partial_cipher",73],["before_ready",74]])test(`process stop at ${mode} retains a partial intent that cannot publish or be overwritten`,()=>setup(async f=>{
  await child(f,mode,code);const object=files(f)[0],before=await fs.readFile(object);await assert.rejects(persist(f));await assert.rejects(publishStoredEvidenceIntent(f.options,f.journal,f.grant,f.plan.publication_id));assert.deepEqual(await fs.readFile(object),before);assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get().n,0);
}));
test("cipher reads stay bounded when a file grows after its size check",()=>setup(async f=>{
  await persist(f);const open=fs.open;let changed=false;
  const hook=mock.method(fs,"open",async(...args)=>{const handle=await open(...args);if(String(args[0]).endsWith("intent.bin")&&!changed){changed=true;await fs.appendFile(args[0],"growth");}return handle;});
  try{await assert.rejects(readEvidencePublicationIntent(f.options,f.journal,f.grant,f.plan.publication_id),/size_changed/);}finally{hook.mock.restore();}
}));
test("ownership changed during decryption is checked again before releasing a plan",()=>setup(async f=>{
  await persist(f);const open=fs.open;let changed=false;
  const hook=mock.method(fs,"open",async(...args)=>{const handle=await open(...args);if(String(args[0]).endsWith("intent.bin")&&!changed){const close=handle.close.bind(handle);handle.close=async()=>{await close();if(!changed){changed=true;await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());}};}return handle;});
  try{await assert.rejects(readEvidencePublicationIntent(f.options,f.journal,f.grant,f.plan.publication_id),/owner_fenced/);}finally{hook.mock.restore();}
  assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get().n,0);
}));
test("existing/nested journal roots, live paths and co-located key material hold",()=>setup(async f=>{
  await assert.rejects(createEvidenceIntentJournal({target:f.journal.directory,publication:f.options,grant:f.grant}));
  await assert.rejects(createEvidenceIntentJournal({target:path.join(f.root,"nested"),publication:f.options,grant:f.grant}),/standalone/);
  await assert.rejects(createEvidenceIntentJournal({target:path.join("discovery",".wrangler","intents"),publication:f.options,grant:f.grant}));
  const copied=path.join(f.journal.directory,"key.bin");await fs.copyFile(f.stage.keyFile,copied);await assert.rejects(readEvidencePublicationIntent({...f.options,stage:{...f.stage,keyFile:copied}},f.journal,f.grant,f.plan.publication_id),/separate_key/);
}));
test("a post-commit callback failure remains committed and can be retried through read-only reconciliation",()=>setup(async f=>{
  await persist(f);const result=await publishStoredEvidenceIntent(f.options,f.journal,f.grant,f.plan.publication_id,()=>{throw Error("synthetic_cohort_failure");});assert.equal(result.state,"committed");assert.equal(result.post_commit,"failed");const before=snapshot(f);
  const next=await reconcileStoredEvidenceIntent(f.options,f.journal,f.grant,f.plan.publication_id,async()=>{});assert.equal(next.post_commit,"completed");assert.equal(next.reconciled,true);assert.deepEqual(snapshot(f),before);
}));
test("mutating the caller grant during IO cannot silently adopt a replacement owner's authority",()=>setup(async f=>{
  await persist(f);const grant={...f.grant},open=fs.open;let changed=false;
  const hook=mock.method(fs,"open",async(...args)=>{const handle=await open(...args);if(String(args[0]).endsWith("intent.bin")&&!changed){const close=handle.close.bind(handle);handle.close=async()=>{await close();if(!changed){changed=true;Object.assign(grant,(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant);}};}return handle;});
  try{await assert.rejects(readEvidencePublicationIntent(f.options,f.journal,grant,f.plan.publication_id),/owner_fenced/);}finally{hook.mock.restore();}
}));
