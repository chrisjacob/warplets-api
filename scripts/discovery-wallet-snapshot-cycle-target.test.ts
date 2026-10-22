import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID,createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal,readEvidencePublicationIntent,readEvidencePublicationIntentIfPresent} from "./discovery-evidence-intents.mjs";
import {readEvidenceWalletSnapshotReviews,checkEvidenceWalletSnapshotDispatch,validateEvidenceWalletSnapshotPlan,validateEvidenceWalletDirectPlan,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {runRecordedSnapshotWalletCycleOnEvidenceTarget,type WalletSnapshotCycleTargetInput} from "./lib/evidence-wallet-direct-cycle-target";
import {publishEvidenceWalletSnapshotBatch,publishEvidenceWalletCycleBatch,recoverEvidenceProducerBatch,recoverLinkedWalletSnapshotBatch,type WalletSnapshotBatchInput,type WalletCycleContext} from "./lib/evidence-producer-publication";
import {recoverLinkedCandidateBatch} from "./lib/evidence-candidate-workflow";
import {validateEvidenceCohortPlan,publishEvidenceWalletSnapshot} from "./discovery-evidence-publication.mjs";
import {walletLeaseSql} from "./evidence-wallet-cycle-sql.mjs";
import {snapshotFinishSql} from "./evidence-wallet-snapshot-sql.mjs";
import {directCatchupSql} from "./evidence-wallet-direct-sql.mjs";
import {walletInput,signature} from "../discovery/src/wallet-fixtures.test-helper";
import {holderHistoryFixture} from "../discovery/src/holder-history-fixtures.test-helper";
import {analyzeHolders,HolderEvidenceSchema} from "../discovery/src/holders";
import {saveCandidate} from "../discovery/src/store";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {WalletEvidenceSchema,analyzeWalletEvidence} from "../discovery/src/wallet-analysis";
import {FundingScanSchema} from "../discovery/src/funding-history";
import {hashJson} from "../discovery/src/solana";
import {MAINNET_GENESIS} from "../discovery/src/rpc";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import type {Candidate} from "../discovery/src/model";
import {walletEvidenceSql,type ProducerStatement} from "./lib/evidence-producer-plan";
import {readStagedEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {readHolderSnapshotReceipt} from "./lib/evidence-wallet-snapshot-input";
import {walletCohortSql} from "./evidence-cohort-plan.mjs";

const exec=promisify(execFile),at="2026-10-21T09:05:00.000Z",sha=(s:string)=>createHash("sha256").update(s).digest("hex");
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:WalletSnapshotCycleTargetInput;candidate:Candidate;job:ReturnType<typeof randomUUID>;original:Record<string,unknown>;snapshotBatch:ProducerStatement[]};
async function setup(work:(f:Setup)=>Promise<void>,mode="full",seed?:(db:DatabaseSync)=>void){
  mock.timers.enable({apis:["Date"],now:new Date(at)});const job=randomUUID();mock.method(globalThis.crypto,"randomUUID",()=>job);
  const sample=await walletInput(),base=(await fixtureCandidates(new Date(at)))[0]!,refresh=["refresh","durable_refresh"].includes(mode),origin=mode!=="empty"&&!refresh;
  const candidate:Candidate={...base,mode:"live",creation:origin?sample.asset.creation:null,graduation:null,holders:null,wallet_analysis:null};
  const holder=["holder","durable_holder"].includes(mode)?HolderEvidenceSchema.parse((await holderHistoryFixture()).samples[0]!.evidence):null;if(holder)candidate.holders=await analyzeHolders(holder,at);
  const buyer=sample.records[1]!.transaction!,anchor={wallet:buyer.transaction.message.accountKeys[0]!,signature:buyer.transaction.signatures[0]!,slot:buyer.slot,block_time:new Date(buyer.blockTime!*1000).toISOString(),kind:"sampled_buy" as const};
  const scan=FundingScanSchema.parse({wallet:anchor.wallet,anchor,lookback_seconds:3600,attempted_at:at,pages:[{before:anchor.signature,fetched_at:at,rows:[{signature:signature(211),slot:buyer.slot-100,blockTime:buyer.blockTime!-3601,err:null,confirmationStatus:"finalized"}]}],examined:[]});
  const prior=refresh?WalletEvidenceSchema.parse({...sample,version:"wallet-input-v5",observed_at:at,asset:{...sample.asset,creation:null},records:[sample.records[1]],histories:[],funding_scans:[scan],second_hop_scans:[]}):null;if(prior)candidate.wallet_analysis=await analyzeWalletEvidence(prior);
  const input:WalletSnapshotCycleTargetInput={address:candidate.address,now:at,walletEnabled:mode!=="disabled",walletDailyLimit:800,rpcDailyLimit:5000,marketDailyLimit:600,stageId:randomUUID(),...(mode.startsWith("durable")?{cohortPublicationId:randomUUID()}:{}),ids:{lease:randomUUID(),spacing:randomUUID(),release:randomUUID(),catchup:randomUUID(),backoff:randomUUID(),work:randomUUID(),finish:randomUUID(),failure_run:randomUUID(),failure_release:randomUUID(),failure_attempt:randomUUID()},writeIds:Array.from({length:30},()=>randomUUID()),replies:[]},directory=path.resolve(".tmp","wallet-snapshot-test-"+randomUUID());
  try{await fixture(async f=>{
    const made=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});let call=0;
    // Fixed synthetic response data is generated before entering the target.
    // The target gets strings only and cannot call this oracle/transport.
    const transport:typeof fetch=async(_url,init)=>{
      const e=JSON.parse(String(init?.body));call++;let result:unknown;
      if(e.method==="getGenesisHash")result=MAINNET_GENESIS;
      else if(e.method==="getTransaction"){
        const body=sample.records.find(r=>r.signature===e.params[0])?.transaction;
        result=mode==="missing"?null:mode==="unsupported"?{version:2}:body?{...body,transaction:{...body.transaction,message:{...body.transaction.message,header:{...body.transaction.message.header,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:0}}}}:null;
      }else{
        const curve=sample.histories[0]!.address,address=e.params[0];
        if(mode==="empty")result=[];
        else if(address===curve)result=[...sample.records].reverse().map(r=>({signature:r.signature,slot:r.transaction!.slot,blockTime:r.transaction!.blockTime,err:null,confirmationStatus:"finalized"}));
        else if(address===candidate.pool)result=(refresh?[sample.records[1]!]:sample.records.slice(1)).map(r=>({signature:r.signature,slot:r.transaction!.slot,blockTime:r.transaction!.blockTime,err:null,confirmationStatus:"finalized"}));
        else result=[{signature:signature(211),slot:buyer.slot-100,blockTime:buyer.blockTime!-3601,err:null,confirmationStatus:"finalized"}];
      }
      const limited=mode==="rate_limited"||mode==="late_rate_limited"&&call===4,status=limited?429:200,body=JSON.stringify({jsonrpc:"2.0",id:e.id,result});
      input.replies.push({method:e.method,params:e.params,status,body,...(limited?{retryAfter:"600"}:{}),walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()});return new Response(body,{status,headers:limited?{"retry-after":"600"}:{}});
    };
    const originalDb=sqliteD1(f.db),owned=new WeakMap<object,ProducerStatement>();let snapshotBatch:ProducerStatement[]=[];
    const oracleDb={prepare(sql:string){const raw=originalDb.prepare(sql);const statement={bind(...bindings:ProducerStatement["bindings"]){raw.bind(...bindings);owned.set(statement,{sql,bindings});return statement;},first:raw.first.bind(raw),all:raw.all.bind(raw),run:raw.run.bind(raw)};owned.set(statement,{sql,bindings:[]});return statement;},async batch(statements:D1PreparedStatement[]){const captured=statements.map(s=>owned.get(s)!);if(captured[1]?.sql===walletEvidenceSql)snapshotBatch=structuredClone(captured);return originalDb.batch(statements);}} as unknown as D1Database;
    const original=await (await import("../discovery/src/wallet-cycle")).runWalletCycle({db:oracleDb,walletEnabled:input.walletEnabled,walletDailyLimit:800,rpcDailyLimit:5000,marketDailyLimit:600,rpcUrl:"https://offline.invalid",marketEnabled:false,transport} as never,input.address,new Date(at));
    // A declined reservation has no dispatched envelope. Its retained pair is
    // still required so the adapter can execute the original counter decline.
    if(["rpc_exhausted","wallet_exhausted"].includes(mode))input.replies.push({method:"getGenesisHash",params:[],body:JSON.stringify({jsonrpc:"2.0",id:1,result:MAINNET_GENESIS}),status:200,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()});
    await work({...f,input,candidate,job,original,snapshotBatch,journal:{directory,contextPin:made.context_pin}});
  },async({db})=>{
    db.exec("DELETE FROM tenx_candidates;DELETE FROM tenx_wallet_work;DELETE FROM tenx_cohorts;DELETE FROM tenx_wallet_cohorts;DELETE FROM tenx_selections");await saveCandidate(sqliteD1(db),candidate);
    if(holder)db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(candidate.holders!.payload_hash,candidate.address,holder.inventory.context.slot,JSON.stringify(holder),at);
    if(prior){db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(candidate.wallet_analysis!.evidence_hash,candidate.address,JSON.stringify(prior),at);db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?)").run(candidate.address,scan.wallet,scan.anchor.signature,JSON.stringify(scan),await hashJson(scan),at);}
    db.exec("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_error='rpc_unavailable'");
    if(mode==="rpc_exhausted")db.prepare("INSERT INTO tenx_usage VALUES('rpc',?,5000)").run(at.slice(0,10));if(mode==="wallet_exhausted")db.prepare("INSERT INTO tenx_wallet_usage VALUES(?,800)").run(at.slice(0,10));if(mode==="no_catchup")db.prepare("INSERT INTO tenx_usage VALUES('wallet_catchup',?,180)").run(at.slice(0,10));if(mode==="paused")db.exec("UPDATE tenx_control SET paused=1");if(mode==="backoff")db.prepare("UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after=?").run(new Date(Date.parse(at)+60000).toISOString());if(mode==="busy")db.prepare("UPDATE tenx_wallet_control SET lease_owner='other',lease_until=?").run(new Date(Date.parse(at)+60000).toISOString());seed?.(db);
  });}finally{mock.timers.reset();try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-snapshot-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
}
const run=(f:Setup,input=f.input)=>runRecordedSnapshotWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,f.grant,input);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const state=(f:Setup)=>["tenx_candidates","tenx_wallet_transactions","tenx_wallet_runs","tenx_wallet_profiles","tenx_wallet_evidence","tenx_usage","tenx_wallet_usage","tenx_wallet_control","tenx_wallet_attempts","tenx_append_publications"].map(t=>rows(f.copy,t));
function completed(r:Awaited<ReturnType<typeof run>>){assert.equal(r.state,"completed",JSON.stringify(r));if(r.state!=="completed")throw Error("completed_expected");return r;}
function context(f:Setup):WalletCycleContext{return {lease_id:f.input.ids.lease,job:f.job,address:f.input.address,at,until:new Date(Date.parse(at)+360000).toISOString(),rapid:1};}
async function acquire(f:Setup){const c=context(f);assert.equal((await publishEvidenceWalletCycleBatch(f.options,f.journal,f.grant,{publicationId:c.lease_id,cycle:c,statements:[{sql:walletLeaseSql,bindings:[c.job,c.until,c.at,c.rapid]}]})).state,"committed");}
function catchup(f:Setup):WalletSnapshotBatchInput{return {publicationId:f.input.ids.catchup,cycle:context(f),sourceHash:f.candidate.wallet_analysis?.evidence_hash??null,candidateHash:sha(String(f.copy.prepare("SELECT payload FROM tenx_candidates WHERE address=?").get(f.candidate.address)!.payload)),limits:{wallet:800,rpc:5000},statements:[{sql:directCatchupSql,bindings:[at.slice(0,10),180]}]};}
function snapshot(f:Setup):WalletSnapshotBatchInput{return {...catchup(f),publicationId:f.input.ids.finish,stageId:f.input.stageId,statements:f.snapshotBatch};}

for(const mode of ["full","durable","durable_refresh","durable_holder","refresh","holder","empty","missing","unsupported","rate_limited","late_rate_limited","rpc_exhausted","wallet_exhausted","no_catchup","disabled","paused","backoff","busy"])test(`original snapshot cycle matches all retained metadata: ${mode}`,t=>setup(async f=>{
  const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(c=>String(c.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});
  mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});
  const actual=completed(await run(f));assert.deepEqual(actual.result,f.original);for(const value of tables)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));
  if(f.original.state==="succeeded"){assert.equal(actual.producer?.state,"committed");assert.equal(actual.cohort,"completed");assert.equal(actual.post_commit,"completed");if(mode==="full")assert.ok(Number(actual.result.verified_buys)>=3);}
  if(mode.startsWith("durable")){assert.equal(actual.cohort_publication?.state,"committed");assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.cohortPublicationId!,mode:"reconcile"})).state,"committed");}
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));for(const p of actual.publications)if(p.publication_id)assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:p.publication_id,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);assert.equal(actual.provider_requests,0);assert.equal(actual.source_authorized,false);t.diagnostic(JSON.stringify({original_tables:tables.length,mode,recorded_responses:actual.recorded_responses,original_cycle:true,oracle_forwarding:false,prerequisite_copy:false}));
},mode));

test("snapshot batch failure rolls back receipt, candidate and profiles while retaining spent calls and ordinary cache",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===snapshotFinishSql)throw Error("finish_fault");return original.call(this,sql);});const actual=completed(await run(f));hook.mock.restore();assert.equal(actual.result.state,"failed");assert.equal(actual.producer?.state,"held");assert.equal(actual.cohort,"not_started");assert.equal(rows(f.copy,"tenx_append_references").length,0);assert.equal(rows(f.copy,"tenx_wallet_profiles").length,0);assert.equal(rows(f.copy,"tenx_wallet_transactions").length,4);assert.equal(rows(f.copy,"tenx_wallet_runs")[0]!.state,"failed");assert.ok(Number(rows(f.copy,"tenx_wallet_usage").find(r=>r.day===at.slice(0,10))!.used)>0);
}));
test("cohort failure explicitly retains the committed snapshot and original failure bookkeeping",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql.startsWith("INSERT OR IGNORE INTO tenx_cohorts(day,address,selected_at,recommended,input_hash,payload) VALUES(?,"))throw Error("cohort_fault");return original.call(this,sql);});const actual=completed(await run(f));hook.mock.restore();assert.equal(actual.result.state,"failed");assert.equal(actual.producer?.state,"committed");assert.equal(actual.cohort,"unconfirmed");assert.equal(actual.post_commit,"failed");assert.equal(rows(f.copy,"tenx_wallet_runs")[0]!.state,"succeeded");assert.equal(rows(f.copy,"tenx_append_references").length,1);assert.ok(rows(f.copy,"tenx_wallet_profiles").length>0);
}));
for(const point of ["lease","rpc","producer"])test(`lost ${point} acknowledgement holds; reconciliation never dispatches or repeats cohort work`,()=>setup(async f=>{
  const id=point==="lease"?f.input.ids.lease:point==="rpc"?f.input.replies[0]!.rpcPublicationId:f.input.ids.finish,original=DatabaseSync.prototype.exec;let lost=false;
  const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!lost)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return result;});const actual=await run(f);hook.mock.restore();assert.equal(lost,true);if(point!=="producer")assert.equal(actual.recorded_responses,0);assert.equal(actual.cohort,"not_started");const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:id,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));
for(const change of ["candidate","lease","pause","backoff"])test(`current ${change} change after counters prevents dispatch without refund`,()=>setup(async f=>{
  const id=f.input.replies[0]!.rpcPublicationId,original=DatabaseSync.prototype.exec;let changed=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!changed)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(stop){changed=true;f.copy.exec(change==="candidate"?"UPDATE tenx_candidates SET payload=json_set(payload,'$.symbol','changed')":change==="lease"?"UPDATE tenx_wallet_control SET lease_owner='replacement'":change==="pause"?"UPDATE tenx_control SET paused=1":`UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after='2026-10-22T00:00:00.000Z'`);}return result;});const actual=completed(await run(f));hook.mock.restore();assert.equal(changed,true);assert.equal(actual.recorded_responses,0);assert.equal(actual.result.state,"failed");assert.equal(rows(f.copy,"tenx_wallet_usage").find(r=>r.day===at.slice(0,10))!.used,1);
}));
test("strict snapshot scope rejects SQL, identity, source and cap changes; parent ownership survives read-only transfer",()=>setup(async f=>{
  const b=catchup(f),plan={kind:"wallet_snapshot_cycle",publication_id:b.publicationId,cycle:b.cycle,source_hash:b.sourceHash,candidate_hash:b.candidateHash,limits:b.limits,operations:(b.statements as any[]).map(r=>({kind:"sql",...r}))};assert.doesNotThrow(()=>validateEvidenceWalletSnapshotPlan(plan));assert.throws(()=>validateEvidenceWalletDirectPlan(plan));
  for(const mutate of [(p:any)=>p.operations[0].bindings[1]=181,(p:any)=>p.operations[0].sql+=' ',(p:any)=>p.source_hash='bad',(p:any)=>p.candidate_hash='bad',(p:any)=>p.publication_id=p.cycle.lease_id,(p:any)=>p.ticket={context_pin:'0'.repeat(64),stage_id:randomUUID(),ticket_sha256:'0'.repeat(64)}]){const bad=structuredClone(plan);mutate(bad);assert.throws(()=>validateEvidenceWalletSnapshotPlan(bad));}
  const before=state(f);assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,b)).state,"held");assert.deepEqual(state(f),before);await acquire(f);assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,b)).state,"committed");
  const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:b.publicationId,mode:"reconcile"})).state,"committed");assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,{...b,publicationId:randomUUID()})).state,"held");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));
test("snapshot inputs reject duplicate IDs and stale owners before lease; caller mutation cannot replace supplied records",()=>setup(async f=>{
  const before=state(f);assert.equal((await run(f,{...f.input,stageId:f.input.ids.lease})).state,"held");assert.equal((await runRecordedSnapshotWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,{...f.grant,epoch:f.grant.epoch+1},f.input)).state,"held");assert.deepEqual(state(f),before);const input=structuredClone(f.input),pending=run(f,input);input.replies[0]!.body="changed";input.ids.lease=randomUUID();assert.equal(completed(await pending).result.state,"succeeded");
}));
test("review reads preserve exact UTF-8/NUL and latest-per-day ordering, enforce bounds and current owner",()=>setup(async f=>{
  const values=[['2026-10-20','2026-10-20T00:00:00.000Z','z','old'],['2026-10-20',at,'b','second'],['2026-10-20',at,'a','\uFEFF新\u0000review'],['2026-10-21',at,'c','latestday']];for(const [day,created,hash,payload] of values)f.copy.prepare("INSERT INTO tenx_reviews(day,input_hash,payload,created_at) VALUES(?,?,?,?)").run(day,hash,payload,created);
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.deepEqual((await readEvidenceWalletSnapshotReviews(f.options,f.grant,{since:'2026-10-01T00:00:00.000Z'})).rows,[{payload:'latestday'},{payload:'\uFEFF新\u0000review'}]);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);await assert.rejects(readEvidenceWalletSnapshotReviews(f.options,{...f.grant,epoch:2},{since:at}));f.copy.prepare("UPDATE tenx_reviews SET payload=? WHERE input_hash='c'").run('x'.repeat(2000001));await assert.rejects(readEvidenceWalletSnapshotReviews(f.options,f.grant,{since:at}),/reviews_bound/);
}));
for(const mode of ["ready_stop","commit_stop"])test(`fresh-process ${mode} recovers snapshot-domain history from retained identity`,()=>setup(async f=>{
  await acquire(f);const batch=catchup(f),file=path.join(f.root,"snapshot-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch,plan_kind:"wallet_snapshot_cycle"}));await assert.rejects(exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536}),e=>(e as {code:number}).code===(mode==="ready_stop"?75:76));const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"})).state,"committed");if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

for(const mode of ["ready_stop","commit_stop"])test(`fresh-process ${mode} retains and recovers the complete authenticated snapshot batch`,()=>setup(async f=>{
  await acquire(f);const batch=snapshot(f),file=path.join(f.root,"snapshot-receipt-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch,plan_kind:"wallet_snapshot_cycle"}));await assert.rejects(exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536}),e=>(e as {code:number}).code===(mode==="ready_stop"?75:76));
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite")),actual=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"});assert.equal(actual.state,"committed");if(actual.state==="committed")assert.equal(actual.results.length,f.snapshotBatch.length);if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
  assert.equal(rows(f.copy,"tenx_append_references").length,1);assert.equal(rows(f.copy,"tenx_wallet_profiles").length,JSON.parse(String(f.snapshotBatch[2]!.bindings[0])).wallets.length);
  const saved=await readEvidencePublicationIntent(f.options,f.journal,f.grant,batch.publicationId);assert.ok('ticket' in saved.plan&&saved.plan.ticket);const receipt=await readStagedEvidenceAppend(f.stage,saved.plan.ticket);assert.equal(receipt.row.payload,f.snapshotBatch[1]!.bindings[2]);
}));
test("snapshot receipt/analysis/profile/job mismatches hold before SQL; publication atomically pins original candidate",()=>setup(async f=>{
  await acquire(f);const batch=snapshot(f),before=state(f);
  for(const mutate of [(b:any)=>b.statements[0].bindings[0]=randomUUID(),(b:any)=>b.statements[1].bindings[1]=signature(100),(b:any)=>b.statements[2].bindings[0]=JSON.stringify({...JSON.parse(b.statements[2].bindings[0]),metrics:{}}),(b:any)=>b.statements[6].bindings[3]='{}',(b:any)=>b.statements.push(b.statements[6])]){const bad=structuredClone(batch);mutate(bad);assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,bad)).state,"held");assert.deepEqual(state(f),before);}
  f.copy.exec("UPDATE tenx_candidates SET payload=json_set(payload,'$.symbol','changed')");const changed=state(f);assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch)).state,"held");assert.deepEqual(state(f),changed);
}));
test("holder context is authenticated across full frozen-source admission and stale owner checks",()=>setup(async f=>{
  const hash=f.candidate.holders!.payload_hash!,before=await fs.readFile(path.join(f.target,"metadata.sqlite")),row=await readHolderSnapshotReceipt(f.source,f.options,f.grant,hash);assert.equal(row?.payload_hash,hash);await assert.rejects(readHolderSnapshotReceipt(f.source,f.options,{...f.grant,epoch:2},hash));assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);f.copy.prepare("UPDATE tenx_holder_evidence SET observed_at=? WHERE payload_hash=?").run('2026-10-20T00:00:00.000Z',hash);await assert.rejects(readHolderSnapshotReceipt(f.source,f.options,f.grant,hash));
},"holder"));
test("durable wallet cohorts recover after original post-commit failure without rerunning source collection",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===walletCohortSql)throw Error("cohort_fault");return original.call(this,sql);});const actual=completed(await run(f));hook.mock.restore();assert.equal(actual.result.state,"failed");assert.equal(actual.producer?.state,"committed");assert.equal(actual.cohort_publication?.state,"held");assert.equal(actual.post_commit,"failed");
  const before=[rows(f.copy,"tenx_candidates"),rows(f.copy,"tenx_wallet_runs"),rows(f.copy,"tenx_wallet_transactions"),rows(f.copy,"tenx_usage"),rows(f.copy,"tenx_wallet_usage")];assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.cohortPublicationId!,mode:"publish"})).state,"committed");assert.deepEqual([rows(f.copy,"tenx_candidates"),rows(f.copy,"tenx_wallet_runs"),rows(f.copy,"tenx_wallet_transactions"),rows(f.copy,"tenx_usage"),rows(f.copy,"tenx_wallet_usage")],before);assert.equal(rows(f.copy,"tenx_wallet_runs")[0]!.state,"succeeded");
},"durable"));

function linkedSnapshot(f:Setup){return {...snapshot(f),cohortId:randomUUID()};}
const linkedRecover=(f:Setup,cohortId:string,mode:"publish"|"reconcile"="publish",grant=f.grant)=>recoverLinkedWalletSnapshotBatch(f.options,f.journal,grant,{cohortId,mode});
async function linkedStop(f:Setup,mode:"cohort_ready_stop"|"ready_stop"|"commit_stop"){
  await acquire(f);const batch=linkedSnapshot(f),file=path.join(f.root,"linked-snapshot.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch,id:batch.cohortId,plan_kind:"wallet_snapshot_cycle"}),{flag:"wx",mode:0o600});
  const before=state(f);await assert.rejects(exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:100000,timeout:30000}),e=>(e as {code:number}).code===(mode==="cohort_ready_stop"?77:mode==="ready_stop"?75:76));return {batch,file,before};
}
function linkedReady(f:Setup,id:string,work:()=>void){const open=fs.open;return mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(flags==="wx"&&String(name)===path.join(f.journal.directory,"pending",id,"ready.json")){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();work();};}return handle;});}

for(const mode of ["cohort_ready_stop","ready_stop","commit_stop"] as const)test(`linked snapshot ${mode} recovers its original pair in a fresh process without source arguments`,()=>setup(async f=>{
  const {batch,file,before}=await linkedStop(f,mode),child=validateEvidenceCohortPlan((await readEvidencePublicationIntent(f.options,f.journal,f.grant,batch.cohortId)).plan);assert.equal(child.parent.cohort_id,batch.cohortId);assert.ok(child.candidate_hash);if(mode!=="commit_stop")assert.deepEqual(state(f),before);else assert.equal(rows(f.copy,"tenx_wallet_cohorts").length,0);
  if(mode==="cohort_ready_stop")assert.equal(await readEvidencePublicationIntentIfPresent(f.options,f.journal,f.grant,batch.publicationId),null);
  const result=JSON.parse((await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,"linked_snapshot_publish"],{maxBuffer:100000,timeout:30000})).stdout);assert.equal(result.state,"completed");assert.equal(result.producer.state,"committed");assert.equal(result.cohort.state,"committed");assert.equal(result.provider_requests,0);assert.equal(result.source_authorized,false);assert.equal(rows(f.copy,"tenx_append_references").length,1);assert.equal(rows(f.copy,"tenx_wallet_cohorts").length,1);assert.equal(rows(f.copy,"tenx_wallet_profiles").length,JSON.parse(String(f.snapshotBatch[2]!.bindings[0])).wallets.length);
  const bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await linkedRecover(f,batch.cohortId,"reconcile")).state,"completed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

for(const change of ["expiry","candidate","lease","pause","backoff"] as const)test(`linked snapshot pending ${change} change holds without reviving the original job or refunding spend`,()=>setup(async f=>{
  const {batch}=await linkedStop(f,"ready_stop");if(change==="expiry")mock.timers.tick(360000);else f.copy.exec(change==="candidate"?"UPDATE tenx_candidates SET payload=json_set(payload,'$.symbol','changed')":change==="lease"?"UPDATE tenx_wallet_control SET lease_owner='replacement'":change==="pause"?"UPDATE tenx_control SET paused=1":"UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after='2026-10-22T00:00:00.000Z'");
  const before=state(f);assert.equal((await linkedRecover(f,batch.cohortId)).state,"held");assert.deepEqual(state(f),before);assert.equal(rows(f.copy,"tenx_append_references").length,0);assert.equal(rows(f.copy,"tenx_wallet_profiles").length,0);
}));

test("linked snapshot committed parent finishes its original cohorts after lease expiry and a later candidate update",()=>setup(async f=>{
  const {batch}=await linkedStop(f,"commit_stop"),candidate=rows(f.copy,"tenx_candidates");mock.timers.tick(360000);f.copy.exec("UPDATE tenx_candidates SET payload=json_set(payload,'$.symbol','later')");const before=[rows(f.copy,"tenx_wallet_runs"),rows(f.copy,"tenx_wallet_transactions"),rows(f.copy,"tenx_usage"),rows(f.copy,"tenx_wallet_usage"),rows(f.copy,"tenx_wallet_control")],result=await linkedRecover(f,batch.cohortId);assert.equal(result.state,"completed");if(result.producer?.state==="committed")assert.equal(result.producer.reconciled,true);else assert.fail("parent not confirmed");assert.deepEqual([rows(f.copy,"tenx_wallet_runs"),rows(f.copy,"tenx_wallet_transactions"),rows(f.copy,"tenx_usage"),rows(f.copy,"tenx_wallet_usage"),rows(f.copy,"tenx_wallet_control")],before);assert.notDeepEqual(rows(f.copy,"tenx_candidates"),candidate);assert.equal(rows(f.copy,"tenx_wallet_cohorts")[0]!.selected_at,at);
}));

test("linked snapshot committed history reconciles under a replacement owner with no writes",()=>setup(async f=>{
  await acquire(f);const batch=linkedSnapshot(f);assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch)).state,"committed");assert.equal((await linkedRecover(f,batch.cohortId)).state,"completed");const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await linkedRecover(f,batch.cohortId,"reconcile",next)).state,"completed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

test("linked snapshot pending former-owner work cannot materialize a missing parent",()=>setup(async f=>{
  const {batch}=await linkedStop(f,"cohort_ready_stop"),next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=state(f);assert.equal((await linkedRecover(f,batch.cohortId,"publish",next)).state,"held");assert.equal(await readEvidencePublicationIntentIfPresent(f.options,f.journal,next,batch.publicationId),null);assert.deepEqual(state(f),before);
}));

test("linked snapshot lost producer acknowledgement keeps parent history and can finish cohorts separately",()=>setup(async f=>{
  await acquire(f);const batch=linkedSnapshot(f),original=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){const stop=sql==="COMMIT"&&!lost&&!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(batch.publicationId),result=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return result;});assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch)).state,"held");hook.mock.restore();assert.equal(lost,true);const first=await linkedRecover(f,batch.cohortId,"reconcile");assert.equal(first.state,"held");assert.equal(first.producer?.state,"committed");assert.equal(first.failure?.phase,"reconcile");assert.equal(first.failure?.sql_attempt,"read_only");assert.equal((await linkedRecover(f,batch.cohortId)).state,"completed");assert.equal(rows(f.copy,"tenx_wallet_runs").length,1);
}));

test("linked snapshot missing companion blocks native and journal producer execution",()=>setup(async f=>{
  const {batch}=await linkedStop(f,"ready_stop"),parent=await readEvidencePublicationIntent(f.options,f.journal,f.grant,batch.publicationId);await fs.rename(path.join(f.journal.directory,"pending",batch.cohortId,"ready.json"),path.join(f.journal.directory,"pending",batch.cohortId,"ready.retained"));const before=state(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,mode:"publish"})).state,"held");await assert.rejects(publishEvidenceWalletSnapshot(f.options,f.grant,parent.plan));assert.deepEqual(state(f),before);
}));

test("linked snapshot partial parent readiness is never reconstructed from its valid child",()=>setup(async f=>{
  const {batch}=await linkedStop(f,"cohort_ready_stop"),folder=path.join(f.journal.directory,"pending",batch.publicationId);await fs.mkdir(folder);await fs.writeFile(path.join(folder,"intent.bin"),"retained-partial");const before=state(f);assert.equal((await linkedRecover(f,batch.cohortId)).state,"held");assert.equal(await fs.readFile(path.join(folder,"intent.bin"),"utf8"),"retained-partial");assert.deepEqual(state(f),before);
}));

test("linked snapshot partial child readiness holds before producer publication and cannot be resealed",()=>setup(async f=>{
  await acquire(f);const batch=linkedSnapshot(f),folder=path.join(f.journal.directory,"pending",batch.cohortId);await fs.mkdir(folder);await fs.writeFile(path.join(folder,"intent.bin"),"retained-partial");const before=state(f);assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch)).state,"held");assert.equal(await readEvidencePublicationIntentIfPresent(f.options,f.journal,f.grant,batch.publicationId),null);assert.equal(await fs.readFile(path.join(folder,"intent.bin"),"utf8"),"retained-partial");assert.deepEqual(state(f),before);
}));

test("linked snapshot first-row replacement after readiness holds before producer SQL",()=>setup(async f=>{
  await acquire(f);const batch=linkedSnapshot(f),hook=linkedReady(f,batch.publicationId,()=>f.copy.exec("UPDATE tenx_cohorts SET input_hash='changed'"));assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch)).state,"held");hook.mock.restore();assert.equal(rows(f.copy,"tenx_append_references").length,0);assert.equal(rows(f.copy,"tenx_wallet_runs").length,0);assert.equal(rows(f.copy,"tenx_cohorts")[0]!.input_hash,"changed");
}));

test("linked snapshot late SQL failure rolls back receipt, candidate, profiles and completion while preserving readiness",()=>setup(async f=>{
  await acquire(f);const batch=linkedSnapshot(f),before=state(f),original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql.startsWith("INSERT INTO tenx_wallet_profiles("))throw Error("profile_fault");return original.call(this,sql);});assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch)).state,"held");hook.mock.restore();assert.deepEqual(state(f),before);assert.ok(await readEvidencePublicationIntent(f.options,f.journal,f.grant,batch.cohortId));assert.equal((await linkedRecover(f,batch.cohortId)).state,"completed");
}));

test("linked snapshot strict identity and receipt requirements reject links on control or failed batches",()=>setup(async f=>{
  await acquire(f);const b=linkedSnapshot(f),before=state(f);for(const id of [b.publicationId,b.stageId!,b.cycle.lease_id,b.cycle.job])assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,{...b,cohortId:id})).state,"held");assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,{...catchup(f),cohortId:randomUUID()})).state,"held");const failed=structuredClone(f.snapshotBatch[0]!);failed.bindings[4]="failed";failed.bindings[8]=0;failed.bindings[9]=0;failed.bindings[10]="fixture_failed";assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,{...catchup(f),cohortId:randomUUID(),statements:[failed]})).state,"held");assert.deepEqual(state(f),before);
}));

test("linked snapshot recovery rejects the candidate-only entry point without writing or materializing a parent",()=>setup(async f=>{
  const {batch}=await linkedStop(f,"cohort_ready_stop"),before=state(f);assert.equal((await recoverLinkedCandidateBatch(f.options,f.journal,f.grant,{cohortId:batch.cohortId,mode:"publish"})).state,"held");assert.equal(await readEvidencePublicationIntentIfPresent(f.options,f.journal,f.grant,batch.publicationId),null);assert.deepEqual(state(f),before);
}));

test("linked snapshot read-only recovery never executes a pending original parent",()=>setup(async f=>{
  const {batch}=await linkedStop(f,"ready_stop"),before=await fs.readFile(path.join(f.target,"metadata.sqlite")),result=await linkedRecover(f,batch.cohortId,"reconcile");assert.equal(result.state,"held");assert.equal(result.producer,undefined);assert.equal(result.failure?.phase,"reconcile");assert.equal(result.failure?.sql_attempt,"read_only");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

test("linked snapshot same-identity retry returns original results without repeating producer or cohort writes",()=>setup(async f=>{
  await acquire(f);const batch=linkedSnapshot(f);assert.equal((await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch)).state,"committed");assert.equal((await linkedRecover(f,batch.cohortId)).state,"completed");const before=await fs.readFile(path.join(f.target,"metadata.sqlite")),again=await publishEvidenceWalletSnapshotBatch(f.options,f.journal,f.grant,batch);assert.equal(again.state,"committed");if(again.state==="committed")assert.equal(again.reconciled,true);assert.equal((await linkedRecover(f,batch.cohortId)).state,"completed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));
