import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {fixture,receipt,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {recordEvidenceProducerBatches} from "./lib/evidence-producer-batches";
import {publishEvidenceAppend,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {publicationEvidenceReadStore} from "./lib/evidence-publication-read-store";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {d1EvidenceWriteStore} from "../discovery/src/evidence-write-store";
import {saveCandidate,captureCohort} from "../discovery/src/store";
import {runWalletCycle} from "../discovery/src/wallet-cycle";
import {replayLegacyWallets} from "../discovery/src/wallet-work";
import {holderHistoryFixture} from "../discovery/src/holder-history-fixtures.test-helper";
import {walletInput,trade,key,signature} from "../discovery/src/wallet-fixtures.test-helper";
import {fixtureCandidates,syntheticBundle} from "../discovery/src/fixtures";
import {analyzeHolders,HolderEvidenceSchema,type HolderEvidence} from "../discovery/src/holders";
import {analyzeWalletEvidence,WalletEvidenceSchema} from "../discovery/src/wallet-analysis";
import {MAINNET_GENESIS,type Transaction,type Accounts} from "../discovery/src/rpc";
import {CandidateSchema,type Candidate} from "../discovery/src/model";

type Producer="candidate"|"wallet"|"cached_replay";
const cohortTables=["tenx_cohorts","tenx_wallet_cohorts","tenx_selections"];
const metadata=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const snapshot=(db:DatabaseSync,tables:string[])=>tables.map(table=>[table,metadata(db,table)]);
function affected(statements:{sql:string}[]){return [...new Set(statements.map(s=>s.sql.match(/^(?:INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM) (\w+)/i)![1]!))];}
function compare(db:DatabaseSync,expected:DatabaseSync,tables:string[]){
  for(const table of tables){const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name));
    assert.deepEqual(db.prepare(`SELECT ${columns.join(",")} FROM ${table} ORDER BY rowid`).all(),expected.prepare(`SELECT ${columns.join(",")} FROM ${table} ORDER BY rowid`).all(),table);}
}
// Test-only prerequisites: reproduce the original producer's already-spent
// allowances/claimed lease and affected rows in its synthetic private clone.
// This is NOT a runtime SQL path, adoption tool, quota refund or real observation.
function prerequisites(f:PublicationFixture,tables:string[]){
  const selected=[...new Set([...tables.filter(t=>!t.endsWith("_evidence")),"tenx_usage","tenx_wallet_usage"])];
  for(const table of selected){
    const columns=f.copy.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name));
    const rows=f.db.prepare(`SELECT ${columns.join(",")} FROM ${table}`).all();f.copy.prepare(`DELETE FROM ${table}`).run();
    const insert=f.copy.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`);for(const row of rows)insert.run(...columns.map(c=>row[c]!));
  }
}
async function inputs(kind:Producer){
  const input=WalletEvidenceSchema.parse(await walletInput()),at=new Date(input.observed_at);
  let candidate:Candidate={...(await fixtureCandidates(at))[0]!,mode:"live",creation:input.asset.creation,graduation:null,holders:null,wallet_analysis:kind==="cached_replay"?await analyzeWalletEvidence(input):null};
  let holder:HolderEvidence|undefined;
  let transactions:Transaction[]=[],state:Accounts|undefined;
  if(kind==="candidate"){
    const history=await holderHistoryFixture(),raw=history.samples[0]!.evidence;
    function assertHolder(value:unknown):asserts value is HolderEvidence{HolderEvidenceSchema.parse(value);}assertHolder(raw);holder=raw;
    candidate={...(await fixtureCandidates(new Date(history.cutoff_at)))[0]!,mode:"live",address:raw.mint,pool:raw.pool,holders:await analyzeHolders(raw,history.index[0]!.observed_at)};
    const bundle=await syntheticBundle(new Date(history.cutoff_at));transactions=[bundle.creation,bundle.graduation];state=bundle.accounts;
  }
  return {candidate,holder,input,transactions,state};
}
async function producerFixture(kind:Producer,work:(f:PublicationFixture,values:Awaited<ReturnType<typeof inputs>>)=>Promise<void>){
  const values=await inputs(kind);
  await fixture(f=>work(f,values),async({db})=>{
    db.exec("DELETE FROM tenx_candidates; DELETE FROM tenx_wallet_work");
    if(kind!=="candidate")await saveCandidate(sqliteD1(db),values.candidate);
    if(kind==="cached_replay")db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(values.candidate.wallet_analysis!.evidence_hash,values.candidate.address,JSON.stringify(values.input),values.input.observed_at);
  });
}
async function run(kind:Producer,db:D1Database,values:Awaited<ReturnType<typeof inputs>>){
  if(kind==="candidate"){await saveCandidate(db,values.candidate,values.transactions,values.state,values.holder);return;}
  if(kind==="cached_replay"){const result=await replayLegacyWallets(db);assert.equal((result.errors as unknown[]).length,0);assert.equal((result.upgraded as unknown[]).length,1);return;}
  const buy=await trade(key(11),10002,"buy",70),transport:typeof fetch=async(_url,init)=>{
    const request=JSON.parse(String(init?.body));let result:unknown;
    if(request.method==="getGenesisHash")result=MAINNET_GENESIS;
    else if(request.method==="getTransaction")result=request.params[0]===values.candidate.creation!.signature?values.input.records[0]!.transaction:buy;
    else if(request.method==="getSignaturesForAddress")result=request.params[0]===values.candidate.pool?[{signature:signature(70),slot:buy.slot,blockTime:buy.blockTime,err:null,confirmationStatus:"finalized"}]:[];
    else throw Error("synthetic_transport_method_unexpected");
    return Response.json({jsonrpc:"2.0",id:request.id,result});
  };
  const result=await runWalletCycle({db,rpcUrl:"https://offline.invalid",rpcDailyLimit:5000,walletDailyLimit:800,marketDailyLimit:600,walletEnabled:true,marketEnabled:false,transport},values.candidate.address,new Date(values.input.observed_at));
  assert.equal(result.state,"succeeded",JSON.stringify(result));assert.ok(Number(result.rpc_calls)>0);
}

for(const kind of ["candidate","wallet","cached_replay"] as const)test(`${kind}: actual producer batch matches encrypted publication SQL, result positions and receipt bytes`,context=>producerFixture(kind,async(f,values)=>{
  let tables:string[]=[],beforeCohorts:unknown,afterBatch:unknown;
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db),{before:async statements=>{tables=affected([...statements]);prerequisites(f,tables);beforeCohorts=snapshot(f.copy,cohortTables);},after:async()=>{afterBatch=snapshot(f.db,tables.filter(t=>!t.endsWith("_evidence")));}});
  await run(kind,recorder.db,values);const batches=recorder.recorded();assert.equal(batches.length,1);const batch=batches[0]!;
  const publicationId=randomUUID(),stageId=randomUUID(),plan=await recorder.prepare(f.stage,{publicationId,stageId,statements:batch.statements});
  assert.equal(plan.operations.length,batch.statements.length);assert.equal(plan.operations.findIndex(o=>o.kind==="receipt"),kind==="cached_replay"?0:kind==="wallet"?1:values.candidate.market?2:1);
  for(let i=0;i<plan.operations.length;i++){const op=plan.operations[i]!;if(op.kind==="sql")assert.deepEqual({sql:op.sql,bindings:op.bindings},batch.statements[i]);}
  const published=await publishEvidenceAppend(f.options,f.grant,plan);assert.deepEqual(published.results.map(r=>r.meta.changes),batch.changes);
  assert.deepEqual(snapshot(f.copy,tables.filter(t=>!t.endsWith("_evidence"))),afterBatch);compare(f.copy,f.db,tables);
  assert.deepEqual(snapshot(f.copy,cohortTables),beforeCohorts);
  const stable=snapshot(f.copy,tables),retry=await recorder.prepare(f.stage,{publicationId,stageId,statements:batch.statements});assert.deepEqual(retry,plan);
  const retried=await publishEvidenceAppend(f.options,f.grant,retry,kind==="cached_replay"?undefined:async()=>{
    const saved=f.copy.prepare("SELECT payload FROM tenx_candidates WHERE address=? AND mode='live'").get(values.candidate.address)!;
    const current=CandidateSchema.parse(JSON.parse(String(saved.payload)));await captureCohort(sqliteD1(f.copy),current,current.checked_at);
  });
  assert.equal(retried.reconciled,true);assert.deepEqual(snapshot(f.copy,tables),stable);compare(f.copy,f.db,cohortTables);
  await withScratchEvidenceResolver(f.source,async source=>{
    const store=publicationEvidenceReadStore(source,f.options,f.grant),table=kind==="candidate"?"holder":"wallet",row=f.db.prepare(`SELECT * FROM tenx_${table}_evidence WHERE address=? ORDER BY observed_at DESC LIMIT 1`).get(values.candidate.address)!;
    assert.deepEqual(await store[`${table}Receipt`](String(row.payload_hash)),{...row});return null;
  });
  context.diagnostic(JSON.stringify({producer:kind,operations:plan.operations.length,receipt_position:plan.operations.findIndex(op=>op.kind==="receipt"),original_changes:batch.changes,all_affected_rows_identical:true,cohort_rows_identical_after_explicit_callback:true,exact_retry_reconciled:true,provider_requests:0,runtime_activated:false}));
}));

for(const kind of ["candidate","wallet","cached_replay"] as const)test(`${kind}: late publication fault rolls back original batch effects and retains spent allowances`,()=>producerFixture(kind,async(f,values)=>{
  let tables:string[]=[];
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db),{before:async statements=>{tables=affected([...statements]);prerequisites(f,tables);}});await run(kind,recorder.db,values);
  const plan=await recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:recorder.recorded()[0]!.statements});
  plan.operations.push({kind:"sql",sql:"INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) VALUES('offline','offline','offline',NULL,'offline')",bindings:[]});
  const checked=[...new Set([...tables,"tenx_append_references","tenx_append_publications","tenx_usage","tenx_wallet_usage",...cohortTables])],before=snapshot(f.copy,checked);
  await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/NOT NULL/);assert.deepEqual(snapshot(f.copy,checked),before);
  assert.ok(Number(f.copy.prepare("SELECT sum(used) AS n FROM tenx_usage").get()!.n)>=3);
}));

test("foreign statements, missing/multiple receipts, modified SQL, invalid identifiers and forbidden writes hold before staging",()=>fixture(async f=>{
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db)),writer=d1EvidenceWriteStore(recorder.db),item=receipt(),stageFiles=await fs.readdir(path.join(f.stage.directory,"pending"));
  await assert.rejects(recorder.db.batch([sqliteD1(f.db).prepare("SELECT 1")]),/foreign_statement/);
  await recorder.db.batch([writer.holder({...item.row,slot:item.row.slot!})]);const statement=recorder.recorded()[0]!.statements[0]!;
  for(const changed of [[],[{sql:"SELECT 1",bindings:[]}],[{...statement,sql:statement.sql+" "}],[statement,statement],[statement,{sql:"UPDATE tenx_usage SET used=0",bindings:[]}],[statement,{sql:"UPDATE tenx_candidates SET checked_at='x'; DELETE FROM tenx_candidates",bindings:[]}]]){
    await assert.rejects(recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:changed}));
  }
  await assert.rejects(recorder.prepare(f.stage,{publicationId:"invalid",stageId:randomUUID(),statements:[statement]}));
  await assert.rejects(recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:[{...statement,bindings:statement.bindings.slice(1)}]}),/binding_layout/);
  for(const extra of [{sql:"UPDATE tenx_candidates SET payload=?",bindings:["x".repeat(2000001)]},{sql:"UPDATE tenx_candidates SET payload=?",bindings:[NaN]},{sql:"UPDATE tenx_candidates SET payload=?",bindings:Array(101).fill(null)}])await assert.rejects(recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:[statement,extra]}));
  await assert.rejects(recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:Array(129).fill(statement)}));
  assert.deepEqual(await fs.readdir(path.join(f.stage.directory,"pending")),stageFiles);
}));
test("immutable rebound statements and defensive recordings preserve the actual original binding values",()=>fixture(async f=>{
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db)),writer=d1EvidenceWriteStore(recorder.db),item=receipt(),statement=writer.holder({...item.row,slot:item.row.slot!});
  statement.bind("unexecuted");await recorder.db.batch([statement]);const first=recorder.recorded();first[0]!.statements[0]!.bindings[0]="mutated";
  const plan=await recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:recorder.recorded()[0]!.statements});assert.equal((await publishEvidenceAppend(f.options,f.grant,plan)).results[0]!.meta.changes,1);
  assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_holder_evidence WHERE payload_hash=?").get(item.row.payload_hash)!.n,1);
}));
test("stale ownership after staging blocks the whole producer batch while keeping the staged object unadmitted",()=>producerFixture("candidate",async(f,values)=>{
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db));await run("candidate",recorder.db,values);
  const plan=await recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:recorder.recorded()[0]!.statements});await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());
  const before=snapshot(f.copy,["tenx_candidates","tenx_append_references","tenx_append_publications"]);
  await assert.rejects(publishEvidenceAppend(f.options,f.grant,plan),/owner_fenced/);assert.deepEqual(snapshot(f.copy,["tenx_candidates","tenx_append_references","tenx_append_publications"]),before);
  assert.equal((await fs.readdir(path.join(f.stage.directory,"pending"))).length,1);
}));
test("cached replay preserves zero-row compare-and-swap results instead of changing them into a SQL failure or successful upgrade",()=>producerFixture("cached_replay",async(f,values)=>{
  let tables:string[]=[];
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db),{before:async statements=>{
    f.db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash',?) WHERE address=?").run("0".repeat(64),values.candidate.address);
    tables=affected([...statements]);prerequisites(f,tables);
  }});
  const result=await replayLegacyWallets(recorder.db);assert.deepEqual(result.upgraded,[]);assert.deepEqual(result.errors,[{address:values.candidate.address,code:"wallet_snapshot_changed_during_replay"}]);
  const recorded=recorder.recorded()[0]!,plan=await recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:recorded.statements}),published=await publishEvidenceAppend(f.options,f.grant,plan);
  assert.equal(recorded.changes[1],0);assert.deepEqual(published.results.map(row=>row.meta.changes),recorded.changes);compare(f.copy,f.db,tables);
}));
test("actual cohort failure is reported after a committed producer batch and its retry does not reapply producer SQL",()=>producerFixture("candidate",async(f,values)=>{
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db));await run("candidate",recorder.db,values);
  const plan=await recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:recorder.recorded()[0]!.statements});
  const failedDb=new Proxy(sqliteD1(f.copy),{get(target,key){if(key==="batch")return async()=>{throw Error("synthetic_cohort_failure");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const cohort=async(db:D1Database)=>{const saved=f.copy.prepare("SELECT payload FROM tenx_candidates WHERE address=? AND mode='live'").get(values.candidate.address)!,current=CandidateSchema.parse(JSON.parse(String(saved.payload)));await captureCohort(db,current,current.checked_at);};
  const result=await publishEvidenceAppend(f.options,f.grant,plan,()=>cohort(failedDb));
  assert.equal(result.state,"committed");assert.equal(result.post_commit,"failed");assert.equal(f.copy.prepare("SELECT count(*) AS n FROM tenx_append_references").get()!.n,1);
  const before=snapshot(f.copy,["tenx_candidates","tenx_append_references","tenx_append_publications","tenx_usage","tenx_wallet_usage"]);
  const retry=await publishEvidenceAppend(f.options,f.grant,plan,()=>cohort(sqliteD1(f.copy)));
  assert.equal(retry.reconciled,true);assert.equal(retry.post_commit,"completed");assert.deepEqual(snapshot(f.copy,["tenx_candidates","tenx_append_references","tenx_append_publications","tenx_usage","tenx_wallet_usage"]),before);compare(f.copy,f.db,cohortTables);
}));
test("original SQL failures retain rollback and spent usage without recording a successful publication",()=>fixture(async f=>{
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db)),item=receipt(),writer=d1EvidenceWriteStore(recorder.db),before=snapshot(f.db,["tenx_candidates","tenx_holder_evidence","tenx_usage","tenx_wallet_usage"]);
  await assert.rejects(recorder.db.batch([recorder.db.prepare("UPDATE tenx_candidates SET checked_at='changed'"),writer.holder({...item.row,slot:item.row.slot!}),recorder.db.prepare("INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) VALUES('offline','offline','offline',NULL,'offline')")]),/NOT NULL/);
  assert.deepEqual(recorder.recorded(),[]);assert.deepEqual(snapshot(f.db,["tenx_candidates","tenx_holder_evidence","tenx_usage","tenx_wallet_usage"]),before);assert.deepEqual(await fs.readdir(path.join(f.stage.directory,"pending")),[]);
}));
test("recording count limit holds before an additional original SQL execution and never changes provider limits",()=>fixture(async f=>{
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db)),item=receipt(),writer=d1EvidenceWriteStore(recorder.db);
  for(let n=0;n<16;n++)await recorder.db.batch([writer.holder({...item.row,slot:item.row.slot!})]);
  const before=snapshot(f.db,["tenx_holder_evidence","tenx_usage","tenx_wallet_usage"]);await assert.rejects(recorder.db.batch([writer.holder({...item.row,slot:item.row.slot!})]),/recording_bound/);
  assert.equal(recorder.recorded().length,16);assert.deepEqual(snapshot(f.db,["tenx_holder_evidence","tenx_usage","tenx_wallet_usage"]),before);
}));
test("in-flight recordings reserve capacity before asynchronous hooks and release only failed recording reservations",()=>fixture(async f=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db),{before:async()=>{await gate;throw Error("synthetic_observer_hold");}}),item=receipt(),writer=d1EvidenceWriteStore(recorder.db);
  const pending=Array.from({length:16},()=>recorder.db.batch([writer.holder({...item.row,slot:item.row.slot!})]));
  await assert.rejects(recorder.db.batch([writer.holder({...item.row,slot:item.row.slot!})]),/recording_bound/);
  release();const settled=await Promise.allSettled(pending);assert.ok(settled.every(result=>result.status==="rejected"));
  await assert.rejects(recorder.db.batch([writer.holder({...item.row,slot:item.row.slot!})]),/observer_hold/);assert.deepEqual(recorder.recorded(),[]);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM tenx_holder_evidence WHERE payload_hash=?").get(item.row.payload_hash)!.n,0);
}));
test("repeated actual candidate saves preserve first holder receipt time and the original encrypted reference",()=>producerFixture("candidate",async(f,values)=>{
  const recorder=recordEvidenceProducerBatches(sqliteD1(f.db),{
    before:async statements=>prerequisites(f,affected([...statements])),
    after:async batch=>{const plan=await recorder.prepare(f.stage,{publicationId:randomUUID(),stageId:randomUUID(),statements:batch.statements}),published=await publishEvidenceAppend(f.options,f.grant,plan);assert.deepEqual(published.results.map(row=>row.meta.changes),batch.changes);},
  });
  await run("candidate",recorder.db,values);
  const before=f.copy.prepare("SELECT * FROM tenx_append_references").all(),receiptBefore=f.db.prepare("SELECT * FROM tenx_holder_evidence WHERE payload_hash=?").get(values.candidate.holders!.payload_hash);
  const later="2026-10-21T09:06:00.000Z";await run("candidate",recorder.db,{...values,candidate:{...values.candidate,checked_at:later,holders:{...values.candidate.holders!,observed_at:later}}});
  assert.equal(recorder.recorded().length,2);assert.equal(recorder.recorded()[1]!.changes[2],0);assert.deepEqual(f.copy.prepare("SELECT * FROM tenx_append_references").all(),before);
  assert.deepEqual(f.db.prepare("SELECT * FROM tenx_holder_evidence WHERE payload_hash=?").get(values.candidate.holders!.payload_hash),receiptBefore);
  await withScratchEvidenceResolver(f.source,async source=>{assert.deepEqual(await publicationEvidenceReadStore(source,f.options,f.grant).holderReceipt(values.candidate.holders!.payload_hash!),{...receiptBefore});return null;});
}));
