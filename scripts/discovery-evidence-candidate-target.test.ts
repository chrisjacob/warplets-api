import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID,createHash} from "node:crypto";
import {fixture,sha,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal} from "./discovery-evidence-intents.mjs";
import {readEvidenceCandidateMetadata,writeEvidenceCandidateCohorts,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {saveCandidateOnEvidenceTarget,type CandidateTargetInput,type CandidateTargetOutcome} from "./lib/evidence-candidate-target";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {publicationEvidenceReadStore} from "./lib/evidence-publication-read-store";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {saveCandidate} from "../discovery/src/store";
import {fixtureCandidates,syntheticBundle} from "../discovery/src/fixtures";
import {holderHistoryFixture} from "../discovery/src/holder-history-fixtures.test-helper";
import {analyzeHolders,type HolderEvidence} from "../discovery/src/holders";
import {analyzeWalletEvidence,WalletEvidenceSchema} from "../discovery/src/wallet-analysis";
import {walletInput} from "../discovery/src/wallet-fixtures.test-helper";
import {CandidateSchema,type Candidate} from "../discovery/src/model";

type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:CandidateTargetInput};
async function setup(work:(f:Setup)=>Promise<void>,seed?:(db:DatabaseSync,input:CandidateTargetInput)=>Promise<void>){
  const history=await holderHistoryFixture(),holder=history.samples[0]!.evidence as HolderEvidence,bundle=await syntheticBundle(new Date(history.cutoff_at));
  const wallet=await analyzeWalletEvidence(WalletEvidenceSchema.parse({...await walletInput(),observed_at:history.cutoff_at}));
  const candidate:Candidate={...(await fixtureCandidates(new Date(history.cutoff_at)))[0]!,mode:"live",address:holder.mint,pool:holder.pool,holders:await analyzeHolders(holder,history.index[0]!.observed_at),wallet_analysis:wallet};
  const input={publicationId:randomUUID(),stageId:randomUUID(),candidate,holderEvidence:holder,transactions:[bundle.creation,bundle.graduation],state:bundle.accounts},directory=path.resolve(".tmp","candidate-target-test-"+randomUUID());
  try{await fixture(async f=>{
    const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,input,journal:{directory,contextPin:created.context_pin}});
  },async({db})=>{db.exec("DELETE FROM tenx_candidates; DELETE FROM tenx_wallet_work");await seed?.(db,input);});
  }finally{try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("candidate-target-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
function committed(outcome:CandidateTargetOutcome){assert.equal(outcome.state,"committed",JSON.stringify(outcome));if(outcome.state!=="committed")throw Error("commit_expected");return outcome;}
const run=(f:Setup)=>saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,f.input);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
function originals(f:Setup){return f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row=>{
  const table=String(row.name),columns=f.copy.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name));
  return {table,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${table} ORDER BY rowid`).all()};
});}
function compareOriginals(f:Setup,expected:ReturnType<typeof originals>){for(const entry of expected)assert.deepEqual(f.copy.prepare(`SELECT ${entry.columns.join(",")} FROM ${entry.table} ORDER BY rowid`).all(),entry.rows,entry.table);}
const originalRun=(f:Setup)=>saveCandidate(sqliteD1(f.db),f.input.candidate,f.input.transactions,f.input.state,f.input.holderEvidence);
const stable=(f:Setup)=>["tenx_candidates","tenx_proofs","tenx_cohorts","tenx_wallet_cohorts","tenx_selections","tenx_append_publications","tenx_append_references","tenx_usage","tenx_wallet_usage"].map(table=>rows(f.copy,table));

test("complete original candidate workflow matches all original metadata tables, raw receipt and cohorts without oracle forwarding or prerequisite copying",context=>setup(async f=>{
  await originalRun(f);const expected=originals(f),sourceBefore=sha(await fs.readFile(path.join(f.root,"source.sqlite")));
  mock.method(f.db,"prepare",()=>{throw Error("oracle_access_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_access_forbidden");});
  const result=committed(await run(f));assert.equal(result.cohort,"completed");assert.equal(result.post_commit,"completed");compareOriginals(f,expected);
  assert.equal(sha(await fs.readFile(path.join(f.root,"source.sqlite"))),sourceBefore);assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_wallet_cohorts").get()!.n,1);
  await withScratchEvidenceResolver(f.source,async source=>{const actual=await publicationEvidenceReadStore(source,f.options,f.grant).holderReceipt(f.input.candidate.holders!.payload_hash!);assert.equal(actual!.payload,JSON.stringify(f.input.holderEvidence));return null;});
  const before=stable(f),retry=committed(await run(f));assert.equal(retry.reconciled,true);assert.equal(retry.cohort,"completed");assert.deepEqual(stable(f),before);
  context.diagnostic(JSON.stringify({workflow:"candidate_save",original_tables:expected.length,operations:result.results.length,receipt_position:2,cohorts:2,oracle_access:false,prerequisite_copy:false,provider_requests:0,runtime_activated:false}));
}));

test("preexisting newer merged metadata and immutable proofs match the original writer and cohort snapshot",()=>setup(async f=>{
  await originalRun(f);const expected=originals(f),result=committed(await run(f));assert.equal(result.cohort,"completed");compareOriginals(f,expected);
  const current=CandidateSchema.parse(JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_candidates").get()!.payload)));
  assert.equal(current.risk.observed_at,"2026-10-21T09:10:00.000Z");assert.equal(current.market!.fetched_at,"2026-10-21T09:10:00.000Z");
},async(db,input)=>{
  const at="2026-10-21T09:10:00.000Z",prior={...input.candidate,risk:{...input.candidate.risk,observed_at:at},market:{...input.candidate.market!,fetched_at:at},holders:null};
  await saveCandidate(sqliteD1(db),prior); // Entire prerequisite state precedes archive/clone.
}));

test("later original saves preserve first holder metadata/reference and first cohorts while updating the merged candidate",()=>setup(async f=>{
  await originalRun(f);committed(await run(f));const reference=rows(f.copy,"tenx_append_references"),cohorts=[rows(f.copy,"tenx_cohorts"),rows(f.copy,"tenx_wallet_cohorts")];
  const later="2026-10-21T09:15:00.000Z";f.input={...f.input,publicationId:randomUUID(),stageId:randomUUID(),candidate:{...f.input.candidate,checked_at:later,holders:{...f.input.candidate.holders!,observed_at:later}}};
  await originalRun(f);const expected=originals(f),result=committed(await run(f));assert.equal(result.results[2]!.meta.changes,0);compareOriginals(f,expected);assert.deepEqual(rows(f.copy,"tenx_append_references"),reference);assert.deepEqual([rows(f.copy,"tenx_cohorts"),rows(f.copy,"tenx_wallet_cohorts")],cohorts);
}));

test("conflicting original immutable proof holds before staging/publication and leaves every target row unchanged",()=>setup(async f=>{
  const before=stable(f),result=await run(f);assert.equal(result.state,"held");assert.equal(result.cohort,"not_started");assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readdir(path.join(f.stage.directory,"pending")),[]);
  await assert.rejects(originalRun(f),/conflicting_immutable_proof/);
},async(db,input)=>{const proof=input.candidate.creation!;db.prepare("INSERT INTO tenx_proofs VALUES(?,?,?,?,?,?,?)").run(input.candidate.address,proof.kind,proof.signature,proof.instruction_index,proof.slot,"0".repeat(64),JSON.stringify(proof));}));

test("late producer SQL fault rolls back candidate, proofs and receipt while preserving spent usage",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,patch=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql.startsWith("INSERT OR IGNORE INTO tenx_account_evidence"))throw Error("synthetic_late_producer_fault");return original.call(this,sql);});
  const before=stable(f),result=await run(f);assert.equal(result.state,"held");assert.equal(result.cohort,"not_started");assert.deepEqual(stable(f),before);assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_holder_evidence").get()!.n,1);patch.mock.restore();
  assert.equal(committed(await run(f)).cohort,"completed");
}));

test("late cohort fault rolls back the cohort batch, reports committed SQL separately and retries without producer SQL",()=>setup(async f=>{
  await originalRun(f);const expected=originals(f),original=DatabaseSync.prototype.prepare;
  const patch=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql.startsWith("INSERT OR IGNORE INTO tenx_wallet_cohorts"))throw Error("private_late_cohort_fault");return original.call(this,sql);});
  const first=committed(await run(f));assert.equal(first.post_commit,"failed");assert.equal(first.cohort,"unconfirmed");assert.equal(first.post_commit_error,"candidate_target_post_commit_failed");assert.equal(JSON.stringify(first).includes("private_late_cohort"),false);assert.deepEqual(rows(f.copy,"tenx_cohorts"),[]);assert.deepEqual(rows(f.copy,"tenx_wallet_cohorts"),[]);patch.mock.restore();
  const before=[rows(f.copy,"tenx_candidates"),rows(f.copy,"tenx_append_references"),rows(f.copy,"tenx_append_publications")];const retry=committed(await run(f));assert.equal(retry.reconciled,true);assert.equal(retry.cohort,"completed");assert.deepEqual([rows(f.copy,"tenx_candidates"),rows(f.copy,"tenx_append_references"),rows(f.copy,"tenx_append_publications")],before);compareOriginals(f,expected);
}));

test("lost cohort commit acknowledgement is a post-commit failure; explicit retry is idempotent",()=>setup(async f=>{
  const original=DatabaseSync.prototype.exec;let injected=false;
  const patch=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!injected){try{stop=!!this.prepare("SELECT 1 FROM tenx_cohorts").get();}catch{}}const result=original.call(this,sql);if(stop){injected=true;throw Error("cohort_ack_lost");}return result;});
  const first=committed(await run(f));assert.equal(injected,true);assert.equal(first.post_commit,"failed");assert.equal(first.cohort,"unconfirmed");patch.mock.restore();
  const before=stable(f),retry=committed(await run(f));assert.equal(retry.reconciled,true);assert.equal(retry.cohort,"completed");assert.deepEqual(stable(f),before);
}));

test("owner change after producer commit withholds post-read/cohort work and never revives old authority",()=>setup(async f=>{
  const open=fs.open;let next:typeof f.grant|undefined,transferring=false;
  mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){
    if(!transferring&&flags==="r"&&String(name).endsWith("publication.json")&&f.copy.prepare("SELECT count(*) AS n FROM tenx_append_publications").get()!.n===1){transferring=true;next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant;}
    return open(name,flags,...args);
  });
  // Avoid recursion in the ownership-transfer header read.
  const result=committed(await run(f));assert.equal(result.post_commit,"failed");assert.equal(result.cohort,"not_started");assert.ok(next);assert.deepEqual(rows(f.copy,"tenx_cohorts"),[]);
}));

test("metadata reads are native read-only, exact for NUL/Unicode, bounded and preserve scoped absence",()=>setup(async f=>{
  f.copy.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES('raw','pool',?,'at','live')").run("x\u0000é終");const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));
  assert.deepEqual((await readEvidenceCandidateMetadata(f.options,f.grant,{kind:"candidate",address:"raw"})).row,{payload:"x\u0000é終"});assert.equal((await readEvidenceCandidateMetadata(f.options,f.grant,{kind:"candidate",address:"absent"})).row,null);assert.equal((await readEvidenceCandidateMetadata(f.options,f.grant,{kind:"proof",address:"absent",proof_kind:"creation"})).row,null);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
  f.copy.prepare("UPDATE tenx_candidates SET payload=? WHERE address='raw'").run("é".repeat(1000001));await assert.rejects(readEvidenceCandidateMetadata(f.options,f.grant,{kind:"candidate",address:"raw"}),/byte_bound/);
  await assert.rejects(readEvidenceCandidateMetadata(f.options,f.grant,{kind:"sql",sql:"DELETE FROM tenx_candidates"}));
}));

function cohort(kind:"cohort"|"wallet"|"selection",address:string,eligible=true){
  const payload=JSON.stringify({candidate:{address,eligibility:eligible?"eligible":"provisional"},selected_at:"2026-10-22T02:00:00.000Z",...(kind==="wallet"?{cohort_kind:"first_wallet_sample"}:{})});
  return {kind,address,day:"2026-10-22",selected_at:"2026-10-22T02:00:00.000Z",input_hash:createHash("sha256").update(payload).digest("hex"),payload,...(kind==="cohort"?{recommended:eligible?1:0}:{})};
}
test("fixed cohort writes require a committed parent, authenticate payload hashes/scopes and preserve three original result positions",()=>setup(async f=>{
  const records=[cohort("cohort",f.input.candidate.address),cohort("wallet",f.input.candidate.address),cohort("selection",f.input.candidate.address)],request={publication_id:f.input.publicationId,rows:records};
  await assert.rejects(writeEvidenceCandidateCohorts(f.options,f.grant,request),/parent_uncommitted/);committed(await run(f));
  // Use a separate synthetic date so this fixed-SQL compatibility case does not
  // alter or replace the original workflow's first cohort.
  const result=await writeEvidenceCandidateCohorts(f.options,f.grant,request);assert.deepEqual(result.results.map(row=>row.meta.changes),[1,1,1]);const before=stable(f);assert.deepEqual((await writeEvidenceCandidateCohorts(f.options,f.grant,request)).results.map(row=>row.meta.changes),[0,0,0]);assert.deepEqual(stable(f),before);
  for(const rows of [[records[1]], [records[0],records[0]], [{...records[0],input_hash:"0".repeat(64)}], [records[0],{...records[1],address:"other"}], [{...records[0],recommended:0}], [{...records[0],payload:"{}"}], [records[0],cohort("selection",f.input.candidate.address,false)]])await assert.rejects(writeEvidenceCandidateCohorts(f.options,f.grant,{...request,rows}));assert.deepEqual(stable(f),before);
}));

test("all metadata methods and candidate workflow enforce target pins, current grants and unchanged schema",()=>setup(async f=>{
  const before=stable(f),bad={...f.grant,epoch:f.grant.epoch+1};await assert.rejects(readEvidenceCandidateMetadata(f.options,bad,{kind:"candidate",address:f.input.candidate.address}),/owner_fenced/);assert.equal((await saveCandidateOnEvidenceTarget(f.options,f.journal,bad,f.input)).state,"held");
  await assert.rejects(readEvidenceCandidateMetadata({...f.options,targetPin:"0".repeat(64)},f.grant,{kind:"candidate",address:"raw"}),/target_pin/);assert.deepEqual(stable(f),before);
  f.copy.exec("CREATE TABLE unexpected(id INTEGER)");await assert.rejects(readEvidenceCandidateMetadata(f.options,f.grant,{kind:"candidate",address:"raw"}),/schema_changed/);
}));

test("missing holder input and fixture mode hold without creating intents, changing quotas or activating a backend",()=>setup(async f=>{
  const before=stable(f);for(const input of [{...f.input,holderEvidence:undefined},{...f.input,candidate:{...f.input.candidate,mode:"fixture"}},{...f.input,candidate:{...f.input.candidate,holders:null}}]){const result=await saveCandidateOnEvidenceTarget(f.options,f.journal,f.grant,input as CandidateTargetInput);assert.equal(result.state,"held");assert.equal(result.runtime_activated,false);assert.equal(result.free_acceptance,false);}assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readdir(path.join(f.journal.directory,"pending")),[]);
}));

test("caller configuration, candidate and raw evidence snapshots retain original bytes across IO",()=>setup(async f=>{
  const input=structuredClone(f.input),options=structuredClone(f.options),grant={...f.grant},pending=saveCandidateOnEvidenceTarget(options,f.journal,grant,input);
  input.candidate.symbol="changed";input.holderEvidence!.creator=null;input.publicationId=randomUUID();options.targetPin="0".repeat(64);grant.epoch++;
  const result=committed(await pending);assert.equal(result.publication_id,f.input.publicationId);const current=JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_candidates").get()!.payload));assert.equal(current.symbol,f.input.candidate.symbol);
}));
