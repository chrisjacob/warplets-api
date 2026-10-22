import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal,readEvidencePublicationIntent,persistEvidencePublicationIntent} from "./discovery-evidence-intents.mjs";
import {readEvidenceCohortHeads,validateEvidenceCohortPlan,validateEvidencePublicationPlan,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {publishEvidenceCohortBatch,type CohortBatchInput} from "./lib/evidence-cohort-publication";
import {saveCandidateOnEvidenceTarget,type CandidateTargetInput} from "./lib/evidence-candidate-target";
import {publishEvidenceCandidateMetadataBatch,recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";
import {cohortSql,walletCohortSql,cohortKeys} from "./evidence-cohort-plan.mjs";
import {captureCohort,saveCandidate} from "../discovery/src/store";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {walletInput} from "../discovery/src/wallet-fixtures.test-helper";
import {analyzeWalletEvidence,WalletEvidenceSchema} from "../discovery/src/wallet-analysis";
import {holderHistoryFixture} from "../discovery/src/holder-history-fixtures.test-helper";
import {analyzeHolders,HolderEvidenceSchema} from "../discovery/src/holders";
import {CandidateSchema,type Candidate} from "../discovery/src/model";
import {ProducerStatements,type ProducerStatement} from "./lib/evidence-producer-plan";
import {hashJson} from "../discovery/src/solana";

const exec=promisify(execFile),at="2026-10-21T09:05:00.000Z";
type Setup=PublicationFixture&{input:CandidateTargetInput;journal:{directory:string;contextPin:string}};
async function setup(work:(f:Setup)=>Promise<void>,receipt=false){
  const holder=HolderEvidenceSchema.parse((await holderHistoryFixture()).samples[0]!.evidence),candidate:Candidate={...(await fixtureCandidates(new Date(at)))[0]!,mode:"live",holders:receipt?await analyzeHolders(holder,at):null,wallet_analysis:await analyzeWalletEvidence(WalletEvidenceSchema.parse({...await walletInput(),observed_at:at}))},directory=path.resolve(".tmp","cohort-publication-test-"+randomUUID());
  const input:CandidateTargetInput={candidate,publicationId:randomUUID(),cohortPublicationId:randomUUID(),...(receipt?{stageId:randomUUID(),holderEvidence:holder}:{})};
  try{await fixture(async f=>{const made=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,input,journal:{directory,contextPin:made.context_pin}});},async({db})=>{db.exec("DELETE FROM tenx_candidates;DELETE FROM tenx_wallet_work");});}
  finally{try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("cohort-publication-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
}
const run=(f:Setup)=>saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input);
const rows=(db:DatabaseSync,t:string)=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
const state=(f:Setup)=>["tenx_candidates","tenx_cohorts","tenx_wallet_cohorts","tenx_selections","tenx_append_publications","tenx_append_references","tenx_usage","tenx_wallet_usage"].map(t=>rows(f.copy,t));
async function capture(candidate:Candidate,at:string){const statements:ProducerStatement[]=[],db={prepare(sql:string){return {bind(...bindings:ProducerStatement["bindings"]){statements.push({sql,bindings});return {};}};},async batch(){return [];}} as unknown as D1Database;await captureCohort(db,candidate,at);return statements;}
async function parent(f:Setup){const result=await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,{...f.input,cohortPublicationId:undefined});assert.equal(result.state,"committed");return result;}
async function batch(f:Setup):Promise<CohortBatchInput>{const current=CandidateSchema.parse(JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_candidates WHERE address=?").get(f.input.candidate.address)!.payload)));return {publicationId:f.input.cohortPublicationId!,parentId:f.input.publicationId,statements:await capture(current,current.checked_at)};}
async function planFor(f:Setup,b:CohortBatchInput){const saved=await readEvidencePublicationIntent(f.options,f.journal,f.grant,b.parentId),ops=ProducerStatements.parse(b.statements);let p=validateEvidenceCohortPlan({kind:"candidate_cohorts",publication_id:b.publicationId,parent:saved.plan,heads:ops.map(()=>null),operations:ops.map(r=>({kind:"sql",...r}))});return validateEvidenceCohortPlan({...p,heads:(await readEvidenceCohortHeads(f.options,f.grant,{keys:cohortKeys(p)})).heads});}

for(const receipt of [false,true])test(`original candidate save has durable cohorts and exact retained metadata (receipt ${receipt})`,t=>setup(async f=>{
  await saveCandidate(sqliteD1(f.db),f.input.candidate,[],undefined,f.input.holderEvidence);
  const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(r=>String(r.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});
  const actual=await run(f);assert.equal(actual.state,"committed");assert.equal(actual.cohort,"completed");assert.equal(actual.cohort_publication?.state,"committed");for(const v of tables)assert.deepEqual(f.copy.prepare(`SELECT ${v.columns.join(",")} FROM ${v.name} ORDER BY rowid`).all(),v.rows,String(v.name));assert.equal(rows(f.copy,"tenx_append_publications").length,2);
  const saved=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.input.cohortPublicationId!),cohortPlan=validateEvidenceCohortPlan(saved.plan);assert.equal(cohortPlan.kind,"candidate_cohorts");assert.equal(cohortPlan.operations.length,2);
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.cohortPublicationId!,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);t.diagnostic(JSON.stringify({original_tables:tables.length,receipt,cohort_operations:2,oracle_forwarding:false,prerequisite_copy:false,provider_requests:0}));
},receipt));

test("late cohort failure rolls back only cohorts; known-ID recovery needs no original candidate or producer rerun",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===walletCohortSql)throw Error("late_cohort_fault");return original.call(this,sql);});const actual=await run(f);hook.mock.restore();assert.equal(actual.state,"committed");assert.equal(actual.post_commit,"failed");assert.equal(actual.cohort_publication?.state,"held");assert.equal(actual.cohort,"unconfirmed");assert.equal(rows(f.copy,"tenx_cohorts").length,0);assert.equal(rows(f.copy,"tenx_wallet_cohorts").length,0);
  const candidate=rows(f.copy,"tenx_candidates"),usage=[rows(f.copy,"tenx_usage"),rows(f.copy,"tenx_wallet_usage")];const recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.cohortPublicationId!,mode:"publish"});assert.equal(recovered.state,"committed");assert.equal(rows(f.copy,"tenx_cohorts").length,1);assert.equal(rows(f.copy,"tenx_wallet_cohorts").length,1);assert.deepEqual(rows(f.copy,"tenx_candidates"),candidate);assert.deepEqual([rows(f.copy,"tenx_usage"),rows(f.copy,"tenx_wallet_usage")],usage);
},true));
test("unknown cohort acknowledgement reconciles the exact committed results read-only",()=>setup(async f=>{
  const id=f.input.cohortPublicationId!,original=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!lost)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return result;});const actual=await run(f);hook.mock.restore();assert.equal(lost,true);assert.equal(actual.state,"committed");assert.equal(actual.post_commit,"failed");assert.equal(actual.cohort_publication?.state,"held");const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));const recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:id,mode:"reconcile"});assert.equal(recovered.state,"committed");if(recovered.state==="committed")assert.deepEqual(recovered.results.map(r=>r.meta.changes),[1,1]);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));
test("later candidate changes cannot replace a retained observation or advance its timestamp during recovery",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===walletCohortSql)throw Error("cohort_fault");return original.call(this,sql);});await run(f);hook.mock.restore();f.copy.exec("UPDATE tenx_candidates SET payload=json_set(payload,'$.symbol','later','$.checked_at','2026-10-22T00:00:00.000Z')");const current=rows(f.copy,"tenx_candidates"),saved=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.input.cohortPublicationId!);
  assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.cohortPublicationId!,mode:"publish"})).state,"committed");assert.deepEqual(rows(f.copy,"tenx_candidates"),current);assert.equal(rows(f.copy,"tenx_cohorts")[0]!.payload,validateEvidenceCohortPlan(saved.plan).operations[0]!.bindings[5]);assert.equal(rows(f.copy,"tenx_cohorts")[0]!.selected_at,at);
}));
test("a failed or absent producer cannot create or execute cohort work",()=>setup(async f=>{
  const statements=await capture(f.input.candidate,at),before=state(f),result=await publishEvidenceCohortBatch(f.options,f.journal,f.grant,{publicationId:f.input.cohortPublicationId!,parentId:f.input.publicationId,statements});assert.equal(result.state,"held");assert.deepEqual(state(f),before);
}));
test("strict cohort domain rejects altered SQL, hashes, scope, row order, duplicate parent identity and extra work",()=>setup(async f=>{
  await parent(f);const b=await batch(f),plan=await planFor(f,b);assert.doesNotThrow(()=>validateEvidenceCohortPlan(plan));assert.throws(()=>validateEvidencePublicationPlan(plan));
  for(const mutate of [(p:any)=>p.operations.reverse(),(p:any)=>p.operations[0].sql+=' ',(p:any)=>p.operations[0].bindings[4]='0'.repeat(64),(p:any)=>p.operations[1].bindings[1]='other',(p:any)=>p.publication_id=p.parent.publication_id,(p:any)=>p.operations[0].expect_changes=1,(p:any)=>p.parent=p]){const bad=structuredClone(plan);mutate(bad);assert.throws(()=>validateEvidenceCohortPlan(bad));}
  const before=state(f);assert.equal((await publishEvidenceCohortBatch(f.options,f.journal,f.grant,{...b,statements:ProducerStatements.parse(b.statements).map((s,i)=>i?{...s,bindings:[...s.bindings.slice(0,-1),'{}']}:s)})).state,"held");assert.deepEqual(state(f),before);
}));
for(const corruption of ["missing","plan","results","owner"])test(`parent ${corruption} corruption holds cohort recovery without writes`,()=>setup(async f=>{
  await parent(f);const b=await batch(f),plan=await planFor(f,b);await persistEvidencePublicationIntent(f.options,f.journal,f.grant,plan);
  if(corruption==="missing")f.copy.prepare("DELETE FROM tenx_append_publications WHERE publication_id=?").run(b.parentId);if(corruption==="plan")f.copy.prepare("UPDATE tenx_append_publications SET plan_sha256=? WHERE publication_id=?").run('0'.repeat(64),b.parentId);if(corruption==="results")f.copy.prepare("UPDATE tenx_append_publications SET results_json='[]' WHERE publication_id=?").run(b.parentId);if(corruption==="owner")f.copy.prepare("UPDATE tenx_append_publications SET owner=? WHERE publication_id=?").run(randomUUID(),b.parentId);
  const before=state(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:b.publicationId,mode:"publish"})).state,"held");assert.deepEqual(state(f),before);
}));
test("owner transfer permits committed history reconciliation but never executes former-owner pending cohorts",()=>setup(async f=>{
  await parent(f);const b=await batch(f);assert.equal((await publishEvidenceCohortBatch(f.options,f.journal,f.grant,b)).state,"committed");const pending={...b,publicationId:randomUUID()};await persistEvidencePublicationIntent(f.options,f.journal,f.grant,await planFor(f,pending));
  const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:b.publicationId,mode:"reconcile"})).state,"committed");assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:pending.publicationId,mode:"publish"})).state,"held");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
},true));
test("existing first cohorts keep their original bytes; a new publication records zero changes",()=>setup(async f=>{
  await parent(f);const b=await batch(f),before=[rows(f.copy,"tenx_cohorts"),rows(f.copy,"tenx_wallet_cohorts")],actual=await publishEvidenceCohortBatch(f.options,f.journal,f.grant,b);assert.equal(actual.state,"committed");if(actual.state==="committed")assert.deepEqual(actual.results.map(r=>r.meta.changes),[0,0]);assert.deepEqual([rows(f.copy,"tenx_cohorts"),rows(f.copy,"tenx_wallet_cohorts")],before);
}));
test("candidate/policy tampering cannot enter a new intent even with recomputed payload hashes",()=>setup(async f=>{
  await parent(f);const b=await batch(f),statements=ProducerStatements.parse(b.statements),body=JSON.parse(String(statements[0]!.bindings[5]));body.policy.min_holders=0;
  const payload=JSON.stringify(body);statements[0]!.bindings[5]=payload;statements[0]!.bindings[4]=await hashJson(body);const wallet={...body,cohort_kind:"first_wallet_sample"};statements[1]!.bindings[4]=JSON.stringify(wallet);statements[1]!.bindings[3]=await hashJson(wallet);const before=state(f);assert.equal((await publishEvidenceCohortBatch(f.options,f.journal,f.grant,{...b,statements})).state,"held");assert.deepEqual(state(f),before);
}));
test("duplicate durable cohort identity holds before the candidate producer executes",()=>setup(async f=>{
  const before=state(f);f.input.cohortPublicationId=f.input.publicationId;assert.equal((await run(f)).state,"held");assert.deepEqual(state(f),before);
}));
for(const mode of ["ready_stop","commit_stop"])test(`fresh process ${mode} recovers exact captured cohort rows using only the retained identity`,()=>setup(async f=>{
  await parent(f);const b=await batch(f);f.copy.exec("DELETE FROM tenx_cohorts;DELETE FROM tenx_wallet_cohorts");const file=path.join(f.root,"cohort-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch:b,plan_kind:"candidate_cohorts"}));await assert.rejects(exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536}),e=>(e as {code:number}).code===(mode==="ready_stop"?75:76));
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite")),recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:b.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"});assert.equal(recovered.state,"committed");if(recovered.state==="committed")assert.deepEqual(recovered.results.map(r=>r.meta.changes),[1,1]);if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
},true));
test("a competing first-cohort write after readiness holds the pending plan instead of silently changing its survivor",()=>setup(async f=>{
  await parent(f);const b=await batch(f);f.copy.exec("DELETE FROM tenx_cohorts;DELETE FROM tenx_wallet_cohorts");const p=await planFor(f,b);await persistEvidencePublicationIntent(f.options,f.journal,f.grant,p);
  const actual=await capture(f.input.candidate,at);await sqliteD1(f.copy).batch(actual.map(s=>sqliteD1(f.copy).prepare(s.sql).bind(...s.bindings)));const before=state(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:b.publicationId,mode:"publish"})).state,"held");assert.deepEqual(state(f),before);
}));
for(const change of ["delete","rehash","result","existing_rehash"])test(`committed ${change} tampering holds read-only cohort reconciliation`,()=>setup(async f=>{
  if(change==="existing_rehash"){await parent(f);assert.equal((await publishEvidenceCohortBatch(f.options,f.journal,f.grant,await batch(f))).state,"committed");}else{const outcome=await run(f);assert.equal(outcome.cohort_publication?.state,"committed");}
  if(change==="delete")f.copy.exec("DELETE FROM tenx_cohorts");if(change==="rehash"||change==="existing_rehash"){const row=rows(f.copy,"tenx_cohorts")[0]!,body=JSON.parse(String(row.payload));body.candidate.symbol='tampered';f.copy.prepare("UPDATE tenx_cohorts SET payload=?,input_hash=?").run(JSON.stringify(body),await hashJson(body));}if(change==="result")f.copy.prepare("UPDATE tenx_append_publications SET results_json=? WHERE publication_id=?").run(JSON.stringify([{success:true,results:[],meta:{changes:0}},{success:true,results:[],meta:{changes:0}}]),f.input.cohortPublicationId!);
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.cohortPublicationId!,mode:"reconcile"})).state,"held");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));
test("same-input retry returns original cohort results without reconstructing first-row pins or duplicating SQL",()=>setup(async f=>{
  const first=await run(f);assert.equal(first.cohort_publication?.state,"committed");const before=await fs.readFile(path.join(f.target,"metadata.sqlite")),second=await run(f);assert.equal(second.cohort,"completed");assert.equal(second.cohort_publication?.state,"committed");if(second.cohort_publication?.state==="committed"){assert.equal(second.cohort_publication.reconciled,true);assert.deepEqual(second.cohort_publication.results.map(r=>r.meta.changes),[1,1]);}assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));
test("partial encrypted readiness is held on retry rather than resealed as an absent intent",()=>setup(async f=>{
  const open=fs.open,ready=path.join(f.journal.directory,"pending",f.input.cohortPublicationId!,"ready.json"),hook=mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){if(String(name)===ready&&flags==="wx")throw Error("before_ready");return open(name,flags,...args);});const first=await run(f);hook.mock.restore();assert.equal(first.state,"committed");assert.equal(first.post_commit,"failed");assert.equal(first.cohort_publication?.state,"held");const file=path.join(path.dirname(ready),"intent.bin"),cipher=await fs.readFile(file),before=state(f),again=await run(f);assert.equal(again.state,"committed");assert.equal(again.post_commit,"failed");assert.equal(again.cohort_publication?.state,"held");assert.deepEqual(await fs.readFile(file),cipher);assert.deepEqual(state(f),before);assert.deepEqual(await fs.readdir(path.dirname(ready)),['intent.bin']);
}));
