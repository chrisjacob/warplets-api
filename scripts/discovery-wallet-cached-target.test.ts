import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,sha,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal,readEvidencePublicationIntent} from "./discovery-evidence-intents.mjs";
import {validateEvidenceWalletCachedPlan,validateEvidencePublicationPlan,validateEvidenceCandidateMetadataPlan,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {cachedCheckpointSql,cachedFinishSql} from "./evidence-wallet-cached-sql.mjs";
import {continueCachedFundingOnEvidenceTarget,type WalletCachedTargetInput} from "./lib/evidence-wallet-cached-target";
import {publishEvidenceWalletCachedBatch,publishEvidenceCandidateMetadataBatch,recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";
import {continueCachedFunding,recordCachedFundingWork} from "../discovery/src/funding-cache-work";
import {saveCandidate} from "../discovery/src/store";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {signature} from "../discovery/src/wallet-fixtures.test-helper";
import {analyzeWalletEvidence,WalletEvidenceSchema,type WalletEvidence} from "../discovery/src/wallet-analysis";
import {FundingScanSchema,type FundingScan} from "../discovery/src/funding-history";
import {WalletTransactionSchema} from "../discovery/src/wallet-rpc";
import {hashJson} from "../discovery/src/solana";
import {MAINNET_GENESIS} from "../discovery/src/rpc";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import type {Candidate} from "../discovery/src/model";
import recorded from "../discovery/fixtures/recorded/v1-wallet-funding.json";

const exec=promisify(execFile),at=recorded.recorded_at,owner="cached-test-owner";
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:WalletCachedTargetInput;scan:FundingScan};
async function setup(work:(f:Setup)=>Promise<void>,marker=false,seed?:(db:DatabaseSync)=>void){
  mock.timers.enable({apis:["Date"],now:new Date(at)});
  const base=(await fixtureCandidates(new Date(at)))[0]!,tx=WalletTransactionSchema.parse(recorded.transaction),origin=WalletTransactionSchema.parse(recorded.anchor_transaction);
  const scan=FundingScanSchema.parse({wallet:recorded.anchor.wallet,anchor:recorded.anchor,lookback_seconds:3600,attempted_at:at,pages:[{before:recorded.anchor.signature,fetched_at:at,rows:[{signature:recorded.signature,slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(210),slot:tx.slot-20,blockTime:Date.parse(recorded.anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]}],examined:marker?[{signature:recorded.signature,status:"unsupported"}]:[]});
  const evidence:WalletEvidence={version:"wallet-input-v4",observed_at:at,cluster:MAINNET_GENESIS,asset:{address:recorded.mint,pool:recorded.pool,token_program:base.risk.token_program,creation:base.creation,graduation:base.graduation},records:[{signature:recorded.anchor.signature,transaction:origin,fetched_at:at,status:"available",purposes:["recent"]}],histories:[],holders:null,prior_losses:[],gaps:[],funding_scans:[scan],second_hop_scans:[]};
  if(marker)evidence.records.push({signature:recorded.signature,transaction:null,fetched_at:at,status:"unsupported",purposes:["wallet"]});
  const normalized=WalletEvidenceSchema.parse(evidence),candidate:Candidate={...base,mode:"live",address:recorded.mint,pool:recorded.pool,holders:null,wallet_analysis:await analyzeWalletEvidence(normalized)},directory=path.resolve(".tmp","wallet-cached-test-"+randomUUID());
  try{await fixture(async f=>{const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,scan,journal:{directory,contextPin:created.context_pin},input:{candidate,owner,now:at,started:at,finishPublicationId:randomUUID(),checkpoints:[{wallet:scan.wallet,anchorSignature:scan.anchor.signature,publicationId:randomUUID()}]}});},async({db})=>{
    db.exec("DELETE FROM tenx_candidates; DELETE FROM tenx_wallet_work");await saveCandidate(sqliteD1(db),candidate);db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(candidate.wallet_analysis!.evidence_hash,candidate.address,JSON.stringify(normalized),at);db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?)").run(candidate.address,scan.wallet,scan.anchor.signature,JSON.stringify(scan),await hashJson(scan),at);db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(recorded.signature,recorded.transaction_hash,JSON.stringify(tx),at);
    db.prepare("UPDATE tenx_wallet_control SET lease_owner=?,lease_until=?,last_error='rpc_unavailable',last_success='2026-10-19T00:00:00.000Z'").run(owner,new Date(Date.parse(at)+360000).toISOString());seed?.(db);
  });}finally{mock.timers.reset();try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-cached-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const run=(f:Setup,input=f.input)=>continueCachedFundingOnEvidenceTarget(f.source,f.options,f.journal,f.grant,input);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const stable=(f:Setup)=>["tenx_candidates","tenx_funding_scans","tenx_second_hop_scans","tenx_wallet_transactions","tenx_wallet_work","tenx_wallet_runs","tenx_wallet_attempts","tenx_wallet_control","tenx_usage","tenx_wallet_usage","tenx_append_publications"].map(t=>rows(f.copy,t));
const expected=(f:Setup)=>f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(r=>String(r.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});
function complete(value:Awaited<ReturnType<typeof run>>){assert.equal(value.state,"completed",JSON.stringify(value));if(value.state!=="completed")throw Error("completed_expected");return value;}
async function checkpointPlan(f:Setup){const scan=FundingScanSchema.parse({...f.scan,examined:[{signature:recorded.signature,status:"available"}],attempted_at:at});return {publicationId:f.input.checkpoints[0]!.publicationId,statements:[{sql:cachedCheckpointSql,bindings:[JSON.stringify(scan),await hashJson(scan),at,f.input.candidate.address,scan.wallet,scan.anchor.signature,await hashJson(f.scan),f.input.candidate.wallet_analysis!.evidence_hash,owner]}]};}

for(const marker of [false,true])test(`complete original cached continuation and completion match all metadata (terminal marker ${marker})`,t=>setup(async f=>{
  const d1=sqliteD1(f.db),progress=await continueCachedFunding(d1,f.input.candidate,owner,new Date(at)),recordedResult=await recordCachedFundingWork(d1,f.input.candidate,owner,at,progress,1),values=expected(f),sourceHash=sha(await fs.readFile(path.join(f.root,"source.sqlite"))),originalCandidate=rows(f.copy,"tenx_candidates");
  mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});
  const result=complete(await run(f));assert.equal(result.recorded,recordedResult);assert.deepEqual(result.progress,progress);assert.equal(result.publications.length,2);assert.deepEqual(result.publications.map(p=>p.state==="committed"?p.results.map(r=>r.meta.changes):p.state),[[1],[1,1,1,1]]);
  for(const value of values)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));assert.deepEqual(rows(f.copy,"tenx_candidates"),originalCandidate);assert.equal(sha(await fs.readFile(path.join(f.root,"source.sqlite"))),sourceHash);assert.equal(f.copy.prepare("SELECT last_error FROM tenx_wallet_control").get()!.last_error,"rpc_unavailable");
  const bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));for(const id of [f.input.checkpoints[0]!.publicationId,f.input.finishPublicationId]){const recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:id,mode:"reconcile"});assert.equal(recovered.state,"committed");}assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
  t.diagnostic(JSON.stringify({original_tables:values.length,changes:[[1],[1,1,1,1]],oracle_forwarding:false,prerequisite_copy:false,new_observations:0,provider_requests:0,limits_unchanged:true}));
},marker));

for(const failure of ["hash","future","slot","signature","wallet","failed"])test(`invalid ${failure} evidence holds before any checkpoint or completion write`,()=>setup(async f=>{
  const before=stable(f),result=await run(f);assert.equal(result.state,"held");assert.deepEqual(result.publications,[]);assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readdir(path.join(f.journal.directory,"pending")),[]);
},false,db=>{if(failure==="hash"){db.exec("UPDATE tenx_wallet_transactions SET payload_hash='invalid'");return;}if(failure==="future"){db.prepare("UPDATE tenx_wallet_transactions SET fetched_at=?").run(new Date(Date.parse(at)+1).toISOString());return;}const tx=structuredClone(recorded.transaction);if(failure==="slot")tx.slot++;if(failure==="signature")tx.transaction.signatures[0]=signature(211);if(failure==="wallet")tx.transaction.message.accountKeys=tx.transaction.message.accountKeys.map(k=>k===recorded.anchor.wallet?"11111111111111111111111111111111":k);if(failure==="failed")tx.meta.err={failed:true} as never;const normalized=WalletTransactionSchema.parse(tx);db.prepare("UPDATE tenx_wallet_transactions SET payload=?,payload_hash=?").run(JSON.stringify(normalized),sha(JSON.stringify(normalized)));}));

test("an absent pending body stays unresolved and does not acquire a new source observation or checkpoint",()=>setup(async f=>{
  const original=await continueCachedFunding(sqliteD1(f.db),f.input.candidate,owner,new Date(at)),before=rows(f.copy,"tenx_funding_scans"),result=complete(await run(f));assert.deepEqual(result.progress,original);assert.equal(result.progress.stage,"direct_funding");assert.equal(result.progress.pending_transactions,1);assert.equal(result.progress.decoded_transactions,0);assert.equal(result.publications.length,1);assert.deepEqual(rows(f.copy,"tenx_funding_scans"),before);assert.equal(result.provider_requests,0);
},false,db=>db.exec("DELETE FROM tenx_wallet_transactions")));

for(const guard of ["pause","owner","expiry","candidate","checkpoint"])test(`original ${guard} guard retains a committed zero-row result and holds the workflow`,()=>setup(async f=>{
  const open=fs.open;let changed=false;
  mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(!changed&&flags==="wx"&&String(name).endsWith("ready.json")){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();changed=true;if(guard==="pause")f.copy.exec("UPDATE tenx_control SET paused=1");if(guard==="owner")f.copy.exec("UPDATE tenx_wallet_control SET lease_owner='other'");if(guard==="expiry")f.copy.exec("UPDATE tenx_wallet_control SET lease_until='1970-01-01T00:00:00.000Z'");if(guard==="candidate")f.copy.exec("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash','changed')");if(guard==="checkpoint")f.copy.exec("UPDATE tenx_funding_scans SET payload_hash='changed'");};}return handle;});
  const result=await run(f);assert.equal(changed,true);assert.equal(result.state,"held");if(result.state==="held")assert.equal(result.reason,"funding_cache_checkpoint_or_owner_changed");assert.equal(result.publications.length,1);assert.equal(result.publications[0]!.state,"committed");if(result.publications[0]!.state==="committed")assert.deepEqual(result.publications[0]!.results.map(r=>r.meta.changes),[0]);assert.deepEqual(JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_funding_scans").get()!.payload)).examined,[]);assert.deepEqual(rows(f.copy,"tenx_wallet_runs"),[]);
}));

test("a late completion failure rolls back its four writes while retaining earlier checkpoint progress and allowances",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===cachedFinishSql[3])throw Error("late_completion_fault");return original.call(this,sql);}),before=rows(f.copy,"tenx_usage"),result=await run(f);assert.equal(result.state,"held");assert.deepEqual(rows(f.copy,"tenx_wallet_work"),[]);assert.deepEqual(rows(f.copy,"tenx_wallet_runs"),[]);assert.deepEqual(rows(f.copy,"tenx_wallet_attempts"),[]);assert.equal(f.copy.prepare("SELECT lease_owner FROM tenx_wallet_control").get()!.lease_owner,owner);assert.equal(JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_funding_scans").get()!.payload)).examined.length,1);assert.deepEqual(rows(f.copy,"tenx_usage"),before);hook.mock.restore();
  const recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.finishPublicationId,mode:"publish"});assert.equal(recovered.state,"committed");if(recovered.state==="committed")assert.deepEqual(recovered.results.map(r=>r.meta.changes),[1,1,1,1]);
}));

test("losing the completion lease after checkpoint progress reports recorded=false without changing another owner's schedule",()=>setup(async f=>{
  const open=fs.open;let changed=false;mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(!changed&&flags==="wx"&&String(name)===path.join(f.journal.directory,"pending",f.input.finishPublicationId,"ready.json")){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();changed=true;f.copy.exec("UPDATE tenx_wallet_control SET lease_owner='replacement',next_refresh_at='2030-01-01T00:00:00.000Z'");};}return handle;});
  const result=complete(await run(f));assert.equal(changed,true);assert.equal(result.recorded,false);assert.deepEqual(rows(f.copy,"tenx_wallet_runs"),[]);assert.deepEqual({...f.copy.prepare("SELECT lease_owner,next_refresh_at FROM tenx_wallet_control").get()},{lease_owner:"replacement",next_refresh_at:"2030-01-01T00:00:00.000Z"});
  assert.deepEqual(result.publications.map(p=>p.state==="committed"?p.results.map(r=>r.meta.changes):p.state),[[1],[0,0,0,0]]);
}));

test("missing/duplicate stable identities hold before writes; caller mutation cannot substitute identities or authority",()=>setup(async f=>{
  const before=stable(f);for(const input of [{...f.input,checkpoints:[]},{...f.input,finishPublicationId:f.input.checkpoints[0]!.publicationId},{...f.input,checkpoints:[...f.input.checkpoints,...f.input.checkpoints]}])assert.equal((await run(f,input)).state,"held");assert.deepEqual(stable(f),before);
  const input=structuredClone(f.input),grant={...f.grant},options=structuredClone(f.options),pending=continueCachedFundingOnEvidenceTarget(f.source,options,f.journal,grant,input);input.finishPublicationId=randomUUID();input.candidate.address="different";grant.epoch++;options.targetPin="0".repeat(64);assert.equal(complete(await pending).publications[1]!.publication_id,f.input.finishPublicationId);
}));

test("strict plan domain rejects receipt mixing, arbitrary quota/control SQL, altered guards, foreign scope and forged hashes",()=>setup(async f=>{
  const batch=await checkpointPlan(f),plan={publication_id:batch.publicationId,kind:"wallet_cached_progress",operations:batch.statements.map(row=>({kind:"sql",...row}))};assert.doesNotThrow(()=>validateEvidenceWalletCachedPlan(plan));assert.throws(()=>validateEvidencePublicationPlan(plan));assert.throws(()=>validateEvidenceCandidateMetadataPlan(plan));
  const invalid=[{...plan,stage_id:randomUUID()},{...plan,operations:[{kind:"receipt"}]},{...plan,operations:[{kind:"sql",sql:"UPDATE tenx_usage SET used=0",bindings:[]}]},{...plan,operations:[{...plan.operations[0],sql:cachedCheckpointSql.replace("AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)","")}]},{...plan,operations:[{...plan.operations[0],bindings:batch.statements[0]!.bindings.map((v,i)=>i===1?"0".repeat(64):v)}]},{...plan,operations:[...plan.operations,...plan.operations]}];
  const before=stable(f);for(const bad of invalid)assert.throws(()=>validateEvidenceWalletCachedPlan(bad));assert.deepEqual(stable(f),before);
  const first=await publishEvidenceWalletCachedBatch(f.options,f.journal,f.grant,batch);assert.equal(first.state,"committed");const changed=structuredClone(batch);changed.statements[0]!.bindings[8]="different-owner";assert.equal((await publishEvidenceWalletCachedBatch(f.options,f.journal,f.grant,changed)).state,"held");
  const candidate=f.input.candidate,other=await publishEvidenceCandidateMetadataBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,statements:[{sql:"INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?1,?2,?3,?4,?5)",bindings:[candidate.address,candidate.pool,JSON.stringify(candidate),candidate.checked_at,"live"]}]});assert.equal(other.state,"held");
}));

for(const mode of ["ready_stop","commit_stop"])test(`fresh-process ${mode} retains exact cached publication identity and recovers without workflow arguments`,()=>setup(async f=>{
  const batch=await checkpointPlan(f),file=path.join(f.root,"cached-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch,plan_kind:"wallet_cached_progress"}));let stopped=false;try{await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536});}catch(error){assert.equal((error as {code:number}).code,mode==="ready_stop"?75:76);stopped=true;}assert.equal(stopped,true);
  const saved=await readEvidencePublicationIntent(f.options,f.journal,f.grant,batch.publicationId),plan=validateEvidenceWalletCachedPlan(saved.plan);assert.equal(plan.kind,"wallet_cached_progress");assert.deepEqual(plan.operations.map(op=>{if(op.kind!=="sql")throw Error("sql_expected");return {sql:op.sql,bindings:op.bindings};}),batch.statements);
  assert.equal(rows(f.copy,"tenx_append_publications").length,mode==="ready_stop"?0:1);assert.equal(JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_funding_scans").get()!.payload)).examined.length,mode==="ready_stop"?0:1);
  const bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));const recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"});assert.equal(recovered.state,"committed");if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("stale generation/owner/epoch and wrong target pins hold both workflow and cached publisher before SQL",()=>setup(async f=>{
  const batch=await checkpointPlan(f),before=stable(f);
  for(const grant of [{...f.grant,epoch:f.grant.epoch+1},{...f.grant,owner:randomUUID()},{...f.grant,generation:randomUUID()}]){assert.equal((await continueCachedFundingOnEvidenceTarget(f.source,f.options,f.journal,grant,f.input)).state,"held");assert.equal((await publishEvidenceWalletCachedBatch(f.options,f.journal,grant,batch)).state,"held");}
  assert.equal((await publishEvidenceWalletCachedBatch({...f.options,targetPin:"0".repeat(64)},f.journal,f.grant,batch)).state,"held");assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readdir(path.join(f.journal.directory,"pending")),[]);
}));

test("completion plans retain the exact four-operation guard, common scope, zero-RPC work and original schedule",()=>setup(async f=>{
  complete(await run(f));const saved=await readEvidencePublicationIntent(f.options,f.journal,f.grant,f.input.finishPublicationId),plan=validateEvidenceWalletCachedPlan(saved.plan);
  const mutate=(change:(ops:any[])=>void)=>{const altered=structuredClone(plan);change(altered.operations);assert.throws(()=>validateEvidenceWalletCachedPlan(altered));};
  mutate(ops=>{ops[1].bindings[0]="another-owner";});mutate(ops=>{ops[2].bindings[3]="0".repeat(64);});mutate(ops=>{ops[3].sql="UPDATE tenx_wallet_control SET lease_owner='reactivated'";});mutate(ops=>{ops.reverse();});mutate(ops=>{ops.pop();});mutate(ops=>{ops[3].bindings[4]="2030-01-01T00:00:00.000Z";});mutate(ops=>{ops[0].expect_changes=1;});
  for(const field of ["address","source_evidence_hash","rpc_calls"]){mutate(ops=>{const work=JSON.parse(ops[0].bindings[4]);work[field]=field==="rpc_calls"?1:"foreign";ops[0].bindings[4]=JSON.stringify(work);});}
  mutate(ops=>{ops[0].bindings[4]=JSON.stringify({padding:"é".repeat(125001)});});
}));

test("lost SQL acknowledgement is held until read-only reconciliation; replacement owner cannot execute pending work",()=>setup(async f=>{
  const batch=await checkpointPlan(f),original=DatabaseSync.prototype.exec;let injected=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!injected)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(batch.publicationId);}catch{}const value=original.call(this,sql);if(stop){injected=true;throw Error("ack_lost");}return value;});
  assert.equal((await publishEvidenceWalletCachedBatch(f.options,f.journal,f.grant,batch)).state,"held");assert.equal(injected,true);hook.mock.restore();
  const pending={...batch,publicationId:randomUUID()},prepare=DatabaseSync.prototype.prepare,fault=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===cachedCheckpointSql)throw Error("before_sql_fault");return prepare.call(this,sql);});assert.equal((await publishEvidenceWalletCachedBatch(f.options,f.journal,f.grant,pending)).state,"held");fault.mock.restore();
  const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));const recovered=await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:batch.publicationId,mode:"reconcile"});assert.equal(recovered.state,"committed");for(const mode of ["publish","reconcile"] as const)assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:pending.publicationId,mode})).state,"held");assert.equal((await publishEvidenceWalletCachedBatch(f.options,f.journal,f.grant,{...batch,publicationId:randomUUID()})).state,"held");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));
