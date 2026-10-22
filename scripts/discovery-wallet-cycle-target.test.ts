import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal} from "./discovery-evidence-intents.mjs";
import {readEvidenceWalletCycleMetadata,validateEvidenceWalletCyclePlan,validateEvidenceWalletQuotaPlan,validateEvidencePublicationPlan,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {runCachedWalletCycleOnEvidenceTarget,type WalletCycleTargetInput} from "./lib/evidence-wallet-cycle-target";
import {publishEvidenceWalletCycleBatch,recoverEvidenceProducerBatch,type WalletCycleContext} from "./lib/evidence-producer-publication";
import {walletLeaseSql,walletSpacingSql} from "./evidence-wallet-cycle-sql.mjs";
import {cachedFinishSql} from "./evidence-wallet-cached-sql.mjs";
import {saveCandidate} from "../discovery/src/store";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {key,signature} from "../discovery/src/wallet-fixtures.test-helper";
import {analyzeWalletEvidence,WalletEvidenceSchema,type WalletEvidence} from "../discovery/src/wallet-analysis";
import {FundingScanSchema,type FundingScan} from "../discovery/src/funding-history";
import {WalletTransactionSchema} from "../discovery/src/wallet-rpc";
import {runWalletCycle,type WalletSettings} from "../discovery/src/wallet-cycle";
import {hashJson} from "../discovery/src/solana";
import {MAINNET_GENESIS} from "../discovery/src/rpc";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import type {Candidate} from "../discovery/src/model";
import recorded from "../discovery/fixtures/recorded/v1-wallet-funding.json";

const exec=promisify(execFile),at=recorded.recorded_at;
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:WalletCycleTargetInput;scan:FundingScan;job:ReturnType<typeof randomUUID>};
async function setup(work:(f:Setup)=>Promise<void>,seed?:(db:DatabaseSync)=>void,marker=false){
  mock.timers.enable({apis:["Date"],now:new Date(at)});const job=randomUUID();mock.method(globalThis.crypto,"randomUUID",()=>job);
  const base=(await fixtureCandidates(new Date(at)))[0]!,tx=WalletTransactionSchema.parse(recorded.transaction),origin=WalletTransactionSchema.parse(recorded.anchor_transaction),scan=FundingScanSchema.parse({wallet:recorded.anchor.wallet,anchor:recorded.anchor,lookback_seconds:3600,attempted_at:at,pages:[{before:recorded.anchor.signature,fetched_at:at,rows:[{signature:recorded.signature,slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(210),slot:tx.slot-20,blockTime:Date.parse(recorded.anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]}],examined:marker?[{signature:recorded.signature,status:"unsupported"}]:[]});
  const evidence:WalletEvidence={version:"wallet-input-v4",observed_at:at,cluster:MAINNET_GENESIS,asset:{address:recorded.mint,pool:recorded.pool,token_program:base.risk.token_program,creation:base.creation,graduation:base.graduation},records:[{signature:recorded.anchor.signature,transaction:origin,fetched_at:at,status:"available",purposes:["recent"]}],histories:[],holders:null,prior_losses:[],gaps:[],funding_scans:[scan],second_hop_scans:[]};if(marker)evidence.records.push({signature:recorded.signature,transaction:null,fetched_at:at,status:"unsupported",purposes:["wallet"]});
  const normalized=WalletEvidenceSchema.parse(evidence),candidate:Candidate={...base,mode:"live",address:recorded.mint,pool:recorded.pool,holders:null,wallet_analysis:await analyzeWalletEvidence(normalized)},directory=path.resolve(".tmp","wallet-cycle-test-"+randomUUID());
  try{await fixture(async f=>{const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,scan,job,journal:{directory,contextPin:created.context_pin},input:{address:candidate.address,now:at,walletEnabled:true,walletDailyLimit:800,rpcDailyLimit:5000,marketDailyLimit:600,ids:{lease:randomUUID(),spacing:randomUUID(),release:randomUUID(),finish:randomUUID(),failure_run:randomUUID(),failure_release:randomUUID(),failure_attempt:randomUUID()},checkpoints:[{wallet:scan.wallet,anchorSignature:scan.anchor.signature,publicationId:randomUUID()}]}});},async({db})=>{
    db.exec("DELETE FROM tenx_candidates;DELETE FROM tenx_wallet_work");await saveCandidate(sqliteD1(db),candidate);db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(candidate.wallet_analysis!.evidence_hash,candidate.address,JSON.stringify(normalized),at);db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?)").run(candidate.address,scan.wallet,scan.anchor.signature,JSON.stringify(scan),await hashJson(scan),at);db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(recorded.signature,recorded.transaction_hash,JSON.stringify(tx),at);db.exec("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_error='rpc_unavailable'");seed?.(db);
  });}finally{mock.timers.reset();try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-cycle-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const run=(f:Setup,input=f.input)=>runCachedWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,f.grant,input);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const stable=(f:Setup)=>["tenx_candidates","tenx_funding_scans","tenx_wallet_work","tenx_wallet_runs","tenx_wallet_attempts","tenx_wallet_control","tenx_control","tenx_usage","tenx_wallet_usage","tenx_append_publications"].map(t=>rows(f.copy,t));
const expected=(f:Setup)=>f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(r=>String(r.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});
function complete(value:Awaited<ReturnType<typeof run>>){assert.equal(value.state,"completed",JSON.stringify(value));if(value.state!=="completed")throw Error("completed_expected");return value;}
async function oracle(f:Setup,input=f.input){return runWalletCycle({db:sqliteD1(f.db),walletEnabled:input.walletEnabled,walletDailyLimit:input.walletDailyLimit,rpcDailyLimit:input.rpcDailyLimit,marketDailyLimit:input.marketDailyLimit,rpcUrl:"https://offline.invalid",marketEnabled:false,transport:async()=>{throw Error("oracle_provider_forbidden");}} as WalletSettings,input.address,new Date(input.now));}
function controlBatch(f:Setup,sql=walletLeaseSql){const cycle:WalletCycleContext={lease_id:f.input.ids.lease,job:f.job,address:f.input.address,at,until:new Date(Date.parse(at)+360000).toISOString(),rapid:1};return {publicationId:sql===walletLeaseSql?cycle.lease_id:f.input.ids.spacing,cycle,statements:[{sql,bindings:sql===walletLeaseSql?[cycle.job,cycle.until,cycle.at,cycle.rapid]:[new Date(Date.parse(at)+60000).toISOString(),cycle.job]}]};}

for(const marker of [false,true])test(`complete original cached cycle matches all metadata without oracle forwarding (old marker ${marker})`,t=>setup(async f=>{
  const result=await oracle(f),values=expected(f);assert.equal(result.state,"progressed");mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});const actual=complete(await run(f));assert.deepEqual(actual.result,result);for(const value of values)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));assert.equal(actual.cycle?.job,f.job);assert.equal(actual.source_authorized,false);assert.deepEqual(actual.publications.map(p=>p.state==="committed"?p.results.map(r=>r.meta.changes):p.state),[[1],[1],[1],[1,1,1,1]]);
  const bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));for(const p of actual.publications){assert.ok(p.publication_id);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:p.publication_id!,mode:"reconcile"})).state,"committed");}assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
  t.diagnostic(JSON.stringify({original_tables:values.length,whole_original_cycle:true,changes:[[1],[1],[1],[1,1,1,1]],provider_requests:0,source_authorized:false,oracle_forwarding:false,prerequisite_copy:false}));
},undefined,marker));

for(const guard of ["disabled","paused","shared_backoff","busy","expiry_equality","not_due","empty","cache_invalid"])test(`${guard}: original scheduler outcome and all metadata are retained`,()=>setup(async f=>{
  const input={...f.input,walletEnabled:guard!=="disabled",address:guard==="empty"?key(42):f.input.address},result=await oracle(f,input),values=expected(f),actual=complete(await run(f,input));assert.deepEqual(actual.result,result);for(const value of values)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));assert.equal(actual.provider_requests,0);if(["disabled","paused","shared_backoff"].includes(guard))assert.equal(actual.publications.length,0);
},db=>{if(guard==="paused")db.exec("UPDATE tenx_control SET paused=1");if(guard==="shared_backoff")db.prepare("UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after=?").run(new Date(Date.parse(at)+60000).toISOString());if(guard==="busy"||guard==="expiry_equality")db.prepare("UPDATE tenx_wallet_control SET lease_owner='other',lease_until=?").run(guard==="busy"?new Date(Date.parse(at)+60000).toISOString():at);if(guard==="not_due")db.prepare("UPDATE tenx_wallet_control SET next_refresh_at=?").run(new Date(Date.parse(at)+60000).toISOString());if(guard==="cache_invalid")db.exec("UPDATE tenx_wallet_transactions SET payload_hash='corrupt'");}));

test("source-backed or unsupported planning paths hold before acquisition without buying data or charging quotas",()=>setup(async f=>{
  const before=stable(f),result=await run(f);assert.equal(result.state,"held");if(result.state==="held")assert.equal(result.reason,"wallet_cycle_cached_path_required");assert.deepEqual(result.publications,[]);assert.deepEqual(stable(f),before);
},db=>db.exec("DELETE FROM tenx_wallet_transactions")));

test("late completion failure retains checkpoint progress and records original failed-turn pacing without source calls",()=>setup(async f=>{
  const prepare=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===cachedFinishSql[3])throw Error("completion_fault");return prepare.call(this,sql);});const actual=complete(await run(f));hook.mock.restore();assert.equal(actual.result.state,"failed");assert.equal(actual.result.error_code,"wallet_cycle_publication_unconfirmed");assert.equal(actual.result.rpc_calls,0);assert.equal(JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_funding_scans").get()!.payload)).examined.length,1);assert.equal(f.copy.prepare("SELECT lease_owner FROM tenx_wallet_control").get()!.lease_owner,null);assert.equal(f.copy.prepare("SELECT state FROM tenx_wallet_runs").get()!.state,"failed");assert.equal(rows(f.copy,"tenx_wallet_work").length,0);assert.equal(rows(f.copy,"tenx_usage")[0]!.used,3);
}));

test("missing or duplicate retained checkpoint/control identities hold before acquisition",()=>setup(async f=>{
  const before=stable(f);for(const input of [{...f.input,checkpoints:[]},{...f.input,ids:{...f.input.ids,finish:f.input.ids.lease}},{...f.input,checkpoints:[...f.input.checkpoints,...f.input.checkpoints]}])assert.equal((await run(f,input)).state,"held");assert.deepEqual(stable(f),before);
}));

test("lost lease acknowledgement never continues the cycle; known-ID recovery records history without reacquiring",()=>setup(async f=>{
  const original=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!lost)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(f.input.ids.lease);}catch{}const value=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return value;});const actual=await run(f);assert.equal(actual.state,"held");assert.equal(lost,true);assert.equal(actual.publications.length,1);hook.mock.restore();const before=stable(f),recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.ids.lease,mode:"reconcile"});assert.equal(recovered.state,"committed");if(recovered.state==="committed")assert.deepEqual(recovered.results[0]!.results,[{id:1}]);assert.deepEqual(stable(f),before);assert.equal(rows(f.copy,"tenx_wallet_runs").length,0);
}));

test("parent-bound control cannot execute before acquisition or under a replacement append owner",()=>setup(async f=>{
  const child=controlBatch(f,walletSpacingSql),before=stable(f);assert.equal((await publishEvidenceWalletCycleBatch(f.options,f.journal,f.grant,child)).state,"held");assert.deepEqual(stable(f),before);assert.equal((await publishEvidenceWalletCycleBatch(f.options,f.journal,f.grant,controlBatch(f))).state,"committed");const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,snapshot=stable(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:child.publicationId,mode:"publish"})).state,"held");assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.input.ids.lease,mode:"reconcile"})).state,"committed");assert.deepEqual(stable(f),snapshot);
}));

test("strict lease/control domain rejects altered SQL, owner/time bindings, ordinary quota writes and known job reuse",()=>setup(async f=>{
  const b=controlBatch(f),plan={publication_id:b.publicationId,kind:"wallet_cycle_control",cycle:b.cycle,operations:b.statements.map(row=>({kind:"sql",...row}))};assert.doesNotThrow(()=>validateEvidenceWalletCyclePlan(plan));assert.throws(()=>validateEvidenceWalletQuotaPlan(plan));assert.throws(()=>validateEvidencePublicationPlan(plan));
  const mutate=(change:(p:any)=>void)=>{const invalid=structuredClone(plan);change(invalid);assert.throws(()=>validateEvidenceWalletCyclePlan(invalid));};mutate(p=>{p.operations[0].sql="UPDATE tenx_usage SET used=0";});mutate(p=>{p.operations[0].sql=walletLeaseSql.replace("lease_until<?3","1=1");});mutate(p=>{p.operations[0].bindings[0]=randomUUID();});mutate(p=>{p.cycle.until=p.cycle.at;});mutate(p=>{p.operations[0].expect_changes=1;});mutate(p=>{p.operations.push(p.operations[0]);});mutate(p=>{p.stage_id=randomUUID();});
  f.copy.prepare("INSERT INTO tenx_wallet_runs(id,address,source_evidence_hash,kind,state,started_at,finished_at,rpc_calls,completed_windows,new_buyers,error_code) VALUES(?,?,NULL,'funding','failed',?,?,0,0,0,'old')").run(f.job,f.input.address,at,at);const before=stable(f);assert.equal((await publishEvidenceWalletCycleBatch(f.options,f.journal,f.grant,b)).state,"held");assert.deepEqual(stable(f),before);
}));

test("new native scheduler reads preserve NUL/Unicode and are bounded, scoped and read-only",()=>setup(async f=>{
  f.copy.prepare("UPDATE tenx_control SET last_error=?").run("x\u0000é終");f.copy.prepare("INSERT INTO tenx_wallet_attempts VALUES(?,?,?)").run("mint\u0000é",at,at);const before=await fs.readFile(path.join(f.target,"metadata.sqlite")),control=await readEvidenceWalletCycleMetadata(f.options,f.grant,{kind:"control"});assert.equal(control.row!.last_error,"x\u0000é終");assert.equal((await readEvidenceWalletCycleMetadata(f.options,f.grant,{kind:"attempts"})).rows[0]!.address,"mint\u0000é");assert.equal((await readEvidenceWalletCycleMetadata(f.options,f.grant,{kind:"wallet_usage",day:at.slice(0,10)})).row,null);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);await assert.rejects(readEvidenceWalletCycleMetadata(f.options,f.grant,{kind:"sql",sql:"DELETE FROM tenx_usage"}));f.copy.prepare("UPDATE tenx_control SET last_error=?").run("é".repeat(2049));await assert.rejects(readEvidenceWalletCycleMetadata(f.options,f.grant,{kind:"control"}),/byte_bound/);
}));

test("stale grants and caller mutation cannot replace target authority or retained cycle IDs",()=>setup(async f=>{
  const before=stable(f);assert.equal((await runCachedWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,{...f.grant,epoch:f.grant.epoch+1},f.input)).state,"held");assert.deepEqual(stable(f),before);const input=structuredClone(f.input),options=structuredClone(f.options),grant={...f.grant},pending=runCachedWalletCycleOnEvidenceTarget(f.source,options,f.journal,grant,input);input.ids.lease=randomUUID();grant.epoch++;options.targetPin="0".repeat(64);assert.equal(complete(await pending).cycle?.lease_id,f.input.ids.lease);
}));

for(const mode of ["ready_stop","commit_stop"])test(`fresh-process ${mode} recovers the original lease result without workflow arguments or a second acquisition`,()=>setup(async f=>{
  const b=controlBatch(f),file=path.join(f.root,"cycle-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch:b,plan_kind:"wallet_cycle_control"}));let stopped=false;try{await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536});}catch(error){assert.equal((error as {code:number}).code,mode==="ready_stop"?75:76);stopped=true;}assert.equal(stopped,true);assert.equal(rows(f.copy,"tenx_append_publications").length,mode==="ready_stop"?0:1);const bytes=await fs.readFile(path.join(f.target,"metadata.sqlite")),recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:b.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"});assert.equal(recovered.state,"committed");if(recovered.state==="committed")assert.deepEqual(recovered.results,[{success:true,results:[{id:1}],meta:{changes:1}}]);if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("recovery rejects malformed lease rows, changed generation and an unaccepted parent",()=>setup(async f=>{
  const lease=controlBatch(f);assert.equal((await publishEvidenceWalletCycleBatch(f.options,f.journal,f.grant,lease)).state,"committed");
  const original=f.copy.prepare("SELECT * FROM tenx_append_publications WHERE publication_id=?").get(lease.publicationId)!;
  for(const results of [[{success:true,results:[{id:2}],meta:{changes:1}}],[{success:true,results:[{id:1}],meta:{changes:0}}]]){
    f.copy.prepare("UPDATE tenx_append_publications SET results_json=? WHERE publication_id=?").run(JSON.stringify(results),lease.publicationId);const before=stable(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:lease.publicationId,mode:"reconcile"})).state,"held");assert.deepEqual(stable(f),before);
  }
  f.copy.prepare("UPDATE tenx_append_publications SET results_json=?,generation=? WHERE publication_id=?").run(original.results_json,randomUUID(),lease.publicationId);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:lease.publicationId,mode:"reconcile"})).state,"held");
  f.copy.prepare("UPDATE tenx_append_publications SET results_json=?,generation=? WHERE publication_id=?").run(JSON.stringify([{success:true,results:[],meta:{changes:0}}]),original.generation,lease.publicationId);const before=stable(f);assert.equal((await publishEvidenceWalletCycleBatch(f.options,f.journal,f.grant,controlBatch(f,walletSpacingSql))).state,"held");assert.deepEqual(stable(f),before);
}));

test("scheduler attempt allocation holds oversized fields and row populations without truncation or writes",()=>setup(async f=>{
  f.copy.prepare("INSERT INTO tenx_wallet_attempts VALUES(?,?,?)").run("é".repeat(2049),at,at);let bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));await assert.rejects(readEvidenceWalletCycleMetadata(f.options,f.grant,{kind:"attempts"}),/attempt_byte_bound/);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
  f.copy.exec("DELETE FROM tenx_wallet_attempts; BEGIN");const insert=f.copy.prepare("INSERT INTO tenx_wallet_attempts VALUES(?,?,?)");for(let i=0;i<10001;i++)insert.run(String(i),at,at);f.copy.exec("COMMIT");bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));await assert.rejects(readEvidenceWalletCycleMetadata(f.options,f.grant,{kind:"attempts"}),/attempt_row_bound/);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));
