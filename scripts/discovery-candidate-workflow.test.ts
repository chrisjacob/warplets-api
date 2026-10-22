import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal,readEvidencePublicationIntent,readEvidencePublicationIntentIfPresent} from "./discovery-evidence-intents.mjs";
import {previewEvidenceCandidateForCohort,validateEvidenceTargetPlan,validateEvidenceCohortPlan,transferEvidencePublicationOwner,publishEvidenceCandidateMetadata} from "./discovery-evidence-publication.mjs";
import {publishLinkedCandidateBatch,recoverLinkedCandidateBatch} from "./lib/evidence-candidate-workflow";
import {saveCandidateOnEvidenceTarget,type CandidateTargetInput} from "./lib/evidence-candidate-target";
import {recoverEvidenceProducerBatch,recoverLinkedWalletSnapshotBatch} from "./lib/evidence-producer-publication";
import type {ProducerStatement} from "./lib/evidence-producer-plan";
import {saveCandidate} from "../discovery/src/store";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {holderHistoryFixture} from "../discovery/src/holder-history-fixtures.test-helper";
import {analyzeHolders,HolderEvidenceSchema} from "../discovery/src/holders";
const exec=promisify(execFile),at="2026-10-21T09:05:00.000Z";
type Setup=PublicationFixture&{input:CandidateTargetInput;journal:{directory:string;contextPin:string};batch:{publicationId:string;cohortId:string;stageId?:string;statements:ProducerStatement[]}};
const rows=(db:DatabaseSync,t:string)=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
const state=(f:Setup)=>["tenx_candidates","tenx_cohorts","tenx_wallet_cohorts","tenx_selections","tenx_append_publications","tenx_append_references","tenx_usage","tenx_wallet_usage"].map(t=>rows(f.copy,t));
async function setup(work:(f:Setup)=>Promise<void>,receipt=false){
  const holder=receipt?HolderEvidenceSchema.parse((await holderHistoryFixture()).samples[0]!.evidence):undefined,candidate={...(await fixtureCandidates(new Date(at)))[0]!,mode:"live" as const,holders:holder?await analyzeHolders(holder,at):null},directory=path.resolve(".tmp","candidate-workflow-test-"+randomUUID()),input:CandidateTargetInput={candidate,publicationId:randomUUID(),cohortPublicationId:randomUUID(),...(holder?{stageId:randomUUID(),holderEvidence:holder}:{})},owned=new WeakMap<object,ProducerStatement>();let statements:ProducerStatement[]=[];
  function prepare(sql:string,bindings:ProducerStatement["bindings"]=[]){const s={bind:(...b:ProducerStatement["bindings"])=>prepare(sql,b),async first(){return null;}};owned.set(s,{sql,bindings});return s;}
  const recorder={prepare,async batch(batch:object[]){statements=batch.map(s=>owned.get(s)!);throw Error("batch_captured");}} as unknown as D1Database;
  await assert.rejects(saveCandidate(recorder,candidate,[],undefined,holder),/batch_captured/);
  try{await fixture(async f=>{const made=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,input,journal:{directory,contextPin:made.context_pin},batch:{publicationId:input.publicationId,cohortId:input.cohortPublicationId!,stageId:input.stageId,statements}});},async({db})=>{db.exec("DELETE FROM tenx_candidates;DELETE FROM tenx_wallet_work");});}
  finally{try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("candidate-workflow-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
}
const submit=(f:Setup)=>publishLinkedCandidateBatch(f.options,f.journal,f.grant,f.batch);
const recover=(f:Setup,mode:"publish"|"reconcile"="publish",grant=f.grant)=>recoverLinkedCandidateBatch(f.options,f.journal,grant,{cohortId:f.batch.cohortId,mode});
async function config(f:Setup){const file=path.join(f.root,"linked.json");await fs.writeFile(file,JSON.stringify({plan_kind:"linked_candidate",publication:f.options,journal:f.journal,grant:f.grant,batch:f.batch,id:f.batch.cohortId}),{flag:"wx",mode:0o600});return file;}
async function stop(f:Setup,mode:"cohort_ready_stop"|"ready_stop"|"commit_stop"){
  const file=await config(f);let code:unknown;try{await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{timeout:30000,maxBuffer:100000});}catch(error){code=(error as {code:unknown}).code;}assert.equal(code,mode==="cohort_ready_stop"?77:mode==="ready_stop"?75:76);return file;
}
function onReady(f:Setup,id:string,work:()=>void){const open=fs.open;return mock.method(fs,"open",async function(name:Parameters<typeof fs.open>[0],flags:Parameters<typeof fs.open>[1],...args:unknown[]){const handle=await (open as Function)(name,flags,...args);if(flags==="wx"&&String(name)===path.join(f.journal.directory,"pending",id,"ready.json")){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();work();};}return handle;});}

for(const receipt of [false,true])test(`linked original candidate save preserves all metadata and exact cohorts (receipt ${receipt})`,()=>setup(async f=>{
  await saveCandidate(sqliteD1(f.db),f.input.candidate,[],undefined,f.input.holderEvidence);const expected=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(r=>String(r.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});
  const result=await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input);assert.equal(result.state,"committed");assert.equal(result.cohort,"completed");for(const e of expected)assert.deepEqual(f.copy.prepare(`SELECT ${e.columns.join(",")} FROM ${e.name} ORDER BY rowid`).all(),e.rows,String(e.name));assert.equal(expected.length,87);
  const parent=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.batch.publicationId),child=validateEvidenceCohortPlan((await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.batch.cohortId)).plan);assert.equal("cohort_id" in parent.plan?parent.plan.cohort_id:null,f.batch.cohortId);assert.deepEqual(child.parent,parent.plan);assert.ok(child.candidate_hash);
},receipt));

test("preview rolls back the exact merge and every trigger without publishing metadata or receipts",()=>setup(async f=>{
  const newer=structuredClone(f.input.candidate);newer.risk.observed_at="2026-10-21T09:06:00.000Z";f.copy.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,?)").run(newer.address,newer.pool,JSON.stringify(newer),newer.checked_at,"live");
  const parent=validateEvidenceTargetPlan({kind:"candidate_metadata",publication_id:f.batch.publicationId,cohort_id:f.batch.cohortId,operations:f.batch.statements.map(r=>({kind:"sql",...r}))}),before=await fs.readFile(path.join(f.target,"metadata.sqlite")),preview=await previewEvidenceCandidateForCohort(f.options,f.grant,parent);assert.equal(JSON.parse(preview.payload).risk.observed_at,newer.risk.observed_at);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);assert.equal(rows(f.copy,"tenx_append_publications").length,0);
}));

test("a newer retained observation merges exactly like the original and determines the cohort timestamp",()=>setup(async f=>{
  const newer={...f.input.candidate,risk:{...f.input.candidate.risk,observed_at:"2026-10-21T09:06:00.000Z"}};
  for(const db of [f.db,f.copy])db.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,?)").run(newer.address,newer.pool,JSON.stringify(newer),newer.checked_at,"live");
  await saveCandidate(sqliteD1(f.db),f.input.candidate);assert.equal((await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input)).cohort,"completed");
  for(const table of ["tenx_candidates","tenx_cohorts","tenx_wallet_cohorts","tenx_selections"])assert.deepEqual(rows(f.copy,table),rows(f.db,table));assert.equal(rows(f.copy,"tenx_cohorts")[0]!.selected_at,newer.risk.observed_at);
}));

test("a new linked publication preserves existing first rows and retains zero-change results on retry",()=>setup(async f=>{
  assert.equal((await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input)).cohort,"completed");const first=rows(f.copy,"tenx_cohorts"),input={...f.input,publicationId:randomUUID(),cohortPublicationId:randomUUID()},second=await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,input);assert.equal(second.cohort,"completed");assert.deepEqual(rows(f.copy,"tenx_cohorts"),first);
  const request={cohortId:input.cohortPublicationId,mode:"publish" as const},before=await fs.readFile(path.join(f.target,"metadata.sqlite")),again=await recoverLinkedCandidateBatch(f.options,f.journal,f.grant,request);assert.equal(again.state,"completed");if(again.cohort?.state==="committed")assert.deepEqual(again.cohort.results.map(r=>r.meta.changes),[0]);else assert.fail("cohort not confirmed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

for(const mode of ["cohort_ready_stop","ready_stop","commit_stop"] as const)test(`fresh-process ${mode} recovers using only the retained cohort ID`,()=>setup(async f=>{
  const before=state(f),file=await stop(f,mode),child=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.batch.cohortId);assert.ok(validateEvidenceCohortPlan(child.plan).candidate_hash);if(mode!=="commit_stop")assert.deepEqual(state(f),before);else{assert.equal(rows(f.copy,"tenx_append_publications").length,1);assert.equal(rows(f.copy,"tenx_cohorts").length,0);}
  if(mode==="cohort_ready_stop")assert.equal(await readEvidencePublicationIntentIfPresent(f.options,f.journal,f.grant,f.batch.publicationId),null);
  const result=JSON.parse((await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,"linked_publish"],{timeout:30000,maxBuffer:100000})).stdout);assert.equal(result.state,"completed");assert.equal(result.producer.state,"committed");assert.equal(result.cohort.state,"committed");assert.equal(result.provider_requests,0);assert.equal(result.source_authorized,false);assert.equal(rows(f.copy,"tenx_append_publications").length,2);assert.equal(rows(f.copy,"tenx_cohorts").length,1);
  const saved=state(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recover(f,"reconcile")).state,"completed");assert.deepEqual(state(f),saved);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("commit acknowledgement loss retains parent success and resumes cohorts without duplicate writes",()=>setup(async f=>{
  const original=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!lost)stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(f.batch.publicationId);const result=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return result;});assert.equal((await submit(f)).state,"held");hook.mock.restore();assert.equal(lost,true);const read=await recover(f,"reconcile");assert.equal(read.state,"held");assert.equal(read.failure?.phase,"reconcile");if(read.failure?.state==="held")assert.equal(read.failure.sql_attempt,"read_only");assert.equal(read.producer?.state,"committed");assert.equal(rows(f.copy,"tenx_cohorts").length,0);const done=await recover(f);assert.equal(done.state,"completed");assert.equal(done.producer?.state,"committed");if(done.producer?.state==="committed")assert.equal(done.producer.reconciled,true);assert.equal(rows(f.copy,"tenx_append_publications").length,2);
}));

test("changed merge state after readiness rolls back the producer, receipt and all metadata atomically",()=>setup(async f=>{
  const changed={...f.input.candidate,risk:{...f.input.candidate.risk,observed_at:"2026-10-21T10:00:00.000Z"}},hook=onReady(f,f.batch.publicationId,()=>{f.copy.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,?)").run(changed.address,changed.pool,JSON.stringify(changed),changed.checked_at,"live");});assert.equal((await submit(f)).state,"held");hook.mock.restore();assert.equal(rows(f.copy,"tenx_append_publications").length,0);assert.equal(rows(f.copy,"tenx_append_references").length,0);assert.equal(rows(f.copy,"tenx_candidates")[0]!.payload,JSON.stringify(changed));const before=state(f);assert.equal((await recover(f)).state,"held");assert.deepEqual(state(f),before);
},true));

test("a competing first observation after readiness holds before producer SQL",()=>setup(async f=>{
  const hook=onReady(f,f.batch.publicationId,()=>{f.copy.prepare("INSERT INTO tenx_cohorts VALUES(?,?,?,?,?,?)").run("2026-10-21",f.input.candidate.address,at,0,"first","{}");});assert.equal((await submit(f)).state,"held");hook.mock.restore();assert.equal(rows(f.copy,"tenx_candidates").length,0);assert.equal(rows(f.copy,"tenx_append_publications").length,0);assert.equal(rows(f.copy,"tenx_cohorts")[0]!.input_hash,"first");
}));

for(const broken of ["missing","corrupt"] as const)test(`a ${broken} companion cannot authorize a pending parent publication`,()=>setup(async f=>{
  await stop(f,"ready_stop");const file=path.join(f.journal.directory,"pending",f.batch.cohortId,"ready.json");if(broken==="missing")await fs.rename(file,file+".retained");else await fs.writeFile(file,"{}");const before=state(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.batch.publicationId,mode:"publish"})).state,"held");assert.deepEqual(state(f),before);
}));

test("partial child readiness prevents parent readiness and is never resealed",()=>setup(async f=>{
  const folder=path.join(f.journal.directory,"pending",f.batch.cohortId);await fs.mkdir(folder);await fs.writeFile(path.join(folder,"intent.bin"),"retained-partial");const before=state(f);assert.equal((await submit(f)).state,"held");assert.equal(await fs.readFile(path.join(folder,"intent.bin"),"utf8"),"retained-partial");assert.equal(await readEvidencePublicationIntentIfPresent(f.options,f.journal,f.grant,f.batch.publicationId),null);assert.deepEqual(state(f),before);
}));

test("partial parent readiness cannot be reconstructed from a valid child",()=>setup(async f=>{
  await stop(f,"cohort_ready_stop");const folder=path.join(f.journal.directory,"pending",f.batch.publicationId);await fs.mkdir(folder);await fs.writeFile(path.join(folder,"intent.bin"),"retained-partial");const before=state(f);assert.equal((await recover(f)).state,"held");assert.equal(await fs.readFile(path.join(folder,"intent.bin"),"utf8"),"retained-partial");assert.deepEqual(state(f),before);
}));

test("a transferred owner cannot materialize or execute former-owner pending work",()=>setup(async f=>{
  await stop(f,"cohort_ready_stop");const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=state(f);assert.equal((await recover(f,"publish",next)).state,"held");assert.equal((await recover(f,"reconcile",next)).state,"held");assert.equal(await readEvidencePublicationIntentIfPresent(f.options,f.journal,next,f.batch.publicationId),null);assert.deepEqual(state(f),before);
}));

test("current owner can reconcile both committed original results after transfer without writes",()=>setup(async f=>{
  assert.equal((await submit(f)).state,"committed");assert.equal((await recover(f)).state,"completed");const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recover(f,"reconcile",next)).state,"completed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

test("later candidate changes cannot refresh the original committed cohort during recovery",()=>setup(async f=>{
  assert.equal((await submit(f)).state,"committed");f.copy.prepare("UPDATE tenx_candidates SET checked_at=?,payload=json_set(payload,'$.checked_at',?) WHERE address=?").run("2026-10-21T10:00:00.000Z","2026-10-21T10:00:00.000Z",f.input.candidate.address);assert.equal((await recover(f)).state,"completed");assert.equal(rows(f.copy,"tenx_cohorts")[0]!.selected_at,at);assert.equal(rows(f.copy,"tenx_candidates")[0]!.checked_at,"2026-10-21T10:00:00.000Z");
}));

test("duplicate workflow identities hold before staging or publishing any intent",()=>setup(async f=>{
  assert.equal((await publishLinkedCandidateBatch(f.options,f.journal,f.grant,{...f.batch,cohortId:f.batch.publicationId})).state,"held");assert.deepEqual(await fs.readdir(path.join(f.journal.directory,"pending")),[]);assert.equal(rows(f.copy,"tenx_append_publications").length,0);
},true));

test("native publication cannot bypass the linked cohort requirement",()=>setup(async f=>{
  await stop(f,"ready_stop");const parent=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.batch.publicationId),before=state(f);await assert.rejects(publishEvidenceCandidateMetadata(f.options,f.grant,parent.plan));assert.deepEqual(state(f),before);
}));

test("pending identity conflict cannot replace saved assessment or parent bytes",()=>setup(async f=>{
  await stop(f,"ready_stop");const before=await fs.readFile(path.join(f.journal.directory,"pending",f.batch.cohortId,"intent.bin")),statements=structuredClone(f.batch.statements);statements[0]!.bindings[1]="changed-pool";assert.equal((await publishLinkedCandidateBatch(f.options,f.journal,f.grant,{...f.batch,statements})).state,"held");assert.deepEqual(await fs.readFile(path.join(f.journal.directory,"pending",f.batch.cohortId,"intent.bin")),before);assert.equal(rows(f.copy,"tenx_append_publications").length,0);
}));

test("snapshot-only recovery rejects a candidate cohort without publishing it",()=>setup(async f=>{
  assert.equal((await submit(f)).state,"committed");const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverLinkedWalletSnapshotBatch(f.options,f.journal,f.grant,{cohortId:f.batch.cohortId,mode:"publish"})).state,"held");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));
