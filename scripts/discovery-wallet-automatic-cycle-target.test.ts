import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {fixture,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal} from "./discovery-evidence-intents.mjs";
import {runRecordedAutomaticWalletCycleOnEvidenceTarget,type WalletAutomaticCycleTargetInput} from "./lib/evidence-wallet-direct-cycle-target";
import {recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {key,signature,walletInput} from "../discovery/src/wallet-fixtures.test-helper";
import {analyzeWalletEvidence,WalletEvidenceSchema,type WalletEvidence} from "../discovery/src/wallet-analysis";
import {FundingScanSchema,type FundingScan} from "../discovery/src/funding-history";
import {WalletTransactionSchema,type WalletTransaction} from "../discovery/src/wallet-rpc";
import {runWalletCycle,type WalletSettings} from "../discovery/src/wallet-cycle";
import {hashJson} from "../discovery/src/solana";
import {MAINNET_GENESIS} from "../discovery/src/rpc";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import type {Candidate} from "../discovery/src/model";
import recorded from "../discovery/fixtures/recorded/v1-wallet-funding.json";

const at=recorded.recorded_at;
// Synthetic migrated candidate index only; these rows do not establish new
// creation/graduation provenance or copy any oracle execution prerequisites.
const seedCandidate=(db:DatabaseSync,c:Candidate)=>db.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,?)").run(c.address,c.pool,JSON.stringify(c),c.checked_at,c.mode);
type Stage="cached"|"direct"|"recovery"|"refresh"|"new"|"limited"|"invalid";
type Seed={candidate:Candidate;scan?:FundingScan;evidence?:ReturnType<typeof WalletEvidenceSchema.parse>;body:WalletTransaction};
type Setup=PublicationFixture&{input:WalletAutomaticCycleTargetInput;journal:{directory:string;contextPin:string};original:Record<string,unknown>;primary:Seed;other:Seed};
async function setup(work:(f:Setup)=>Promise<void>,primaryStage:Stage="direct",otherStage:Stage="new",mode="normal"){
  mock.timers.enable({apis:["Date"],now:new Date(at)});const job=randomUUID();mock.method(globalThis.crypto,"randomUUID",()=>job);
  const base=(await fixtureCandidates(new Date(at)))[0]!,synthetic=await walletInput();
  async function token(stage:Stage,alternate=false):Promise<Seed>{
    const anchorTx=alternate?synthetic.records[1]!.transaction!:WalletTransactionSchema.parse(recorded.anchor_transaction),body=alternate?WalletTransactionSchema.parse({...anchorTx,slot:anchorTx.slot-1,blockTime:anchorTx.blockTime!-10,transaction:{...anchorTx.transaction,signatures:[signature(80)]}}):WalletTransactionSchema.parse(recorded.transaction);
    const candidate:Candidate={...base,address:alternate?base.address:recorded.mint,pool:alternate?base.pool:recorded.pool,mode:"live",creation:alternate?synthetic.asset.creation:base.creation,market:{...base.market!,liquidity_usd:alternate?80000:50000},wallet_analysis:null};
    if(stage==="new")return {candidate,body};
    const anchor=alternate?{wallet:anchorTx.transaction.message.accountKeys[0]!,signature:anchorTx.transaction.signatures[0]!,slot:anchorTx.slot,block_time:new Date(anchorTx.blockTime!*1000).toISOString(),kind:"sampled_buy" as const}:recorded.anchor;
    const scan=FundingScanSchema.parse({wallet:anchor.wallet,anchor,lookback_seconds:3600,attempted_at:at,pages:[{before:anchor.signature,fetched_at:at,rows:[{signature:body.transaction.signatures[0]!,slot:body.slot,blockTime:body.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(alternate?212:211),slot:body.slot-20,blockTime:Date.parse(anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]}],examined:["recovery","limited","refresh"].includes(stage)?[{signature:body.transaction.signatures[0]!,status:stage==="recovery"?"unsupported":stage==="limited"?"missing":"available"}]:[]});
    const records:WalletEvidence["records"]=[{signature:anchor.signature,transaction:anchorTx,fetched_at:at,status:"available",purposes:["recent"]}];
    if(["recovery","limited","refresh"].includes(stage))records.push({signature:body.transaction.signatures[0]!,transaction:stage==="refresh"?body:null,fetched_at:at,status:stage==="recovery"?"unsupported":stage==="limited"?"missing":"available",purposes:["wallet"]});
    const evidence=WalletEvidenceSchema.parse({version:"wallet-input-v4",observed_at:at,cluster:MAINNET_GENESIS,asset:{address:candidate.address,pool:candidate.pool,token_program:base.risk.token_program,creation:candidate.creation,graduation:candidate.graduation},records,histories:[],holders:null,prior_losses:[],gaps:[],funding_scans:[scan],second_hop_scans:[]});candidate.wallet_analysis=await analyzeWalletEvidence(evidence);return {candidate,body,evidence,scan};
  }
  const primary=await token(primaryStage),other=await token(otherStage,true),directory=path.resolve(".tmp","wallet-automatic-test-"+randomUUID());
  const input:WalletAutomaticCycleTargetInput={now:at,walletEnabled:mode!=="disabled",walletDailyLimit:800,rpcDailyLimit:5000,marketDailyLimit:600,stageId:randomUUID(),ids:{lease:randomUUID(),spacing:randomUUID(),release:randomUUID(),catchup:randomUUID(),backoff:randomUUID(),work:randomUUID(),finish:randomUUID(),failure_run:randomUUID(),failure_release:randomUUID(),failure_attempt:randomUUID()},writeIds:Array.from({length:40},()=>randomUUID()),replies:[],recoveries:[],checkpoints:[]};
  for(const seed of [primary,other])if(seed.scan){input.checkpoints.push({wallet:seed.scan.wallet,anchorSignature:seed.scan.anchor.signature,publicationId:randomUUID()});if(seed===primary&&primaryStage==="recovery"||seed===other&&otherStage==="recovery")input.recoveries.push({signature:seed.body.transaction.signatures[0]!,claimId:randomUUID(),finishId:randomUUID(),errorFinishId:randomUUID()});}
  try{await fixture(async f=>{
    const made=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});
    const transport:typeof fetch=async(_url,init)=>{
      const e=JSON.parse(String(init?.body));let result:unknown=e.method==="getGenesisHash"?MAINNET_GENESIS:e.method==="getSignaturesForAddress"?[]:null;
      if(e.method==="getTransaction"){const body=[primary.body,other.body].find(b=>b.transaction.signatures[0]===e.params[0]);if(body)result={...body,transaction:{...body.transaction,message:{...body.transaction.message,header:{...body.transaction.message.header,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:0}}}};}
      const limited=mode==="rate_limited",status=limited?429:200,body=JSON.stringify({jsonrpc:"2.0",id:e.id,result});input.replies.push({method:e.method,params:e.params,body,status,...(limited?{retryAfter:"600"}:{}),walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()});return new Response(body,{status,headers:limited?{"retry-after":"600"}:{}});
    };
    const original=await runWalletCycle({db:sqliteD1(f.db),walletEnabled:input.walletEnabled,walletDailyLimit:800,rpcDailyLimit:5000,marketDailyLimit:600,rpcUrl:"https://offline.invalid",marketEnabled:false,transport} as WalletSettings,undefined,new Date(at));
    if(["rpc_exhausted","wallet_exhausted"].includes(mode))input.replies.push({method:"getGenesisHash",params:[],body:JSON.stringify({jsonrpc:"2.0",id:1,result:MAINNET_GENESIS}),status:200,walletPublicationId:randomUUID(),rpcPublicationId:randomUUID()});
    await work({...f,input,original,primary,other,journal:{directory,contextPin:made.context_pin}});
  },async({db})=>{
    db.exec("DELETE FROM tenx_candidates;DELETE FROM tenx_wallet_work");
    for(const [seed,stage] of [[primary,primaryStage],[other,otherStage]] as const){seedCandidate(db,seed.candidate);if(seed.evidence&&seed.scan){db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(seed.candidate.wallet_analysis!.evidence_hash,seed.candidate.address,JSON.stringify(seed.evidence),at);db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?)").run(seed.candidate.address,seed.scan.wallet,seed.scan.anchor.signature,JSON.stringify(seed.scan),await hashJson(seed.scan),at);if(stage==="cached"||stage==="invalid")db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(seed.body.transaction.signatures[0]!,stage==="invalid"?'corrupt':await hashJson(seed.body),JSON.stringify(seed.body),at);}}
    db.exec("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_error='rpc_unavailable'");
    if(mode==="retry_future")db.prepare("INSERT INTO tenx_wallet_attempts VALUES(?,?,?)").run(primary.candidate.address,at,new Date(Date.parse(at)+60000).toISOString());
    if(mode==="retry_equal"||mode==="attempt_tie")for(const [i,seed] of [primary,other].entries())db.prepare("INSERT INTO tenx_wallet_attempts VALUES(?,?,?)").run(seed.candidate.address,new Date(Date.parse(at)-(i?60000:120000)).toISOString(),at);
    if(mode==="empty")db.exec("DELETE FROM tenx_candidates");if(mode==="risk")db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.risk.mint_authority','active') WHERE address=?").run(primary.candidate.address);if(mode==="old")db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.creation.block_time','2026-10-01T00:00:00.000Z') WHERE address=?").run(primary.candidate.address);
    if(mode==="no_catchup"||mode==="not_due")db.prepare("INSERT INTO tenx_usage VALUES('wallet_catchup',?,180)").run(at.slice(0,10));if(mode==="not_due")db.prepare("UPDATE tenx_wallet_control SET next_refresh_at=?").run(new Date(Date.parse(at)+60000).toISOString());
    if(mode==="paused")db.exec("UPDATE tenx_control SET paused=1");if(mode==="backoff")db.prepare("UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after=?").run(new Date(Date.parse(at)+60000).toISOString());if(mode==="busy"||mode==="expiry_equal")db.prepare("UPDATE tenx_wallet_control SET lease_owner='other',lease_until=?").run(mode==="busy"?new Date(Date.parse(at)+60000).toISOString():at);
    if(mode==="rpc_exhausted")db.prepare("INSERT INTO tenx_usage VALUES('rpc',?,5000)").run(at.slice(0,10));if(mode==="wallet_exhausted")db.prepare("INSERT INTO tenx_wallet_usage VALUES(?,800)").run(at.slice(0,10));
    if(mode==="twenty_limit"){for(let i=0;i<21;i++)seedCandidate(db,{...other.candidate,address:key(90+i),market:{...other.candidate.market!,liquidity_usd:1000000-i},checked_at:at});}
  });}finally{mock.timers.reset();try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-automatic-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
}
const run=(f:Setup,input=f.input)=>runRecordedAutomaticWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,f.grant,input);
const rows=(db:DatabaseSync,t:string)=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
const state=(f:Setup)=>["tenx_candidates","tenx_funding_scans","tenx_wallet_runs","tenx_wallet_control","tenx_usage","tenx_wallet_usage","tenx_wallet_attempts","tenx_append_publications"].map(t=>rows(f.copy,t));
function complete(r:Awaited<ReturnType<typeof run>>){assert.equal(r.state,"completed",JSON.stringify(r));if(r.state!=="completed")throw Error("completed_expected");return r;}

for(const [primary,other,mode] of [
  ["cached","new","normal"],["cached","refresh","normal"],["refresh","direct","normal"],["direct","refresh","normal"],["recovery","new","normal"],["direct","new","normal"],["new","new","normal"],["limited","new","normal"],["invalid","new","normal"],
  ["cached","new","retry_future"],["cached","new","retry_equal"],["direct","direct","attempt_tie"],["cached","new","risk"],["cached","new","old"],["direct","new","empty"],["direct","new","no_catchup"],["direct","new","not_due"],["direct","new","disabled"],["direct","new","paused"],["direct","new","backoff"],["direct","new","busy"],["direct","new","expiry_equal"],["direct","new","rate_limited"],["direct","new","rpc_exhausted"],["direct","new","wallet_exhausted"],["cached","new","twenty_limit"],
] as const)test(`original automatic turn and all retained metadata match: ${primary}/${other}/${mode}`,t=>setup(async f=>{
  const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(r=>String(r.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});const actual=complete(await run(f));assert.deepEqual(actual.result,f.original);for(const v of tables)assert.deepEqual(f.copy.prepare(`SELECT ${v.columns.join(",")} FROM ${v.name} ORDER BY rowid`).all(),v.rows,String(v.name));assert.equal(actual.provider_requests,0);assert.equal(actual.source_authorized,false);
  if(mode==="twenty_limit"){assert.equal(actual.selection?.considered.length,20);assert.equal(actual.selection?.considered.some(c=>c.address===f.primary.candidate.address),false);}if(f.original.state==="progressed"||f.original.state==="succeeded"||f.original.state==="empty")assert.equal(actual.selection?.verified,true);if(mode==="not_due"||mode==="busy"||mode==="expiry_equal")assert.equal(actual.selection?.verified,false);
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));for(const p of actual.publications)if(p.publication_id)assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:p.publication_id,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);t.diagnostic(JSON.stringify({original_tables:tables.length,primary,other,mode,selected:actual.selection?.selected??null,recorded_responses:actual.recorded_responses,oracle_forwarding:false,prerequisite_copy:false}));
},primary,other,mode));

test("required selected-stage IDs and duplicate identities hold before acquisition",()=>setup(async f=>{
  const before=state(f);assert.equal((await run(f,{...f.input,checkpoints:[]})).state,"held");assert.equal((await run(f,{...f.input,stageId:f.input.ids.lease})).state,"held");assert.deepEqual(state(f),before);
},"cached"));
test("automatic recovery requires retained claim and finish identities before acquisition",()=>setup(async f=>{
  const before=state(f);assert.equal((await run(f,{...f.input,recoveries:[]})).state,"held");assert.deepEqual(state(f),before);
},"recovery"));
test("automatic snapshots require a retained stage identity and cannot be pinned by a caller address",()=>setup(async f=>{
  const before=state(f);assert.equal((await run(f,{...f.input,stageId:undefined})).state,"held");assert.equal((await run(f,{...f.input,address:f.primary.candidate.address} as WalletAutomaticCycleTargetInput)).state,"held");assert.deepEqual(state(f),before);
},"new","new"));
for(const changed of ["attempts","checkpoint","cache","candidate_index"])test(`planning ${changed} mutation after accepted lease holds without dispatch or reassignment`,()=>setup(async f=>{
  const id=f.input.ids.lease,original=DatabaseSync.prototype.exec;let done=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let change=false;if(sql==="COMMIT"&&!done)try{change=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(change){done=true;if(changed==="attempts")f.copy.prepare("INSERT INTO tenx_wallet_attempts VALUES(?,?,?)").run(f.primary.candidate.address,at,new Date(Date.parse(at)+60000).toISOString());if(changed==="checkpoint")f.copy.exec("UPDATE tenx_funding_scans SET payload='{}'");if(changed==="candidate_index")f.copy.exec("UPDATE tenx_candidates SET payload=json_set(payload,'$.symbol','changed')");if(changed==="cache")f.copy.exec("UPDATE tenx_wallet_transactions SET payload_hash='changed'");}return result;});const actual=await run(f);hook.mock.restore();assert.equal(done,true);assert.equal(actual.state,"held");assert.equal(actual.recorded_responses,0);assert.equal(actual.publications.length,1);assert.equal(rows(f.copy,"tenx_wallet_runs").length,0);assert.equal(rows(f.copy,"tenx_wallet_usage").filter(r=>r.day===at.slice(0,10)).length,0);assert.equal(actual.selection?.verified,false);
},changed==="cache"?"cached":"direct"));
test("unknown lease acknowledgement reconciles history without another selection or source response",()=>setup(async f=>{
  const id=f.input.ids.lease,original=DatabaseSync.prototype.exec;let lost=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!lost)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(stop){lost=true;throw Error("ack_lost");}return result;});const actual=await run(f);hook.mock.restore();assert.equal(actual.state,"held");assert.equal(actual.recorded_responses,0);const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.equal((await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:id,mode:"reconcile"})).state,"committed");assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
}));
test("stale append authority and caller mutation cannot substitute selection inputs",()=>setup(async f=>{
  const before=state(f);assert.equal((await runRecordedAutomaticWalletCycleOnEvidenceTarget(f.source,f.options,f.journal,{...f.grant,epoch:2},f.input)).state,"held");assert.deepEqual(state(f),before);const input=structuredClone(f.input),pending=run(f,input);input.replies[0]!.body='changed';input.ids.lease=randomUUID();assert.equal(complete(await pending).result.state,"progressed");
}));
test("lost append ownership after verified selection preserves that history but withholds dispatch and retains spend",()=>setup(async f=>{
  const id=f.input.replies[0]!.rpcPublicationId,original=DatabaseSync.prototype.exec;let changed=false;
  const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!changed)try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id);}catch{}const result=original.call(this,sql);if(stop){changed=true;f.copy.prepare("UPDATE tenx_append_control SET owner=?,epoch=epoch+1 WHERE id=1").run(randomUUID());}return result;});
  const actual=await run(f);hook.mock.restore();assert.equal(changed,true);assert.equal(actual.state,"held");assert.equal(actual.selection?.verified,true);assert.equal(actual.recorded_responses,0);assert.equal(actual.source_authorized,false);assert.equal(rows(f.copy,"tenx_wallet_usage").find(r=>r.day===at.slice(0,10))!.used,1);assert.equal(rows(f.copy,"tenx_wallet_runs").length,0);
}));
