import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,sha,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {fixtureCandidates,syntheticBundle} from "../discovery/src/fixtures";
import {saveCandidate} from "../discovery/src/store";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {saveCandidateOnEvidenceTarget,type CandidateTargetInput} from "./lib/evidence-candidate-target";
import {publishEvidenceCandidateMetadataBatch,recoverEvidenceProducerBatch,type ProducerPublicationOutcome} from "./lib/evidence-producer-publication";
import {createEvidenceIntentJournal,readEvidencePublicationIntent,persistEvidencePublicationIntent} from "./discovery-evidence-intents.mjs";
import {validateEvidenceCandidateMetadataPlan,validateEvidencePublicationPlan,publishEvidenceCandidateMetadata,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {stageEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {holderHistoryFixture} from "../discovery/src/holder-history-fixtures.test-helper";
import {analyzeHolders,type HolderEvidence} from "../discovery/src/holders";
import {CandidateSchema} from "../discovery/src/model";
import type {ProducerStatement} from "./lib/evidence-producer-plan";

const exec=promisify(execFile),at="2026-10-21T09:05:00.000Z";
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:CandidateTargetInput;batch:{publicationId:string;statements:ProducerStatement[]}};
async function setup(work:(f:Setup)=>Promise<void>,seed?:(db:DatabaseSync,input:CandidateTargetInput)=>Promise<void>){
  const candidate={...(await fixtureCandidates(new Date(at)))[0]!,mode:"live" as const},bundle=await syntheticBundle(new Date(at)),input:CandidateTargetInput={publicationId:randomUUID(),candidate,transactions:[bundle.creation,bundle.graduation],state:bundle.accounts},directory=path.resolve(".tmp","candidate-metadata-test-"+randomUUID());
  try{await fixture(async f=>{
    const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant}),batch={publicationId:input.publicationId,statements:[{sql:"INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?1,?2,?3,?4,?5)",bindings:[candidate.address,candidate.pool,JSON.stringify(candidate),candidate.checked_at,"live"]}]};await work({...f,input,batch,journal:{directory,contextPin:created.context_pin}});
  },async({db})=>{db.exec("DELETE FROM tenx_candidates; DELETE FROM tenx_wallet_work");await seed?.(db,input);});
  }finally{try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("candidate-metadata-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const snapshot=(f:Setup)=>["tenx_candidates","tenx_append_publications","tenx_append_references","tenx_append_base","tenx_holder_evidence","tenx_wallet_evidence","tenx_cohorts","tenx_wallet_cohorts","tenx_usage","tenx_wallet_usage"].map(t=>rows(f.copy,t));
const submit=(f:Setup,callback?:()=>Promise<void>|void)=>publishEvidenceCandidateMetadataBatch(f.options,f.journal,f.grant,f.batch,callback);
const recover=(f:Setup,mode:"publish"|"reconcile"="reconcile")=>recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.batch.publicationId,mode});
function committed(value:ProducerPublicationOutcome){assert.equal(value.state,"committed",JSON.stringify(value));if(value.state!=="committed")throw Error("commit_expected");return value;}
async function original(f:Setup){await saveCandidate(sqliteD1(f.db),f.input.candidate,f.input.transactions,f.input.state);}
function expected(f:Setup){return f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(row=>String(row.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});}
function compare(f:Setup,values:ReturnType<typeof expected>){for(const value of values)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));}
async function child(f:Setup,mode:string,exit=0){
  const file=path.join(f.root,"metadata-restart.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,id:f.batch.publicationId,plan_kind:"candidate_metadata",...(["submit","ready_stop","commit_stop"].includes(mode)?{batch:f.batch}:{})}),{mode:0o600});
  try{const result=await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:100000,timeout:30000});assert.equal(exit,0);return JSON.parse(result.stdout) as ProducerPublicationOutcome;}catch(error){assert.equal((error as {code:unknown}).code,exit);return null;}
}

test("receipt-free original candidate workflow matches all 87 metadata tables and cohorts without oracle access or new receipt artifacts",context=>setup(async f=>{
  await original(f);const values=expected(f),sourceBefore=sha(await fs.readFile(path.join(f.root,"source.sqlite"))),authority=[rows(f.copy,"tenx_append_base"),rows(f.copy,"tenx_append_references")];
  mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});
  const result=committed(await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input));assert.equal(result.post_commit,"completed");compare(f,values);assert.equal(sha(await fs.readFile(path.join(f.root,"source.sqlite"))),sourceBefore);assert.deepEqual([rows(f.copy,"tenx_append_base"),rows(f.copy,"tenx_append_references")],authority);assert.deepEqual(await fs.readdir(path.join(f.stage.directory,"pending")),[]);
  const intent=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.input.publicationId);assert.equal("kind" in intent.plan&&intent.plan.kind,"candidate_metadata");assert.equal("ticket" in intent.plan,false);assert.ok(intent.plan.operations.every(op=>op.kind==="sql"));
  const before=snapshot(f),retry=committed(await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input));assert.equal(retry.reconciled,true);assert.deepEqual(snapshot(f),before);
  context.diagnostic(JSON.stringify({workflow:"receipt_free_candidate",original_tables:values.length,operations:result.results.length,changes:result.results.map(r=>r.meta.changes),new_receipts:0,oracle_access:false,prerequisite_copy:false,provider_requests:0,runtime_activated:false}));
}));

test("receipt-free refresh preserves retained holder evidence and newer field merge without fabricating an append",()=>setup(async f=>{
  await original(f);const values=expected(f),before=[rows(f.copy,"tenx_holder_evidence"),rows(f.copy,"tenx_append_base")];committed(await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input));compare(f,values);assert.deepEqual([rows(f.copy,"tenx_holder_evidence"),rows(f.copy,"tenx_append_base")],before);assert.deepEqual(rows(f.copy,"tenx_append_references"),[]);
  const current=CandidateSchema.parse(JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_candidates").get()!.payload)));assert.ok(current.holders);assert.equal(current.risk.observed_at,"2026-10-21T09:10:00.000Z");
},async(db,input)=>{
  const history=await holderHistoryFixture(),holder=history.samples[0]!.evidence as HolderEvidence,candidate={...input.candidate,holders:await analyzeHolders(holder,history.index[0]!.observed_at),risk:{...input.candidate.risk,observed_at:"2026-10-21T09:10:00.000Z"}};await saveCandidate(sqliteD1(db),candidate,[],undefined,holder);
}));

test("metadata intent is synced before any SQL, confidential, immutable and never needs a stage UUID",()=>setup(async f=>{
  const open=fs.open;let synced=0;
  mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(flags==="wx"&&String(name).startsWith(f.journal.directory)&&String(name).endsWith("ready.json")){const sync=handle.sync.bind(handle);handle.sync=async()=>{assert.equal(rows(f.copy,"tenx_candidates").length,0);assert.equal(rows(f.copy,"tenx_append_publications").length,0);await sync();synced++;};}return handle;});
  committed(await submit(f));assert.equal(synced,1);const file=path.join(f.journal.directory,"pending",f.batch.publicationId,"intent.bin"),bytes=await fs.readFile(file);assert.equal(bytes.includes(Buffer.from(f.input.candidate.address)),false);assert.equal(bytes.includes(Buffer.from("tenx_candidates")),false);const before=snapshot(f);assert.equal(committed(await submit(f)).reconciled,true);assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(file),bytes);
}));

test("metadata readiness failure holds before SQL and never calls post-commit work",()=>setup(async f=>{
  const before=snapshot(f),open=fs.open;let calls=0;mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(flags==="wx"&&String(name).startsWith(f.journal.directory)&&String(name).endsWith("ready.json"))handle.sync=async()=>{throw Error("private sync detail");};return handle;});
  const result=await submit(f,()=>{calls++;});assert.equal(result.state,"held");if(result.state==="held"){assert.equal(result.phase,"persist");assert.equal(result.sql_attempt,"not_started");}assert.equal(calls,0);assert.deepEqual(snapshot(f),before);
}));

test("metadata SQL rollback retains the intent and spent allowances without a success vector or callback",()=>setup(async f=>{
  f.batch.statements.push({sql:"INSERT INTO tenx_proofs(address,kind,signature,instruction_index,slot,payload_hash,payload) VALUES('x','creation','x','x',1,'x',NULL)",bindings:[]});const before=snapshot(f);let calls=0;const result=await submit(f,()=>{calls++;});assert.equal(result.state,"held");assert.equal("results" in result,false);assert.equal(calls,0);assert.deepEqual(snapshot(f),before);assert.equal((await recover(f)).state,"held");assert.equal((await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.batch.publicationId)).plan.operations.length,2);
}));

test("lost metadata commit acknowledgement stays unconfirmed until native read-only reconciliation",()=>setup(async f=>{
  const original=DatabaseSync.prototype.exec;let injected=false,calls=0;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!injected){try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(f.batch.publicationId);}catch{}}const result=original.call(this,sql);if(stop){injected=true;throw Error("ack_lost");}return result;});
  assert.equal((await submit(f,()=>{calls++;})).state,"held");assert.equal(injected,true);assert.equal(calls,0);hook.mock.restore();const before=snapshot(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal(committed(await recover(f)).reconciled,true);assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("actual receipt-free cohort failure preserves committed producer SQL and retries the original workflow separately",()=>setup(async f=>{
  await original(f);const values=expected(f),originalPrepare=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql.startsWith("INSERT OR IGNORE INTO tenx_cohorts"))throw Error("cohort_failed");return originalPrepare.call(this,sql);});
  const first=committed(await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input));assert.equal(first.post_commit,"failed");assert.deepEqual(rows(f.copy,"tenx_cohorts"),[]);hook.mock.restore();const candidate=rows(f.copy,"tenx_candidates"),retry=committed(await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input));assert.equal(retry.reconciled,true);assert.equal(retry.post_commit,"completed");assert.deepEqual(rows(f.copy,"tenx_candidates"),candidate);compare(f,values);
}));

test("receipt-free plans cannot bypass the original receipt gate, enter receipt tables, mutate quotas or cross plan identities",()=>setup(async f=>{
  const first=f.batch.statements[0]!,plan={publication_id:f.batch.publicationId,kind:"candidate_metadata",operations:[{kind:"sql",...first}]};
  assert.throws(()=>validateEvidencePublicationPlan(plan));assert.throws(()=>validateEvidenceCandidateMetadataPlan({...plan,ticket:{}}));
  for(const sql of ["DELETE FROM tenx_usage","UPDATE tenx_append_control SET epoch=1","INSERT INTO tenx_holder_evidence VALUES('x')","INSERT INTO tenx_wallet_evidence VALUES('x')","DELETE FROM tenx_proofs","UPDATE tenx_candidates SET payload='{}'",first.sql+"; COMMIT"]){assert.throws(()=>validateEvidenceCandidateMetadataPlan({...plan,operations:[...plan.operations,{kind:"sql",sql,bindings:[]}]}));}
  assert.throws(()=>validateEvidenceCandidateMetadataPlan({...plan,operations:[{kind:"receipt"}]}));assert.throws(()=>validateEvidenceCandidateMetadataPlan({...plan,operations:[{kind:"sql",...first,bindings:[...first.bindings.slice(0,4),"fixture"]}]}));
  committed(await submit(f));const before=snapshot(f);f.batch.statements[0]!.bindings[2]=JSON.stringify({...f.input.candidate,symbol:"changed"});assert.equal((await submit(f)).state,"held");assert.deepEqual(snapshot(f),before);
  const staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),table:"tenx_holder_evidence",row:f.baseHolder.row});await assert.rejects(persistEvidencePublicationIntent(f.options,f.journal,f.grant,{publication_id:f.batch.publicationId,ticket:staged.ticket,operations:[{kind:"receipt"}]}),/identity_conflict/);
}));

test("pending metadata plan cannot execute under replacement or reused owners; current owners only reconcile existing commits",()=>setup(async f=>{
  await child(f,"ready_stop",75);const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant;assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.batch.publicationId,mode:"publish"})).state,"held");assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.batch.publicationId,mode:"reconcile"})).state,"held");const returned=(await transferEvidencePublicationOwner(f.options,next,f.grant.owner)).grant;assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,returned,{publicationId:f.batch.publicationId,mode:"publish"})).state,"held");assert.deepEqual(rows(f.copy,"tenx_candidates"),[]);
}));

test("committed metadata plan reconciles under a replacement current owner with database bytes unchanged",()=>setup(async f=>{
  committed(await submit(f));const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal(committed(await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.batch.publicationId,mode:"reconcile"})).reconciled,true);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("fresh process stops after integrated metadata readiness; another publishes by known ID without original SQL",()=>setup(async f=>{
  const before=snapshot(f);await child(f,"ready_stop",75);assert.deepEqual(snapshot(f),before);assert.equal(committed((await child(f,"publish"))!).reconciled,false);const after=snapshot(f);assert.equal(committed((await child(f,"reconcile"))!).reconciled,true);assert.deepEqual(snapshot(f),after);assert.deepEqual(await fs.readdir(path.join(f.stage.directory,"pending")),[]);
}));

test("fresh process stops after integrated metadata commit; read-only recovery cannot apply the SQL a second time",()=>setup(async f=>{
  await child(f,"commit_stop",76);const before=snapshot(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal(committed((await child(f,"reconcile"))!).reconciled,true);assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("new metadata intents retain authenticated context and corruption holds without rewriting partial files",()=>setup(async f=>{
  await child(f,"ready_stop",75);const file=path.join(f.journal.directory,"pending",f.batch.publicationId,"intent.bin"),bytes=await fs.readFile(file);bytes[0]^=1;await fs.writeFile(file,bytes);const before=snapshot(f);assert.equal((await recover(f,"publish")).state,"held");assert.equal((await submit(f)).state,"held");assert.deepEqual(snapshot(f),before);assert.deepEqual(await fs.readFile(file),bytes);
}));

test("metadata API snapshots configuration, grant and original SQL before asynchronous journal IO",()=>setup(async f=>{
  const options=structuredClone(f.options),journal={...f.journal},grant={...f.grant},batch=structuredClone(f.batch),pending=publishEvidenceCandidateMetadataBatch(options,journal,grant,batch);options.targetPin="0".repeat(64);journal.contextPin="0".repeat(64);grant.epoch++;batch.publicationId=randomUUID();batch.statements[0]!.bindings[2]="{}";assert.equal(committed(await pending).publication_id,f.batch.publicationId);
}));

test("native metadata coordinator independently enforces fencing and valid candidate scope before SQL",()=>setup(async f=>{
  const plan={publication_id:f.batch.publicationId,kind:"candidate_metadata",operations:f.batch.statements.map(row=>({kind:"sql",...row}))},before=snapshot(f);
  await assert.rejects(publishEvidenceCandidateMetadata(f.options,{...f.grant,epoch:f.grant.epoch+1},plan),/owner_fenced/);await assert.rejects(publishEvidenceCandidateMetadata(f.options,f.grant,{...plan,operations:[{...plan.operations[0],bindings:["other",...f.batch.statements[0]!.bindings.slice(1)]}]}),/candidate_mismatch/);assert.deepEqual(snapshot(f),before);
}));
