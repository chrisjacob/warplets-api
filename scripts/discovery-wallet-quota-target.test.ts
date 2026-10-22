import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fixture,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal,readEvidencePublicationIntent} from "./discovery-evidence-intents.mjs";
import {validateEvidenceWalletQuotaPlan,validateEvidencePublicationPlan,validateEvidenceWalletCachedPlan,validateEvidenceCandidateMetadataPlan,publishEvidenceWalletQuota,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {walletQuotaSql,rpcQuotaSql} from "./evidence-wallet-quota-sql.mjs";
import {reserveWalletQuotaOnEvidenceTarget,type WalletQuotaTargetInput} from "./lib/evidence-wallet-quota-target";
import {publishEvidenceWalletQuotaBatch,publishEvidenceCandidateMetadataBatch,recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";
import {reserveWalletQuota,type WalletSettings} from "../discovery/src/wallet-cycle";
import {SourceError} from "../discovery/src/rpc";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";

const exec=promisify(execFile),at="2026-10-22T23:57:00.000Z",day=at.slice(0,10);
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:WalletQuotaTargetInput};
async function setup(work:(f:Setup)=>Promise<void>,wallet=0,rpc=0,previous=false){
  const directory=path.resolve(".tmp","wallet-quota-test-"+randomUUID());
  try{await fixture(async f=>{const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,journal:{directory,contextPin:created.context_pin},input:{now:at,walletDailyLimit:4,rpcDailyLimit:6,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()}});},async({db})=>{
    const date=previous?"2026-10-21":day;if(wallet)db.prepare("INSERT INTO tenx_wallet_usage VALUES(?,?)").run(date,wallet);if(rpc)db.prepare("INSERT INTO tenx_usage VALUES('rpc',?,?)").run(date,rpc);
  });}finally{try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-quota-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const run=(f:Setup,input=f.input)=>reserveWalletQuotaOnEvidenceTarget(f.options,f.journal,f.grant,input);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const stable=(f:Setup)=>["tenx_usage","tenx_wallet_usage","tenx_append_publications","tenx_control","tenx_wallet_control","tenx_wallet_runs","tenx_wallet_attempts"].map(t=>rows(f.copy,t));
const expected=(f:Setup)=>f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(r=>String(r.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});
function batch(f:Setup,kind:"wallet"|"rpc"){const r={wallet:f.input.walletPublicationId,rpc:f.input.rpcPublicationId,day,wallet_limit:f.input.walletDailyLimit,rpc_limit:f.input.rpcDailyLimit};return {publicationId:r[kind],reservation:r,statements:[{sql:kind==="wallet"?walletQuotaSql:rpcQuotaSql,bindings:kind==="wallet"?[day,r.wallet_limit]:["rpc",day,r.rpc_limit]}]};}
async function original(f:Setup){try{await reserveWalletQuota(sqliteD1(f.db),{walletDailyLimit:f.input.walletDailyLimit,rpcDailyLimit:f.input.rpcDailyLimit,marketDailyLimit:0} as WalletSettings,new Date(f.input.now))();return {state:"reserved"};}catch(error){if(!(error instanceof SourceError))throw error;return {state:"rejected",code:error.code,retry_after_seconds:error.retryAfterSeconds};}}

for(const [name,wallet,rpc,previous] of [["empty day",0,0,false],["last available unit",3,5,false],["wallet exhausted",4,0,false],["RPC exhausted",0,6,false],["both exhausted",4,6,false],["new day retains yesterday",4,6,true]] as const)test(`${name}: original reservation matches every metadata table and never calls a provider`,t=>setup(async f=>{
  const oracle=await original(f),values=expected(f);mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});const result=await run(f);assert.equal(result.state,oracle.state);if(result.state==="rejected"){assert.equal(result.code,oracle.code);assert.equal(result.retry_after_seconds,oracle.retry_after_seconds);}
  for(const value of values)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));assert.equal(result.source_authorized,false);assert.equal(result.provider_requests,0);assert.equal(result.runtime_activated,false);
  if(name==="RPC exhausted"){assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(day)!.used,1);assert.equal(result.publications.length,2);}if(name==="wallet exhausted"||name==="both exhausted")assert.equal(result.publications.length,1);
  t.diagnostic(JSON.stringify({original_tables:values.length,case:name,state:result.state,oracle_forwarding:false,prerequisite_copy:false,provider_requests:0,source_authorized:false}));
},wallet,rpc,previous));

test("exact paired retry and known-ID read-only recovery retain original RETURNING rows without a second charge",()=>setup(async f=>{
  const first=await run(f);assert.equal(first.state,"reserved");assert.deepEqual(first.publications.map(p=>p.state==="committed"?p.results[0]!.results:p.state),[[{used:1}],[{used:1}]]);const before=stable(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));const retry=await run(f);assert.equal(retry.state,"reserved");for(const p of retry.publications){assert.equal(p.state,"committed");if(p.state==="committed")assert.equal(p.reconciled,true);}for(const publicationId of [f.input.walletPublicationId,f.input.rpcPublicationId])assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId,mode:"reconcile"})).state,"committed");assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
  assert.equal((await run(f,{...f.input,rpcPublicationId:randomUUID()})).state,"held");assert.deepEqual(stable(f),before);
}));

test("separate new reservation identities consume the original remaining budget and then retain a declined zero-row result",()=>setup(async f=>{
  for(let n=0;n<5;n++){const result=await run(f,{...f.input,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()});assert.equal(result.state,n<4?"reserved":"rejected");if(n===4){assert.equal(result.publications.length,1);const p=result.publications[0]!;assert.equal(p.state,"committed");if(p.state==="committed")assert.deepEqual(p.results,[{success:true,results:[],meta:{changes:0}}]);}}assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(day)!.used,4);assert.equal(f.copy.prepare("SELECT used FROM tenx_usage WHERE provider='rpc' AND day=?").get(day)!.used,4);
}));

test("RPC publication requires the exact successful wallet parent and cannot charge out of order or after a decline",()=>setup(async f=>{
  const before=stable(f);assert.equal((await publishEvidenceWalletQuotaBatch(f.options,f.journal,f.grant,batch(f,"rpc"))).state,"held");assert.deepEqual(stable(f),before);assert.equal((await run(f)).state,"reserved");
  const other={...f.input,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID(),walletDailyLimit:1};f.copy.prepare("UPDATE tenx_wallet_usage SET used=1 WHERE day=?").run(day);const changed={...f,input:other},wallet=await publishEvidenceWalletQuotaBatch(f.options,f.journal,f.grant,batch(changed,"wallet"));assert.equal(wallet.state,"committed");const counters=rows(f.copy,"tenx_usage");assert.equal((await publishEvidenceWalletQuotaBatch(f.options,f.journal,f.grant,batch(changed,"rpc"))).state,"held");assert.deepEqual(rows(f.copy,"tenx_usage"),counters);
}));

test("late shared-reservation SQL failure retains the spent wallet unit and durable RPC intent for explicit recovery",()=>setup(async f=>{
  const prepare=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===rpcQuotaSql)throw Error("rpc_counter_fault");return prepare.call(this,sql);});const result=await run(f);assert.equal(result.state,"held");assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(day)!.used,1);assert.equal(f.copy.prepare("SELECT used FROM tenx_usage WHERE provider='rpc' AND day=?").get(day),undefined);hook.mock.restore();const recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.rpcPublicationId,mode:"publish"});assert.equal(recovered.state,"committed");const before=stable(f);assert.equal((await run(f)).state,"reserved");assert.deepEqual(stable(f),before);
}));

for(const role of ["wallet","rpc"] as const)test(`lost ${role} acknowledgement holds before any provider work and recovers without a duplicate charge`,()=>setup(async f=>{
  const id=role==="wallet"?f.input.walletPublicationId:f.input.rpcPublicationId,exec=DatabaseSync.prototype.exec;let stopped=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!stopped)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const value=exec.call(this,sql);if(stop){stopped=true;throw Error("lost_ack");}return value;});const result=await run(f);assert.equal(stopped,true);assert.equal(result.state,"held");assert.equal(result.source_authorized,false);assert.equal(result.publications.length,role==="wallet"?1:2);hook.mock.restore();const before=stable(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:id,mode:"reconcile"})).state,"committed");assert.deepEqual(stable(f),before);assert.equal((await run(f)).state,"reserved");assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(day)!.used,1);assert.equal(f.copy.prepare("SELECT used FROM tenx_usage WHERE provider='rpc' AND day=?").get(day)!.used,1);
}));

test("readiness failure creates no counter mutation and never falls through to the second reservation",()=>setup(async f=>{
  const open=fs.open;mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(flags==="wx"&&String(name).endsWith("ready.json"))handle.sync=async()=>{throw Error("readiness_fault");};return handle;});const before=stable(f),result=await run(f);assert.equal(result.state,"held");assert.equal(result.publications.length,1);assert.deepEqual(stable(f),before);
}));

test("owner transfer between reservations cannot execute a pending old-owner RPC intent or return a new source permit",()=>setup(async f=>{
  const open=fs.open;let next:typeof f.grant|undefined;mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(!next&&flags==="wx"&&String(name)===path.join(f.journal.directory,"pending",f.input.rpcPublicationId,"ready.json")){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant;};}return handle;});const result=await run(f);assert.equal(result.state,"held");assert.ok(next);const before=stable(f);for(const mode of ["publish","reconcile"] as const)assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next!,{publicationId:f.input.rpcPublicationId,mode})).state,"held");assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next!,{publicationId:f.input.walletPublicationId,mode:"reconcile"})).state,"committed");assert.deepEqual(stable(f),before);
  const native=validateEvidenceWalletQuotaPlan({publication_id:f.input.rpcPublicationId,kind:"wallet_quota",reservation:batch(f,"rpc").reservation,operations:batch(f,"rpc").statements.map(row=>({kind:"sql",...row}))});await assert.rejects(publishEvidenceWalletQuota(f.options,next!,native),/parent_required/);assert.deepEqual(stable(f),before);
}));

test("strict quota domain binds pair/day/limits and cannot admit arbitrary RETURNING, quota resets, providers or mixed plans",()=>setup(async f=>{
  const b=batch(f,"wallet"),plan={publication_id:b.publicationId,kind:"wallet_quota",reservation:b.reservation,operations:b.statements.map(row=>({kind:"sql",...row}))};assert.doesNotThrow(()=>validateEvidenceWalletQuotaPlan(plan));assert.throws(()=>validateEvidencePublicationPlan(plan));assert.throws(()=>validateEvidenceWalletCachedPlan(plan));assert.throws(()=>validateEvidenceCandidateMetadataPlan(plan));
  const mutate=(change:(p:any)=>void)=>{const invalid=structuredClone(plan);change(invalid);assert.throws(()=>validateEvidenceWalletQuotaPlan(invalid));};mutate(p=>{p.stage_id=randomUUID();});mutate(p=>{p.operations.push(p.operations[0]);});mutate(p=>{p.operations[0]={kind:"receipt"};});mutate(p=>{p.operations[0].sql="UPDATE tenx_usage SET used=0 RETURNING used";});mutate(p=>{p.operations[0].sql+="; DELETE FROM tenx_usage";});mutate(p=>{p.operations[0].sql=walletQuotaSql.replace("used+1","used+100");});mutate(p=>{p.operations[0].expect_changes=1;});mutate(p=>{p.operations[0].bindings[1]++;});mutate(p=>{p.reservation.rpc=p.reservation.wallet;});mutate(p=>{p.publication_id=randomUUID();});mutate(p=>{p.reservation.day="2026-02-30";p.operations[0].bindings[0]=p.reservation.day;});for(const limit of [0,-1,0.5,Number.MAX_SAFE_INTEGER+1])mutate(p=>{p.reservation.wallet_limit=limit;p.operations[0].bindings[1]=limit;});
  const rpc=batch(f,"rpc");assert.throws(()=>validateEvidenceWalletQuotaPlan({publication_id:rpc.publicationId,kind:"wallet_quota",reservation:rpc.reservation,operations:[{kind:"sql",sql:rpcQuotaSql,bindings:["market",day,6]}]}));
}));

for(const corrupt of ["value","count","extra"])test(`corrupt ${corrupt} committed RETURNING rows hold on read-only reconciliation`,()=>setup(async f=>{
  assert.equal((await run(f)).state,"reserved");const row=corrupt==="value"?{used:999}:corrupt==="extra"?{used:1,secret:"forged"}:{used:1},results=[{success:true,results:corrupt==="count"?[]:[row],meta:{changes:1}}];f.copy.prepare("UPDATE tenx_append_publications SET results_json=? WHERE publication_id=?").run(JSON.stringify(results),f.input.walletPublicationId);const before=stable(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.walletPublicationId,mode:"reconcile"})).state,"held");assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("invalid inputs, stale grants and mutable caller objects cannot substitute counters, identities or authority",()=>setup(async f=>{
  const before=stable(f);for(const input of [{...f.input,rpcPublicationId:f.input.walletPublicationId},{...f.input,walletDailyLimit:0},{...f.input,now:"invalid"}])assert.equal((await run(f,input)).state,"held");for(const grant of [{...f.grant,epoch:f.grant.epoch+1},{...f.grant,owner:randomUUID()},{...f.grant,generation:randomUUID()}])assert.equal((await reserveWalletQuotaOnEvidenceTarget(f.options,f.journal,grant,f.input)).state,"held");assert.equal((await reserveWalletQuotaOnEvidenceTarget({...f.options,targetPin:"0".repeat(64)},f.journal,f.grant,f.input)).state,"held");assert.deepEqual(stable(f),before);
  const input={...f.input},options=structuredClone(f.options),grant={...f.grant},pending=reserveWalletQuotaOnEvidenceTarget(options,f.journal,grant,input);input.walletDailyLimit=999;input.rpcPublicationId=randomUUID();grant.epoch++;options.targetPin="0".repeat(64);assert.equal((await pending).state,"reserved");
}));

for(const mode of ["ready_stop","commit_stop"])test(`fresh-process ${mode} preserves quota intent, exact RETURNING rows and known-ID recovery`,()=>setup(async f=>{
  const b=batch(f,"wallet"),file=path.join(f.root,"quota-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch:b,plan_kind:"wallet_quota"}));let stopped=false;try{await exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536});}catch(error){assert.equal((error as {code:number}).code,mode==="ready_stop"?75:76);stopped=true;}assert.equal(stopped,true);const saved=await readEvidencePublicationIntent(f.options,f.journal,f.grant,b.publicationId);assert.equal(validateEvidenceWalletQuotaPlan(saved.plan).reservation.rpc,f.input.rpcPublicationId);assert.equal(rows(f.copy,"tenx_append_publications").length,mode==="ready_stop"?0:1);
  const bytes=await fs.readFile(path.join(f.target,"metadata.sqlite")),recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:b.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"});assert.equal(recovered.state,"committed");if(recovered.state==="committed")assert.deepEqual(recovered.results,[{success:true,results:[{used:1}],meta:{changes:1}}]);if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("cross-domain identities cannot charge quotas or substitute a quota parent; nonquota result rows remain empty",()=>setup(async f=>{
  const payload=JSON.stringify({address:"mint",pool:"pool",checked_at:at,mode:"live"}),metadata=await publishEvidenceCandidateMetadataBatch(f.options,f.journal,f.grant,{publicationId:f.input.walletPublicationId,statements:[{sql:"INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(mode,address) DO UPDATE SET payload=excluded.payload",bindings:["mint","pool",payload,at,"live"]}]});assert.equal(metadata.state,"committed");const before=stable(f);assert.equal((await run(f)).state,"held");assert.equal((await publishEvidenceWalletQuotaBatch(f.options,f.journal,f.grant,batch(f,"rpc"))).state,"held");assert.deepEqual(stable(f),before);
  f.copy.prepare("UPDATE tenx_append_publications SET results_json=? WHERE publication_id=?").run(JSON.stringify([{success:true,results:[{used:1}],meta:{changes:1}}]),f.input.walletPublicationId);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.walletPublicationId,mode:"reconcile"})).state,"held");
}));

test("RPC reconciliation checks the retained original parent after owner transfer and holds if that parent disappears",()=>setup(async f=>{
  assert.equal((await run(f)).state,"reserved");const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,bytes=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.input.rpcPublicationId,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
  // Only this synthetic publication journal is faulted; no original evidence.
  f.copy.prepare("DELETE FROM tenx_append_publications WHERE publication_id=?").run(f.input.walletPublicationId);const before=stable(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:f.input.rpcPublicationId,mode:"reconcile"})).state,"held");assert.deepEqual(stable(f),before);
}));
