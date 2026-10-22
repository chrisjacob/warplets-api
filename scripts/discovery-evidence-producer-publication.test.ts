import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,receipt,sha,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal,readEvidencePublicationIntent} from "./discovery-evidence-intents.mjs";
import {transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {d1EvidenceWriteStore} from "../discovery/src/evidence-write-store";
import {publishEvidenceProducerBatch,recoverEvidenceProducerBatch,type ProducerPublicationOutcome} from "./lib/evidence-producer-publication";
import type {ProducerBatchInput,ProducerStatement} from "./lib/evidence-producer-plan";

const exec=promisify(execFile);
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};batch:ProducerBatchInput;item:ReturnType<typeof receipt>};
function receiptStatement(item:ReturnType<typeof receipt>):ProducerStatement{
  let captured:ProducerStatement|undefined;
  const db={prepare(sql:string){return {bind(...bindings:ProducerStatement["bindings"]){captured={sql,bindings};return {};}};}} as unknown as D1Database;
  const writer=d1EvidenceWriteStore(db),row=item.row;
  if("slot" in row)writer.holder({...row,slot:row.slot!});else writer.wallet(row);
  return captured!;
}
const tables=["tenx_candidates","tenx_append_publications","tenx_append_references","tenx_holder_evidence","tenx_wallet_evidence","tenx_usage","tenx_wallet_usage"];
const snapshot=(f:PublicationFixture)=>tables.map(table=>f.copy.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
function committed(outcome:ProducerPublicationOutcome){assert.equal(outcome.state,"committed",JSON.stringify(outcome));if(outcome.state!=="committed")throw Error("expected_commit");return outcome;}
function held(outcome:ProducerPublicationOutcome,phase:string){assert.equal(outcome.state,"held");if(outcome.state!=="held")throw Error("expected_hold");assert.equal(outcome.phase,phase);assert.equal("results" in outcome,false);return outcome;}
async function setup(work:(f:Setup)=>Promise<void>,kind="holder"){
  const directory=path.resolve(".tmp","producer-publication-test-"+randomUUID());
  try{await fixture(async f=>{
    const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant}),journal={directory,contextPin:created.context_pin},item=receipt(kind),batch={publicationId:randomUUID(),stageId:randomUUID(),statements:[
      {sql:"UPDATE tenx_candidates SET checked_at=checked_at||? WHERE address=?",bindings:["x","mint"]},receiptStatement(item),
      {sql:"DELETE FROM tenx_wallet_work WHERE address=?",bindings:["mint"]},
    ]};await work({...f,journal,item,batch});
  });}finally{try{const actual=await fs.realpath(directory),root=await fs.realpath(".tmp");assert.equal(path.dirname(actual),root);assert.ok(path.basename(actual).startsWith("producer-publication-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const submit=(f:Setup,callback?:()=>Promise<void>|void)=>publishEvidenceProducerBatch(f.options,f.journal,f.grant,f.batch,callback);
const recover=(f:Setup,mode:"publish"|"reconcile"="reconcile",callback?:()=>Promise<void>|void)=>recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.batch.publicationId,mode},callback);
async function child(f:Setup,mode:string,exit=0){
  const file=path.join(f.root,"producer-restart.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,id:f.batch.publicationId,...(["submit","ready_stop","commit_stop"].includes(mode)?{batch:f.batch}:{})}),{mode:0o600});
  try{const result=await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:100000,timeout:30000});assert.equal(exit,0);return JSON.parse(result.stdout) as ProducerPublicationOutcome;}
  catch(error){assert.equal((error as {code:unknown}).code,exit);return null;}
}

for(const kind of ["holder","wallet"])test(`${kind}: standalone submit syncs the encrypted intent before target SQL; original source is untouched`,()=>setup(async f=>{
  const sourceBefore=sha(await fs.readFile(path.join(f.root,"source.sqlite"))),ready=path.join(f.journal.directory,"pending",f.batch.publicationId,"ready.json"),open=fs.open;
  let synced=0;
  mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){
    const handle=await open(name,flags,...args);if(flags==="wx"&&String(name)===ready){const sync=handle.sync.bind(handle);handle.sync=async()=>{assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get()!.n,0);assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_references").get()!.n,0);assert.ok(String(f.copy.prepare("SELECT checked_at FROM tenx_candidates").get()!.checked_at).endsWith("Z"));await sync();synced++;};}return handle;
  });
  const result=committed(await submit(f));assert.equal(synced,1);assert.deepEqual(result.results.map(r=>r.meta.changes),[1,1,1]);assert.equal(result.post_commit,"not_requested");
  const intent=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.batch.publicationId);assert.equal(intent.plan.operations[1].kind,"receipt");assert.ok("ticket" in intent.plan && intent.plan.ticket);assert.equal(intent.plan.ticket.stage_id,f.batch.stageId);
  assert.equal(sha(await fs.readFile(path.join(f.root,"source.sqlite"))),sourceBefore);
  const before=snapshot(f),encrypted=await fs.readFile(path.join(f.journal.directory,"pending",f.batch.publicationId,"intent.bin"));assert.equal(encrypted.includes(Buffer.from(f.item.row.payload)),false);
  const retry=committed(await submit(f));assert.equal(retry.reconciled,true);assert.deepEqual(retry.results,result.results);assert.deepEqual(snapshot(f),before);
  assert.deepEqual(await fs.readFile(path.join(f.journal.directory,"pending",f.batch.publicationId,"intent.bin")),encrypted);
},kind));

test("a journal readiness sync failure holds before SQL and suppresses callbacks",()=>setup(async f=>{
  const before=snapshot(f),open=fs.open;let callbacks=0;
  mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(flags==="wx"&&String(name).startsWith(f.journal.directory)&&String(name).endsWith("ready.json"))handle.sync=async()=>{throw Error("private filesystem diagnostic");};return handle;});
  const result=held(await submit(f,()=>{callbacks++;}),"persist");assert.equal(result.sql_attempt,"not_started");assert.equal(result.code,"producer_intent_held");assert.equal(JSON.stringify(result).includes("private filesystem"),false);assert.equal(callbacks,0);assert.deepEqual(snapshot(f),before);
}));

test("late target SQL failure returns no successful result vector, retains intent and spent allowances, and never runs the callback",()=>setup(async f=>{
  (f.batch.statements as ProducerStatement[]).push({sql:"INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) VALUES('x','x','x',NULL,'x')",bindings:[]});const before=snapshot(f);let calls=0;
  const result=held(await submit(f,()=>{calls++;}),"publish");assert.equal(result.sql_attempt,"unconfirmed");assert.deepEqual(snapshot(f),before);assert.equal(calls,0);
  assert.equal((await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.batch.publicationId)).plan.operations.length,4);
  held(await recover(f),"reconcile");held(await recover(f,"publish"),"publish");assert.deepEqual(snapshot(f),before);
}));

test("lost commit acknowledgement stays unconfirmed until read-only recovery; SQL and callbacks are not replayed automatically",()=>setup(async f=>{
  const original=DatabaseSync.prototype.exec;let injected=false,calls=0;
  const patch=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){
    let committedHere=false;if(sql==="COMMIT"&&!injected){try{committedHere=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(f.batch.publicationId);}catch{}}
    const result=original.call(this,sql);if(committedHere){injected=true;throw Error("synthetic lost acknowledgement");}return result;
  });
  held(await submit(f,()=>{calls++;}),"publish");assert.equal(injected,true);assert.equal(calls,0);patch.mock.restore();
  const before=snapshot(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite")),result=committed(await recover(f));assert.equal(result.reconciled,true);assert.deepEqual(result.results.map(r=>r.meta.changes),[1,1,1]);assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);assert.equal(calls,0);
}));

test("post-commit failure remains a committed SQL result; explicit recovery retries caller work without SQL mutation",()=>setup(async f=>{
  const first=committed(await submit(f,()=>{throw Error("private cohort diagnostic");}));assert.equal(first.post_commit,"failed");assert.equal(first.post_commit_error,"publication_post_commit_work_failed");assert.equal(JSON.stringify(first).includes("private cohort"),false);
  const before=snapshot(f);let count=0;const retry=committed(await recover(f,"reconcile",()=>{count++;}));assert.equal(retry.reconciled,true);assert.equal(retry.post_commit,"completed");assert.equal(count,1);assert.deepEqual(snapshot(f),before);
}));

test("invalid or substituted SQL/receipt/identity plans hold before an intent or SQL publication",()=>setup(async f=>{
  const before=snapshot(f),base=f.batch.statements as ProducerStatement[];
  for(const statements of [[base[0]], [...base,base[1]], [{sql:"DELETE FROM tenx_append_control",bindings:[]},base[1]], [{sql:"UPDATE tenx_candidates SET checked_at='x'; DELETE FROM tenx_candidates",bindings:[]},base[1]], [{...base[1],bindings:[]}], Array.from({length:129},()=>base[1])]){
    held(await publishEvidenceProducerBatch(f.options,f.journal,f.grant,{...f.batch,statements}),"stage");
  }
  held(await publishEvidenceProducerBatch(f.options,f.journal,f.grant,{...f.batch,publicationId:"invalid"}),"preflight");
  assert.deepEqual(await fs.readdir(path.join(f.journal.directory,"pending")),[]);assert.deepEqual(await fs.readdir(path.join(f.stage.directory,"pending")),[]);assert.deepEqual(snapshot(f),before);
}));

test("changed same-ID batches remain held and cannot overwrite the original intent or mutate an existing commit",()=>setup(async f=>{
  committed(await submit(f));const before=snapshot(f),file=path.join(f.journal.directory,"pending",f.batch.publicationId,"intent.bin"),bytes=await fs.readFile(file);
  (f.batch.statements as ProducerStatement[])[0]!.bindings[0]="changed";
  held(await submit(f),"persist");assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(file),bytes);
}));

test("pending old-owner batches cannot publish or appear committed under a replacement or reused owner",()=>setup(async f=>{
  await child(f,"ready_stop",75);const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=snapshot(f);
  held(await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.batch.publicationId,mode:"publish"}),"publish");
  held(await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.batch.publicationId,mode:"reconcile"}),"reconcile");
  const returned=(await transferEvidencePublicationOwner(f.options,next,f.grant.owner)).grant;
  held(await recoverEvidenceProducerBatch(f.options,f.journal,returned,{publicationId:f.batch.publicationId,mode:"publish"}),"publish");assert.deepEqual(snapshot(f),before);
}));

test("current owner can reconcile a committed former-owner batch read-only",()=>setup(async f=>{
  committed(await submit(f));const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));
  assert.equal(committed(await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.batch.publicationId,mode:"reconcile"})).reconciled,true);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("caller SQL, IDs, options and grant are snapshotted before asynchronous preparation",()=>setup(async f=>{
  const options=structuredClone(f.options),grant={...f.grant},journal={...f.journal},batch=structuredClone(f.batch),pending=publishEvidenceProducerBatch(options,journal,grant,batch);
  options.directory=".tmp/substitution";options.stage.contextPin="0".repeat(64);grant.epoch++;journal.contextPin="0".repeat(64);batch.publicationId=randomUUID();batch.stageId=randomUUID();(batch.statements as ProducerStatement[])[0]!.bindings[0]="changed";
  assert.equal(committed(await pending).publication_id,f.batch.publicationId);assert.ok(String(f.copy.prepare("SELECT checked_at FROM tenx_candidates").get()!.checked_at).endsWith("Zx"));
}));

test("zero-row producer compare-and-swap stays committed with the original result position",()=>setup(async f=>{
  (f.batch.statements as ProducerStatement[])[0]!.bindings[1]="missing";assert.deepEqual(committed(await submit(f)).results.map(r=>r.meta.changes),[0,1,1]);
}));

test("fresh process stops after integrated intent readiness; recovery publishes by retained ID without original statements",()=>setup(async f=>{
  const before=snapshot(f);await child(f,"ready_stop",75);assert.deepEqual(snapshot(f),before);
  const result=committed((await child(f,"publish"))!);assert.equal(result.reconciled,false);const committedState=snapshot(f);assert.equal(committed((await child(f,"reconcile"))!).reconciled,true);assert.deepEqual(snapshot(f),committedState);
}));

test("fresh process stops after integrated SQL commit; another reconciles without producer arguments or a second mutation",()=>setup(async f=>{
  await child(f,"commit_stop",76);const before=snapshot(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal(committed((await child(f,"reconcile"))!).reconciled,true);assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));
