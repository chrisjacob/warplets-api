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
import {readEvidenceWalletMetadata,validateEvidenceWalletCollectionPlan,validateEvidenceWalletCachedPlan,validateEvidenceWalletQuotaPlan,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {collectRecordedFundingOnEvidenceTarget,type WalletCollectionTargetInput} from "./lib/evidence-wallet-collection-target";
import {publishEvidenceWalletCollectionBatch,recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";
import {collectionTransactionSql,collectionCheckpointSql,collectionRepairSql} from "./evidence-wallet-collection-sql.mjs";
import {collectFundingHistories,FundingScanSchema,fundingTask,type FundingScan} from "../discovery/src/funding-history";
import {walletTransaction,WalletTransactionSchema} from "../discovery/src/wallet-rpc";
import {reserveWalletQuota,type WalletSettings} from "../discovery/src/wallet-cycle";
import {MAINNET_GENESIS,RpcClient,MAX_TRANSACTION_VERSION} from "../discovery/src/rpc";
import {hashJson} from "../discovery/src/solana";
import {signature} from "../discovery/src/wallet-fixtures.test-helper";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import recorded from "../discovery/fixtures/recorded/v1-wallet-funding.json";

const exec=promisify(execFile),at=recorded.recorded_at;
type Setup=PublicationFixture&{journal:{directory:string;contextPin:string};input:WalletCollectionTargetInput;scan:FundingScan};
const tx=WalletTransactionSchema.parse(recorded.transaction);
// The archive retained normalized bodies, not raw RPC headers. These two wire
// header counters are synthetic parser scaffolding, not new chain evidence.
const wireTx={...recorded.transaction,transaction:{...recorded.transaction.transaction,message:{...recorded.transaction.transaction.message,header:{...recorded.transaction.transaction.message.header,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:0}}}};
async function setup(work:(f:Setup)=>Promise<void>,options:{second?:boolean;cached?:boolean;legacy?:boolean}={}){
  mock.timers.enable({apis:["Date"],now:new Date(at)});const directory=path.resolve(".tmp","wallet-collection-test-"+randomUUID()),anchor=FundingScanSchema.shape.anchor.parse({...recorded.anchor,...(options.second?{kind:"funding_transfer",instruction_index:0}:{})}),rows=[{signature:recorded.signature,slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(210),slot:tx.slot-20,blockTime:Date.parse(anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}];
  const scan=FundingScanSchema.parse({wallet:anchor.wallet,anchor,lookback_seconds:3600,pages:[{before:anchor.signature,fetched_at:at,rows}],examined:[{signature:recorded.signature,status:"unsupported"}],attempted_at:at});
  const reply=(method:"getGenesisHash"|"getSignaturesForAddress"|"getTransaction",params:unknown[],result:unknown,id:number)=>({method,params,body:JSON.stringify({jsonrpc:"2.0",id,result}),status:200,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()});
  const input:WalletCollectionTargetInput={address:recorded.mint,anchors:[anchor],secondHop:options.second??false,cacheRecovery:options.cached??false,directWalletLimit:20,now:at,walletDailyLimit:800,rpcDailyLimit:5000,writeIds:Array.from({length:8},()=>randomUUID()),replies:[reply("getGenesisHash",[],MAINNET_GENESIS,1),reply("getSignaturesForAddress",[anchor.wallet,{commitment:"finalized",limit:50,before:anchor.signature}],rows,2),reply("getTransaction",[recorded.signature,{commitment:"finalized",encoding:"json",maxSupportedTransactionVersion:MAX_TRANSACTION_VERSION}],wireTx,3)]};
  try{await fixture(async f=>{const made=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,scan,input,journal:{directory,contextPin:made.context_pin}});},async({db})=>{
    if(options.cached){const key=options.second&&!options.legacy?`${anchor.signature}:0`:anchor.signature;db.prepare(`INSERT INTO ${options.second?"tenx_second_hop_scans":"tenx_funding_scans"} VALUES(?,?,?,?,?,?)`).run(recorded.mint,anchor.wallet,key,JSON.stringify(scan),await hashJson(scan),at);db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(recorded.signature,await hashJson(tx),JSON.stringify(tx),at);}
  });}finally{mock.timers.reset();try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-collection-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const run=(f:Setup,input=f.input)=>collectRecordedFundingOnEvidenceTarget(f.options,f.journal,f.grant,input);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const state=(f:Setup)=>["tenx_wallet_transactions","tenx_funding_scans","tenx_second_hop_scans","tenx_usage","tenx_wallet_usage","tenx_append_publications"].map(t=>rows(f.copy,t));
async function oracle(f:Setup){
  const db=sqliteD1(f.db),input=f.input;let rpc:RpcClient;
  rpc=new RpcClient("https://offline.invalid",reserveWalletQuota(db,{walletDailyLimit:input.walletDailyLimit,rpcDailyLimit:input.rpcDailyLimit,marketDailyLimit:0} as WalletSettings,new Date(at)),async(_url,init)=>{const call=JSON.parse(String(init?.body)),reply=input.replies[rpc.calls-1]!;assert.equal(call.method,reply.method);assert.deepEqual(call.params,reply.params);return new Response(reply.body,{status:reply.status});},18);
  await rpc.checkCluster();return collectFundingHistories(db,rpc,input.address,input.anchors,async(sig,slot,status)=>{
    const cached=await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(sig).first<{payload:string;payload_hash:string}>();if(status&&!cached)return {transaction:null,status};const body=cached?WalletTransactionSchema.parse(JSON.parse(cached.payload)):await walletTransaction(rpc,sig);if(body&&body.slot!==slot)throw Error("wallet_signature_slot_mismatch");if(body&&cached)assert.equal(await hashJson(body),cached.payload_hash);if(body&&!cached)await db.prepare(collectionTransactionSql).bind(sig,await hashJson(body),JSON.stringify(body),at).run();return {transaction:body,status:body?"available":"missing"};
  },{secondHop:input.secondHop,cacheRecovery:input.cacheRecovery,directWalletLimit:input.directWalletLimit,rpcCeiling:18});
}
function completed(result:Awaited<ReturnType<typeof run>>){assert.equal(result.state,"completed",JSON.stringify(result));if(result.state!=="completed")throw Error("completed_expected");return result;}
async function transactionBatch(id=randomUUID()){return {publicationId:id,statements:[{sql:collectionTransactionSql,bindings:[recorded.signature,await hashJson(tx),JSON.stringify(tx),at]}]};}

for(const second of [false,true])for(const cached of [false,true])test(`original collection matches all metadata (second ${second}, cache repair ${cached})`,t=>setup(async f=>{
  const scans=await oracle(f),expected=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(c=>String(c.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});const actual=completed(await run(f));assert.deepEqual(actual.scans,scans);for(const e of expected)assert.deepEqual(f.copy.prepare(`SELECT ${e.columns.join(",")} FROM ${e.name} ORDER BY rowid`).all(),e.rows,String(e.name));assert.equal(actual.rpc_calls,cached?1:3);assert.equal(actual.provider_requests,0);assert.equal(fundingTask(actual.scans[0]!).coverage.status,"window_examined");
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));for(const p of actual.publications)if(p.publication_id)assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:p.publication_id,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);t.diagnostic(JSON.stringify({original_tables:expected.length,recorded_responses:actual.recorded_responses,original_collector:true,provider_requests:0,oracle_forwarding:false,prerequisite_copy:false}));
},{second,cached,legacy:second&&cached}));

test("wrong cluster and HTTP rate limits retain original spent counters and no collection writes",()=>setup(async f=>{
  for(const rateLimited of [false,true]){const input=structuredClone(f.input);input.replies=input.replies.map(r=>({...r,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()}));if(rateLimited){input.replies[0]!.status=429;input.replies[0]!.retryAfter="600";}else input.replies[0]!.body=JSON.stringify({jsonrpc:"2.0",id:1,result:"other"});const actual=await run(f,input);assert.equal(actual.state,"held");if(actual.state==="held"){assert.equal(actual.reason,rateLimited?"rpc_rate_limited":"wrong_solana_cluster");assert.equal(actual.retry_after_seconds,rateLimited?600:3600);}assert.equal(rows(f.copy,"tenx_wallet_transactions").length,0);}assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(at.slice(0,10))!.used,2);
}));

test("shared quota decline retains wallet charge and withholds recorded dispatch",()=>setup(async f=>{
  const input={...f.input,rpcDailyLimit:1};f.copy.prepare("INSERT INTO tenx_usage VALUES('rpc',?,1)").run(at.slice(0,10));const actual=await run(f,input);assert.equal(actual.state,"held");if(actual.state==="held")assert.equal(actual.reason,"rpc_daily_budget_exhausted");assert.equal(actual.recorded_responses,0);assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(at.slice(0,10))!.used,1);assert.equal(rows(f.copy,"tenx_wallet_transactions").length,0);
}));

test("null bodies preserve terminal missing evidence instead of inventing a transaction",()=>setup(async f=>{
  const input=structuredClone(f.input);input.replies[2]!.body=JSON.stringify({jsonrpc:"2.0",id:3,result:null});const actual=completed(await run(f,input));assert.equal(actual.scans[0]!.examined[0]!.status,"missing");assert.equal(rows(f.copy,"tenx_wallet_transactions").length,0);assert.ok(fundingTask(actual.scans[0]!).gaps.includes("funding_transaction_missing_or_unsupported"));
}));

test("bad transaction slot holds after page progress without cache admission or quota refunds",()=>setup(async f=>{
  const input=structuredClone(f.input),body=structuredClone(wireTx);body.slot++;input.replies[2]!.body=JSON.stringify({jsonrpc:"2.0",id:3,result:body});const actual=await run(f,input);assert.equal(actual.state,"held");if(actual.state==="held")assert.equal(actual.reason,"wallet_signature_slot_mismatch");assert.equal(rows(f.copy,"tenx_funding_scans").length,1);assert.equal(rows(f.copy,"tenx_wallet_transactions").length,0);assert.equal(f.copy.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?").get(at.slice(0,10))!.used,3);
}));

test("missing and duplicate retained IDs hold rather than dispatching or replacing prior progress",()=>setup(async f=>{
  const before=state(f);const duplicate={...f.input,writeIds:[f.input.replies[0]!.walletPublicationId]};assert.equal((await run(f,duplicate)).state,"held");assert.deepEqual(state(f),before);const actual=await run(f,{...f.input,writeIds:[]});assert.equal(actual.state,"held");assert.equal(actual.recorded_responses,2);assert.equal(rows(f.copy,"tenx_funding_scans").length,0);
}));

test("reused quota identities never replay recorded transport as a fresh request",()=>setup(async f=>{
  completed(await run(f));const before=state(f),actual=await run(f);assert.equal(actual.state,"held");if(actual.state==="held")assert.equal(actual.reason,"wallet_collection_replayed_reservation");assert.equal(actual.recorded_responses,0);assert.deepEqual(state(f),before);
}));

test("late transaction SQL failure preserves prior page and spent allowance with recoverable intent",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===collectionTransactionSql)throw Error("cache_write_fault");return original.call(this,sql);});const actual=await run(f);hook.mock.restore();assert.equal(actual.state,"held");assert.equal(rows(f.copy,"tenx_funding_scans").length,1);assert.equal(rows(f.copy,"tenx_wallet_transactions").length,0);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.writeIds[1]!,mode:"publish"})).state,"committed");assert.equal(rows(f.copy,"tenx_wallet_transactions").length,1);
}));

test("strict collection domain binds SQL, hashes and direct/second/legacy keys without admitting quotas",()=>setup(async f=>{
  const b=await transactionBatch(),plan={publication_id:b.publicationId,kind:"wallet_collection",operations:b.statements.map(op=>({kind:"sql",...op}))};assert.doesNotThrow(()=>validateEvidenceWalletCollectionPlan(plan));assert.throws(()=>validateEvidenceWalletCachedPlan(plan));assert.throws(()=>validateEvidenceWalletQuotaPlan(plan));
  for(const change of [(p:any)=>p.operations[0].sql="DELETE FROM tenx_wallet_transactions",(p:any)=>p.operations[0].bindings[0]=signature(201),(p:any)=>p.operations[0].bindings[1]="0".repeat(64),(p:any)=>p.operations[0].expect_changes=1,(p:any)=>p.operations.push(p.operations[0])]){const bad=structuredClone(plan);change(bad);assert.throws(()=>validateEvidenceWalletCollectionPlan(bad));}
  const scan={...f.scan,examined:[],anchor:{...f.scan.anchor,kind:"funding_transfer",instruction_index:0}},payload=JSON.stringify(scan),hash=await hashJson(scan),checkpoint={publication_id:randomUUID(),kind:"wallet_collection",operations:[{kind:"sql",sql:collectionCheckpointSql.second,bindings:[f.input.address,scan.wallet,scan.anchor.signature,payload,hash,at]}]};assert.throws(()=>validateEvidenceWalletCollectionPlan(checkpoint));checkpoint.operations[0]!.bindings[2]+=':0';assert.doesNotThrow(()=>validateEvidenceWalletCollectionPlan(checkpoint));
  const missing={...scan,anchor:{...scan.anchor,instruction_index:undefined}};checkpoint.operations[0]!.bindings=[f.input.address,scan.wallet,scan.anchor.signature+':undefined',JSON.stringify(missing),await hashJson(missing),at];assert.throws(()=>validateEvidenceWalletCollectionPlan(checkpoint));const before=state(f);assert.equal((await run(f,{...f.input,secondHop:true})).state,"held");assert.deepEqual(state(f),before);
}));

test("zero-row repair remains a committed original CAS result and stale owner cannot write",()=>setup(async f=>{
  const scan={...f.scan,examined:[]},b={publicationId:randomUUID(),statements:[{sql:collectionRepairSql.direct,bindings:[JSON.stringify(scan),await hashJson(scan),at,f.input.address,scan.wallet,scan.anchor.signature,"0".repeat(64)]}]},actual=await publishEvidenceWalletCollectionBatch(f.options,f.journal,f.grant,b);assert.equal(actual.state,"committed");if(actual.state==="committed")assert.equal(actual.results[0]!.meta.changes,0);const next=(await transferEvidencePublicationOwner(f.options,f.grant,randomUUID())).grant,before=state(f);assert.equal((await publishEvidenceWalletCollectionBatch(f.options,f.journal,f.grant,await transactionBatch())).state,"held");assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,next,{publicationId:b.publicationId,mode:"reconcile"})).state,"committed");assert.deepEqual(state(f),before);
}));

test("checkpoint key selection preserves original preferred/legacy order, NUL and read-only bytes",()=>setup(async f=>{
  const wallet=f.scan.wallet;for(const key of ["legacy\u0000é","preferred\u0000終"])f.copy.prepare("INSERT INTO tenx_second_hop_scans VALUES(?,?,?,?,?,?)").run(f.input.address,wallet,key,"{}","x",at);const before=await fs.readFile(path.join(f.target,"metadata.sqlite")),request={kind:"checkpoint_key",hop:"second",address:f.input.address,wallet,preferred:"preferred\u0000終",legacy:"legacy\u0000é"};assert.equal((await readEvidenceWalletMetadata(f.options,f.grant,request)).row!.anchor_signature,request.preferred);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

for(const mode of ["ready_stop","commit_stop"])test(`fresh-process ${mode} recovers transaction write without collection arguments or duplicate SQL`,()=>setup(async f=>{
  const batch=await transactionBatch(),file=path.join(f.root,"collection-child.json");await fs.writeFile(file,JSON.stringify({publication:f.options,journal:f.journal,grant:f.grant,batch,plan_kind:"wallet_collection"}));await assert.rejects(exec(process.execPath,["--import","tsx","scripts/evidence-producer-restart-fixture.ts",file,mode],{maxBuffer:65536}),e=>(e as {code:number}).code===(mode==="ready_stop"?75:76));const bytes=await fs.readFile(path.join(f.target,"metadata.sqlite")),actual=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,mode:mode==="ready_stop"?"publish":"reconcile"});assert.equal(actual.state,"committed");assert.equal(rows(f.copy,"tenx_wallet_transactions").length,1);if(mode==="commit_stop")assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("lost cache-write acknowledgement stops collection and reconciles history read-only",()=>setup(async f=>{
  const original=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!lost)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(f.input.writeIds[1]!);}catch{}const result=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return result;});const actual=await run(f);hook.mock.restore();assert.equal(actual.state,"held");assert.equal(lost,true);assert.equal(rows(f.copy,"tenx_wallet_transactions").length,1);const scan=JSON.parse(String(rows(f.copy,"tenx_funding_scans")[0]!.payload));assert.deepEqual(scan.examined,[]);const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.input.writeIds[1]!,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));

test("a concurrent legacy second-hop checkpoint change retains zero-row CAS and original error",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare;let raced=false;const hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql===collectionRepairSql.second&&!raced){raced=true;original.call(this,"UPDATE tenx_second_hop_scans SET payload_hash=?").run("0".repeat(64));}return original.call(this,sql);});const actual=await run(f);hook.mock.restore();assert.equal(actual.state,"held");if(actual.state==="held")assert.equal(actual.reason,"funding_checkpoint_changed_during_cache_recovery");const p=actual.publications.at(-1)!;assert.equal(p.state,"committed");if(p.state==="committed")assert.equal(p.results[0]!.meta.changes,0);assert.equal(rows(f.copy,"tenx_second_hop_scans")[0]!.payload_hash,"0".repeat(64));assert.equal(JSON.parse(String(rows(f.copy,"tenx_second_hop_scans")[0]!.payload)).examined[0].status,"unsupported");
},{second:true,cached:true,legacy:true}));

test("nonempty collection results are rejected during read-only recovery",()=>setup(async f=>{
  const batch=await transactionBatch();assert.equal((await publishEvidenceWalletCollectionBatch(f.options,f.journal,f.grant,batch)).state,"committed");f.copy.prepare("UPDATE tenx_append_publications SET results_json=? WHERE publication_id=?").run(JSON.stringify([{success:true,results:[{used:1}],meta:{changes:1}}]),batch.publicationId);const before=state(f);assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:batch.publicationId,mode:"reconcile"})).state,"held");assert.deepEqual(state(f),before);
}));

test("response byte bounds and stale grants hold; caller mutation cannot replace retained authority or recording",()=>setup(async f=>{
  const before=state(f),oversized=structuredClone(f.input);oversized.replies[0]!.body="é".repeat(1500001);assert.equal((await run(f,oversized)).state,"held");assert.deepEqual(state(f),before);assert.equal((await collectRecordedFundingOnEvidenceTarget(f.options,f.journal,{...f.grant,epoch:f.grant.epoch+1},f.input)).state,"held");assert.deepEqual(state(f),before);
  const input=structuredClone(f.input),options=structuredClone(f.options),grant={...f.grant},pending=collectRecordedFundingOnEvidenceTarget(options,f.journal,grant,input);input.replies[0]!.body="mutated";input.writeIds=[];grant.epoch++;options.targetPin="0".repeat(64);assert.equal(completed(await pending).recorded_responses,3);
}));
