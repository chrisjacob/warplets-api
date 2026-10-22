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
import {validateEvidenceWalletDirectPlan,validateEvidenceWalletCyclePlan,checkEvidenceWalletDirectDispatch,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {runRecordedDirectWalletCycleOnEvidenceTarget,type WalletDirectCycleTargetInput} from "./lib/evidence-wallet-direct-cycle-target";
import {publishEvidenceWalletDirectBatch,publishEvidenceWalletCycleBatch,recoverEvidenceProducerBatch,type WalletCycleContext} from "./lib/evidence-producer-publication";
import {reserveWalletQuotaOnEvidenceTarget} from "./lib/evidence-wallet-quota-target";
import {walletLeaseSql} from "./evidence-wallet-cycle-sql.mjs";
import {directCatchupSql,directBackoffSql,directFinishSql} from "./evidence-wallet-direct-sql.mjs";
import {saveCandidate} from "../discovery/src/store";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {signature} from "../discovery/src/wallet-fixtures.test-helper";
import {analyzeWalletEvidence,WalletEvidenceSchema,type WalletEvidence} from "../discovery/src/wallet-analysis";
import {FundingScanSchema,type FundingScan} from "../discovery/src/funding-history";
import {WalletTransactionSchema} from "../discovery/src/wallet-rpc";
import {runWalletCycle,type WalletSettings} from "../discovery/src/wallet-cycle";
import {hashJson} from "../discovery/src/solana";
import {MAINNET_GENESIS,MAX_TRANSACTION_VERSION} from "../discovery/src/rpc";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import type {Candidate} from "../discovery/src/model";
import recorded from "../discovery/fixtures/recorded/v1-wallet-funding.json";

const exec=promisify(execFile),at=recorded.recorded_at;
const tx=WalletTransactionSchema.parse(recorded.transaction);
// Old archive body is normalized. Wire header counters, boundary signature and
// optional empty-page starting state are synthetic integration scaffolding.
const wireTx={...recorded.transaction,transaction:{...recorded.transaction.transaction,message:{...recorded.transaction.transaction.message,header:{...recorded.transaction.transaction.message.header,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:0}}}};
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:WalletDirectCycleTargetInput;scan:FundingScan;candidate:Candidate;job:ReturnType<typeof randomUUID>};
async function setup(work:(f:Setup)=>Promise<void>,mode="body",seed?:(db:DatabaseSync)=>void){
  mock.timers.enable({apis:["Date"],now:new Date(at)});const job=randomUUID();mock.method(globalThis.crypto,"randomUUID",()=>job);
  const base=(await fixtureCandidates(new Date(at)))[0]!,rows=[{signature:recorded.signature,slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(210),slot:tx.slot-20,blockTime:Date.parse(recorded.anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}],scan=FundingScanSchema.parse({wallet:recorded.anchor.wallet,anchor:recorded.anchor,lookback_seconds:3600,attempted_at:at,pages:mode==="paging"?[]:[{before:recorded.anchor.signature,fetched_at:at,rows}],examined:[]});
  const evidence:WalletEvidence=WalletEvidenceSchema.parse({version:"wallet-input-v4",observed_at:at,cluster:MAINNET_GENESIS,asset:{address:recorded.mint,pool:recorded.pool,token_program:base.risk.token_program,creation:base.creation,graduation:base.graduation},records:[{signature:recorded.anchor.signature,transaction:WalletTransactionSchema.parse(recorded.anchor_transaction),fetched_at:at,status:"available",purposes:["recent"]}],histories:[],holders:null,prior_losses:[],gaps:[],funding_scans:[scan],second_hop_scans:[]});
  const candidate:Candidate={...base,mode:"live",address:recorded.mint,pool:recorded.pool,holders:null,wallet_analysis:await analyzeWalletEvidence(evidence)},directory=path.resolve(".tmp","wallet-direct-test-"+randomUUID());
  const reply=(method:"getGenesisHash"|"getSignaturesForAddress"|"getTransaction",params:unknown[],result:unknown,id:number)=>({method,params,body:JSON.stringify({jsonrpc:"2.0",id,result}),status:200,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()});
  const replies=[reply("getGenesisHash",[],MAINNET_GENESIS,1)];if(mode==="paging")replies.push(reply("getSignaturesForAddress",[scan.wallet,{commitment:"finalized",limit:50,before:scan.anchor.signature}],rows,2));replies.push(reply("getTransaction",[recorded.signature,{commitment:"finalized",encoding:"json",maxSupportedTransactionVersion:MAX_TRANSACTION_VERSION}],mode==="missing"?null:mode==="unsupported"?{version:2}:wireTx,replies.length+1));
  if(mode==="rate_limited"){replies[0]!.status=429;Object.assign(replies[0]!,{retryAfter:"600"});}
  const input:WalletDirectCycleTargetInput={address:candidate.address,now:at,walletEnabled:mode!=="disabled",walletDailyLimit:800,rpcDailyLimit:5000,marketDailyLimit:600,ids:{lease:randomUUID(),spacing:randomUUID(),release:randomUUID(),catchup:randomUUID(),backoff:randomUUID(),work:randomUUID(),finish:randomUUID(),failure_run:randomUUID(),failure_release:randomUUID(),failure_attempt:randomUUID()},writeIds:Array.from({length:16},()=>randomUUID()),replies};
  try{await fixture(async f=>{const made=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,input,scan,candidate,job,journal:{directory,contextPin:made.context_pin}});},async({db})=>{
    db.exec("DELETE FROM tenx_candidates;DELETE FROM tenx_wallet_work");await saveCandidate(sqliteD1(db),candidate);db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(candidate.wallet_analysis!.evidence_hash,candidate.address,JSON.stringify(evidence),at);db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?)").run(candidate.address,scan.wallet,scan.anchor.signature,JSON.stringify(scan),await hashJson(scan),at);db.exec("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_error='rpc_unavailable'");
    if(mode==="rpc_exhausted")db.prepare("INSERT INTO tenx_usage VALUES('rpc',?,5000)").run(at.slice(0,10));if(mode==="wallet_exhausted")db.prepare("INSERT INTO tenx_wallet_usage VALUES(?,800)").run(at.slice(0,10));if(mode==="no_catchup")db.prepare("INSERT INTO tenx_usage VALUES('wallet_catchup',?,180)").run(at.slice(0,10));if(mode==="paused")db.exec("UPDATE tenx_control SET paused=1");if(mode==="backoff")db.prepare("UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after=?").run(new Date(Date.parse(at)+60000).toISOString());if(mode==="busy")db.prepare("UPDATE tenx_wallet_control SET lease_owner='other',lease_until=?").run(new Date(Date.parse(at)+60000).toISOString());seed?.(db);
  });}finally{mock.timers.reset();try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-direct-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const run=(f:Setup,input=f.input)=>runRecordedDirectWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,f.grant,input);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const state=(f:Setup)=>["tenx_candidates","tenx_wallet_transactions","tenx_funding_scans","tenx_wallet_work","tenx_wallet_runs","tenx_funding_reads","tenx_usage","tenx_wallet_usage","tenx_control","tenx_wallet_control","tenx_wallet_attempts","tenx_append_publications"].map(t=>rows(f.copy,t));
function completed(result:Awaited<ReturnType<typeof run>>){assert.equal(result.state,"completed",JSON.stringify(result));if(result.state!=="completed")throw Error("completed_expected");return result;}
async function oracle(f:Setup){let received=0;const i=f.input;return runWalletCycle({db:sqliteD1(f.db),walletEnabled:i.walletEnabled,walletDailyLimit:i.walletDailyLimit,rpcDailyLimit:i.rpcDailyLimit,marketDailyLimit:i.marketDailyLimit,rpcUrl:"https://offline.invalid",marketEnabled:false,transport:async(_url,init)=>{const call=JSON.parse(String(init?.body)),reply=i.replies[received++]!;assert.equal(call.id,received);assert.equal(call.method,reply.method);assert.deepEqual(call.params,reply.params);return new Response(reply.body,{status:reply.status,headers:reply.retryAfter?{"retry-after":reply.retryAfter}:{}});}} as WalletSettings,i.address,new Date(i.now));}
function context(f:Setup):WalletCycleContext{return {lease_id:f.input.ids.lease,job:f.job,address:f.input.address,at,until:new Date(Date.parse(at)+360000).toISOString(),rapid:1};}
const directBatch=(f:Setup)=>({publicationId:f.input.ids.catchup,cycle:context(f),sourceHash:f.candidate.wallet_analysis!.evidence_hash,limits:{wallet:800,rpc:5000},statements:[{sql:directCatchupSql,bindings:[at.slice(0,10),180]}]});
async function acquire(f:Setup){const c=context(f);assert.equal((await publishEvidenceWalletCycleBatch(f.options,f.journal,f.grant,{publicationId:c.lease_id,cycle:c,statements:[{sql:walletLeaseSql,bindings:[c.job,c.until,c.at,c.rapid]}]})).state,"committed");}

for(const mode of ["body","paging","missing","unsupported","rate_limited","rpc_exhausted","wallet_exhausted","no_catchup","disabled","paused","backoff","busy"])test(`original direct cycle and all retained metadata match: ${mode}`,t=>setup(async f=>{
  const expected=await oracle(f),tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(c=>String(c.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});const actual=completed(await run(f));assert.deepEqual(actual.result,expected);for(const value of tables)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));assert.equal(actual.provider_requests,0);assert.equal(actual.source_authorized,false);if(mode==="unsupported")assert.equal(rows(f.copy,"tenx_funding_reads")[0]!.is_recovery,0);if(mode==="rate_limited")assert.equal(rows(f.copy,"tenx_control")[0]!.last_error,"rpc_rate_limited");
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));for(const p of actual.publications)if(p.publication_id)assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:p.publication_id,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);t.diagnostic(JSON.stringify({original_tables:tables.length,original_cycle:true,mode,recorded_responses:actual.recorded_responses,provider_requests:0,oracle_forwarding:false,prerequisite_copy:false}));
},mode));

test("late completion failure retains collected work and quota spend but rolls back the success batch",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===directFinishSql)throw Error("finish_fault");return original.call(this,sql);});const actual=completed(await run(f));hook.mock.restore();assert.equal(actual.result.state,"failed");assert.equal(actual.result.error_code,"wallet_direct_publication_unconfirmed");assert.equal(rows(f.copy,"tenx_wallet_work").length,1);assert.equal(rows(f.copy,"tenx_wallet_transactions").length,1);assert.equal(rows(f.copy,"tenx_wallet_runs").length,1);assert.equal(rows(f.copy,"tenx_wallet_runs")[0]!.state,"failed");assert.equal(rows(f.copy,"tenx_wallet_control")[0]!.lease_owner,null);assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(at.slice(0,10))!.used,2);
}));

for(const point of ["lease","rpc"])test(`lost ${point} acknowledgement never dispatches; known-ID recovery is historical`,()=>setup(async f=>{
  const id=point==="lease"?f.input.ids.lease:f.input.replies[0]!.rpcPublicationId,original=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!lost)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return result;});const actual=await run(f);hook.mock.restore();assert.equal(lost,true);assert.equal(actual.recorded_responses,0);if(point==="lease")assert.equal(actual.state,"held");else assert.equal(completed(actual).result.state,"failed");const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:id,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

test("wallet lease replacement after reservation withholds dispatch and preserves the replacement owner",()=>setup(async f=>{
  const id=f.input.replies[0]!.rpcPublicationId,original=DatabaseSync.prototype.exec;let changed=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!changed)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(stop){changed=true;f.copy.exec("UPDATE tenx_wallet_control SET lease_owner='replacement'");}return result;});const actual=completed(await run(f));hook.mock.restore();assert.equal(actual.recorded_responses,0);assert.equal(actual.result.state,"failed");assert.equal(rows(f.copy,"tenx_wallet_control")[0]!.lease_owner,"replacement");assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(at.slice(0,10))!.used,1);
}));

test("reconciled counter history cannot dispatch a new recorded response",()=>setup(async f=>{
  const reply=f.input.replies[0]!;assert.equal((await reserveWalletQuotaOnEvidenceTarget(f.options,f.journal,f.grant,{now:at,walletDailyLimit:800,rpcDailyLimit:5000,walletPublicationId:reply.walletPublicationId,rpcPublicationId:reply.rpcPublicationId})).state,"reserved");const actual=completed(await run(f));assert.equal(actual.result.error_code,"wallet_direct_replayed_reservation");assert.equal(actual.recorded_responses,0);assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(at.slice(0,10))!.used,1);
}));

test("strict direct domain binds original catch-up cap, source/job, SQL and parent",()=>setup(async f=>{
  const b=directBatch(f),plan={publication_id:b.publicationId,kind:"wallet_direct_cycle",cycle:b.cycle,source_hash:b.sourceHash,limits:b.limits,operations:b.statements.map(row=>({kind:"sql",...row}))};assert.doesNotThrow(()=>validateEvidenceWalletDirectPlan(plan));assert.throws(()=>validateEvidenceWalletCyclePlan(plan));
  for(const change of [(p:any)=>p.operations[0].bindings[1]=181,(p:any)=>p.operations[0].sql=directCatchupSql.replace('used+18','used+1'),(p:any)=>p.source_hash='bad',(p:any)=>p.operations[0].expect_changes=1,(p:any)=>p.operations.push(p.operations[0])]){const bad=structuredClone(plan);change(bad);assert.throws(()=>validateEvidenceWalletDirectPlan(bad));}const before=state(f);assert.equal((await publishEvidenceWalletDirectBatch(f.options,f.journal,f.grant,b)).state,"held");assert.deepEqual(state(f),before);await acquire(f);assert.equal((await publishEvidenceWalletDirectBatch(f.options,f.journal,f.grant,b)).state,"committed");
}));

test("current owner reconciles the original parent-bound commit but cannot execute old pending plans",()=>setup(async f=>{
  await acquire(f);const b=directBatch(f);assert.equal((await publishEvidenceWalletDirectBatch(f.options,f.journal,f.grant,b)).state,"committed");const oldPending={...b,publicationId:f.input.ids.backoff,statements:[{sql:directBackoffSql,bindings:[new Date(Date.parse(at)+600000).toISOString()]}]};const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===directBackoffSql)throw Error("before_backoff");return original.call(this,sql);});assert.equal((await publishEvidenceWalletDirectBatch(f.options,f.journal,f.grant,oldPending)).state,"held");hook.mock.restore();const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:b.publicationId,mode:"reconcile"})).state,"committed");assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:oldPending.publicationId,mode:"publish"})).state,"held");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

test("other scheduler paths and duplicate identities hold before lease rather than becoming source permission",()=>setup(async f=>{
  const before=state(f);assert.equal((await run(f,{...f.input,writeIds:[f.input.ids.lease]})).state,"held");assert.deepEqual(state(f),before);f.copy.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(recorded.signature,await hashJson(tx),JSON.stringify(tx),at);const cached=state(f);assert.equal((await run(f)).state,"held");assert.deepEqual(state(f),cached);
}));

test("caller mutation and stale grants cannot replace recording, IDs or target authority",()=>setup(async f=>{
  const before=state(f);assert.equal((await runRecordedDirectWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,{...f.grant,epoch:f.grant.epoch+1},f.input)).state,"held");assert.deepEqual(state(f),before);const input=structuredClone(f.input),options=structuredClone(f.options),grant={...f.grant},pending=runRecordedDirectWalletCycleOnEvidenceTarget(f.source,options,f.journal,grant,input);input.replies[0]!.body="changed";input.ids.lease=randomUUID();options.targetPin="0".repeat(64);grant.epoch++;assert.equal(completed(await pending).result.state,"progressed");
}));

for(const mode of ["ready_stop","commit_stop"])test(`fresh-process ${mode} recovers catch-up result without cycle arguments or another reservation`,()=>setup(async f=>{
  await acquire(f);const batch=directBatch(f),file=path.join(f.root,"direct-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch,plan_kind:"wallet_direct_cycle"}));await assert.rejects(exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536}),e=>(e as {code:number}).code===(mode==="ready_stop"?75:76));const before=await fs.readFile(path.join(f.target,"metadata.sqlite")),actual=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"});assert.equal(actual.state,"committed");if(actual.state==="committed")assert.deepEqual(actual.results,[{success:true,results:[{used:18}],meta:{changes:1}}]);if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

test("corrupt catch-up results hold read-only and dispatch checks reject stale wallet leases",()=>setup(async f=>{
  await acquire(f);const b=directBatch(f);assert.equal((await publishEvidenceWalletDirectBatch(f.options,f.journal,f.grant,b)).state,"committed");f.copy.prepare("UPDATE tenx_append_publications SET results_json=? WHERE publication_id=?").run(JSON.stringify([{success:true,results:[{used:19}],meta:{changes:1}}]),b.publicationId);const before=state(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:b.publicationId,mode:"reconcile"})).state,"held");assert.deepEqual(state(f),before);f.copy.exec("UPDATE tenx_wallet_control SET lease_owner='other'");await assert.rejects(checkEvidenceWalletDirectDispatch(f.options,f.grant,{cycle:context(f),source_hash:b.sourceHash,at}),/dispatch_held/);
}));
