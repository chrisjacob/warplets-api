import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {fixture,sha,type PublicationFixture} from "./discovery-evidence-publication-test-helper.mjs";
import {createEvidenceIntentJournal} from "./discovery-evidence-intents.mjs";
import {readEvidenceWalletMetadata,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {replayLegacyWalletsOnEvidenceTarget,readWalletReplayReceipt,type WalletReplayIdentity} from "./lib/evidence-wallet-replay-target";
import {recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";
import {saveCandidate} from "../discovery/src/store";
import {replayLegacyWallets} from "../discovery/src/wallet-work";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {walletInput,trade,key,signature} from "../discovery/src/wallet-fixtures.test-helper";
import {analyzeWalletEvidence,WalletEvidenceSchema,type WalletEvidence} from "../discovery/src/wallet-analysis";
import {FundingScanSchema,type FundingScan} from "../discovery/src/funding-history";
import {WalletTransactionSchema} from "../discovery/src/wallet-rpc";
import {hashJson} from "../discovery/src/solana";
import {MAINNET_GENESIS} from "../discovery/src/rpc";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import type {Candidate} from "../discovery/src/model";
import transient from "../discovery/fixtures/recorded/temporary-wsol-trade.json";

type Values={input:WalletEvidence;candidate:Candidate};
type Setup=PublicationFixture&Values&{journal:{directory:string;contextPin:string};identities:WalletReplayIdentity[]};
async function setup(work:(f:Setup)=>Promise<void>,seed?:(db:DatabaseSync,v:Values)=>Promise<void>,recorded=false){
  let raw=await walletInput();
  if(recorded){const tx=WalletTransactionSchema.parse(transient.transaction);raw={version:"wallet-input-v3",observed_at:transient.recorded_at,cluster:MAINNET_GENESIS,asset:{address:transient.mint,pool:transient.pool,token_program:key(1),creation:null,graduation:null},records:[{signature:tx.transaction.signatures[0]!,fetched_at:transient.recorded_at,status:"available",purposes:["recent"],transaction:tx}],histories:[],holders:null,prior_losses:[],funding_scans:[],second_hop_scans:[],gaps:[]};}
  const input=WalletEvidenceSchema.parse(raw),candidate:Candidate={...(await fixtureCandidates(new Date(input.observed_at)))[0]!,mode:"live",address:input.asset.address,pool:input.asset.pool,creation:input.asset.creation,graduation:null,holders:null,wallet_analysis:await analyzeWalletEvidence(input)},directory=path.resolve(".tmp","wallet-replay-target-test-"+randomUUID());
  try{await fixture(async f=>{const created=await createEvidenceIntentJournal({target:directory,publication:f.options,grant:f.grant});await work({...f,input,candidate,journal:{directory,contextPin:created.context_pin},identities:[{address:candidate.address,publicationId:randomUUID(),stageId:randomUUID()}]});},async({db})=>{
    db.exec("DELETE FROM tenx_candidates; DELETE FROM tenx_wallet_work");await saveCandidate(sqliteD1(db),candidate);db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(candidate.wallet_analysis!.evidence_hash,candidate.address,JSON.stringify(input),input.observed_at);await seed?.(db,{input,candidate});
  });}finally{try{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(".tmp"));assert.ok(path.basename(actual).startsWith("wallet-replay-target-test-"));await fs.rm(actual,{recursive:true,force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
}
const run=(f:Setup)=>replayLegacyWalletsOnEvidenceTarget(f.source,f.options,f.journal,f.grant,f.identities);
const rows=(db:DatabaseSync,table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const stable=(f:Setup)=>["tenx_candidates","tenx_wallet_evidence","tenx_wallet_profiles","tenx_wallet_work","tenx_append_base","tenx_append_references","tenx_append_publications","tenx_cohorts","tenx_wallet_cohorts","tenx_usage","tenx_wallet_usage","tenx_funding_scans","tenx_wallet_transactions"].map(t=>rows(f.copy,t));
function expected(f:Setup){return f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>{const columns=f.copy.prepare(`PRAGMA table_info(${name})`).all().map(row=>String(row.name));return {name,columns,rows:f.db.prepare(`SELECT ${columns.join(",")} FROM ${name} ORDER BY rowid`).all()};});}
function compare(f:Setup,values:ReturnType<typeof expected>){for(const value of values)assert.deepEqual(f.copy.prepare(`SELECT ${value.columns.join(",")} FROM ${value.name} ORDER BY rowid`).all(),value.rows,String(value.name));}
function complete(value:Awaited<ReturnType<typeof run>>){assert.equal(value.state,"completed",JSON.stringify(value));if(value.state!=="completed")throw Error("completion_expected");return value;}
async function cached(db:DatabaseSync,v:Values,future=false){
  const origin=v.input.records[1]!,anchor={wallet:key(8),signature:origin.signature,slot:origin.transaction!.slot,block_time:new Date(origin.transaction!.blockTime!*1000).toISOString(),kind:"sampled_buy" as const},tx=await trade(key(8),9999,"buy",92);tx.blockTime=Date.parse(anchor.block_time)/1000-10;
  const scan=FundingScanSchema.parse({wallet:anchor.wallet,anchor,lookback_seconds:3600,pages:[{before:anchor.signature,fetched_at:v.input.observed_at,rows:[{signature:signature(92),slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(93),slot:tx.slot-1,blockTime:Date.parse(anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]}],examined:[{signature:signature(92),status:"available"}],attempted_at:v.input.observed_at});
  db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?)").run(v.candidate.address,scan.wallet,scan.anchor.signature,JSON.stringify(scan),await hashJson(scan),scan.attempted_at);db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(signature(92),await hashJson(tx),JSON.stringify(tx),future?new Date(Date.parse(v.input.observed_at)+60000).toISOString():v.input.observed_at);
}

for(const recorded of [false,true])test(`${recorded?"recorded temporary-WSOL":"synthetic"}: complete original wallet replay matches every metadata table with no oracle forwarding or prerequisite copying`,context=>setup(async f=>{
  const original=await replayLegacyWallets(sqliteD1(f.db)),values=expected(f),sourceBefore=sha(await fs.readFile(path.join(f.root,"source.sqlite"))),cohorts=[rows(f.copy,"tenx_cohorts"),rows(f.copy,"tenx_wallet_cohorts")];
  mock.method(f.db,"prepare",()=>{throw Error("oracle_forbidden");});mock.method(f.db,"exec",()=>{throw Error("oracle_forbidden");});
  const result=complete(await run(f));assert.deepEqual(result.result,original);assert.equal(result.publications.length,1);assert.equal(result.publications[0]!.outcome.state,"committed");compare(f,values);assert.deepEqual([rows(f.copy,"tenx_cohorts"),rows(f.copy,"tenx_wallet_cohorts")],cohorts);assert.equal(sha(await fs.readFile(path.join(f.root,"source.sqlite"))),sourceBefore);
  const candidate=JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_candidates").get()!.payload));assert.equal(candidate.checked_at,f.candidate.checked_at);assert.equal(candidate.wallet_analysis.observed_at,f.input.observed_at);
  const publication=result.publications[0]!.outcome;if(publication.state==="committed")context.diagnostic(JSON.stringify({recorded,original_tables:values.length,changes:publication.results.map(r=>r.meta.changes),oracle_access:false,prerequisite_copy:false,cohorts_unchanged:true,provider_requests:0,runtime_activated:false}));
  if(recorded)assert.deepEqual((result.result.upgraded as {buyers_before:number;buyers_after:number}[]).map(r=>[r.buyers_before,r.buyers_after]),[[0,1]]);
  const before=stable(f),retry=complete(await run(f));assert.deepEqual(retry.result.upgraded,[]);assert.deepEqual(retry.publications,[]);assert.deepEqual(stable(f),before);
  const reconciled=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.identities[0]!.publicationId,mode:"reconcile"});assert.equal(reconciled.state,"committed");if(reconciled.state==="committed")assert.equal(reconciled.reconciled,true);assert.deepEqual(stable(f),before);
},undefined,recorded));

for(const future of [false,true])test(`cached funding checkpoint ${future?"excludes a future body":"uses an exact retained body"} through the original replay`,()=>setup(async f=>{
  const original=await replayLegacyWallets(sqliteD1(f.db)),values=expected(f),cache=[rows(f.copy,"tenx_funding_scans"),rows(f.copy,"tenx_wallet_transactions")],result=complete(await run(f));assert.deepEqual(result.result,original);compare(f,values);assert.deepEqual([rows(f.copy,"tenx_funding_scans"),rows(f.copy,"tenx_wallet_transactions")],cache);
  assert.equal(result.publications[0]!.outcome.state,"committed");const current=JSON.parse(String(f.copy.prepare("SELECT payload FROM tenx_candidates").get()!.payload)),receipt=await readWalletReplayReceipt(f.source,f.options,f.grant,current.wallet_analysis.evidence_hash,f.candidate.address),input=WalletEvidenceSchema.parse(JSON.parse(receipt!.payload));assert.equal(input.records.some(r=>r.signature===signature(92)),!future);
},(db,v)=>cached(db,v,future)));

for(const table of ["tenx_funding_scans","tenx_wallet_transactions"])test(`poisoned ${table} preserves original replay rejection and creates no publication`,()=>setup(async f=>{
  const original=await replayLegacyWallets(sqliteD1(f.db)),before=stable(f),result=complete(await run(f));assert.deepEqual(result.result,original);assert.equal((result.result.errors as unknown[]).length,1);assert.deepEqual(result.publications,[]);assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readdir(path.join(f.journal.directory,"pending")),[]);
},async(db,v)=>{await cached(db,v);db.exec(`UPDATE ${table} SET payload_hash='${"0".repeat(64)}'`);}));

test("late replay SQL failure rolls back receipt, candidate and profiles, retains intent and spent allowances",()=>setup(async f=>{
  const original=DatabaseSync.prototype.prepare,hook=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql.startsWith("INSERT INTO tenx_wallet_profiles"))throw Error("late_replay_fault");return original.call(this,sql);});
  const before=stable(f),result=complete(await run(f));assert.equal(result.publications[0]!.outcome.state,"held");assert.deepEqual(result.result.upgraded,[]);assert.deepEqual(stable(f),before);assert.equal((await fs.readdir(path.join(f.journal.directory,"pending"))).length,1);hook.mock.restore();const retry=complete(await run(f));assert.equal(retry.publications[0]!.outcome.state,"committed");assert.equal((retry.result.upgraded as unknown[]).length,1);
}));

test("lost replay acknowledgement stays unconfirmed; explicit read-only reconciliation recovers the commit",()=>setup(async f=>{
  const original=DatabaseSync.prototype.exec;let injected=false;const hook=mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){let stop=false;if(sql==="COMMIT"&&!injected){try{stop=!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(f.identities[0]!.publicationId);}catch{}}const result=original.call(this,sql);if(stop){injected=true;throw Error("ack_lost");}return result;});
  const result=complete(await run(f));assert.equal(injected,true);assert.deepEqual(result.result.upgraded,[]);assert.equal(result.publications[0]!.outcome.state,"held");hook.mock.restore();const before=stable(f),bytes=await fs.readFile(path.join(f.target,"metadata.sqlite")),recovered=await recoverEvidenceProducerBatch(f.options,f.journal,f.grant,{publicationId:f.identities[0]!.publicationId,mode:"reconcile"});assert.equal(recovered.state,"committed");assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),bytes);
}));

test("zero-row replay compare-and-swap remains committed and reports the original snapshot-changed result",()=>setup(async f=>{
  const originalDb=sqliteD1(f.db),raced=new Proxy(originalDb,{get(target,name){if(name==="batch")return async(statements:D1PreparedStatement[])=>{f.db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash',?)").run("0".repeat(64));return target.batch(statements);};const value=Reflect.get(target,name,target);return typeof value==="function"?value.bind(target):value;}}),original=await replayLegacyWallets(raced),values=expected(f),open=fs.open;let changed=false;
  mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){const handle=await open(name,flags,...args);if(!changed&&flags==="wx"&&String(name).startsWith(f.journal.directory)&&String(name).endsWith("ready.json")){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();changed=true;f.copy.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash',?)").run("0".repeat(64));};}return handle;});
  const result=complete(await run(f));assert.equal(changed,true);assert.deepEqual(result.result,original);compare(f,values);const outcome=result.publications[0]!.outcome;assert.equal(outcome.state,"committed");if(outcome.state==="committed")assert.equal(outcome.results[1]!.meta.changes,0);
}));

test("identities are required before execution and duplicate identities hold without SQL or staging",()=>setup(async f=>{
  const before=stable(f);for(const identities of [[],[f.identities[0]!,f.identities[0]!],[{...f.identities[0]!,publicationId:"invalid"}]])assert.equal((await replayLegacyWalletsOnEvidenceTarget(f.source,f.options,f.journal,f.grant,identities)).state,"held");assert.deepEqual(stable(f),before);assert.deepEqual(await fs.readdir(path.join(f.stage.directory,"pending")),[]);
}));

test("native cache/checkpoint/index reads are read-only, preserve exact bytes and distinguish absent from oversized rows",()=>setup(async f=>{
  const address=f.candidate.address,scan:FundingScan=FundingScanSchema.parse({wallet:key(8),anchor:{wallet:key(8),signature:signature(31),slot:10001,block_time:f.input.observed_at,kind:"sampled_buy"},lookback_seconds:3600,pages:[],examined:[],attempted_at:f.input.observed_at});
  f.copy.prepare("INSERT INTO tenx_wallet_transactions VALUES('raw','hash',?,?)").run("x\u0000é終",f.input.observed_at);for(const table of ["tenx_funding_scans","tenx_second_hop_scans"])f.copy.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?)`).run(address,scan.wallet,"legacy-key",JSON.stringify(scan),await hashJson(scan),scan.attempted_at);
  const before=await fs.readFile(path.join(f.target,"metadata.sqlite"));assert.deepEqual((await readEvidenceWalletMetadata(f.options,f.grant,{kind:"transaction",signature:"raw"})).row,{payload:"x\u0000é終",payload_hash:"hash",fetched_at:f.input.observed_at});for(const hop of ["direct","second"]){assert.equal((await readEvidenceWalletMetadata(f.options,f.grant,{kind:"checkpoint",hop,address,wallet:scan.wallet,anchor_signature:"legacy-key"})).row!.payload,JSON.stringify(scan));assert.equal((await readEvidenceWalletMetadata(f.options,f.grant,{kind:"checkpoint",hop,address,wallet:scan.wallet,anchor_signature:"missing"})).row,null);}assert.equal((await readEvidenceWalletMetadata(f.options,f.grant,{kind:"candidates"})).rows.length,1);assert.deepEqual(await fs.readFile(path.join(f.target,"metadata.sqlite")),before);
  f.copy.prepare("UPDATE tenx_wallet_transactions SET payload=? WHERE signature='raw'").run("é".repeat(125001));await assert.rejects(readEvidenceWalletMetadata(f.options,f.grant,{kind:"transaction",signature:"raw"}),/byte_bound/);await assert.rejects(readEvidenceWalletMetadata(f.options,f.grant,{kind:"sql",sql:"DELETE FROM tenx_usage"}));
  f.copy.prepare("UPDATE tenx_candidates SET payload=?").run(JSON.stringify({...f.candidate,symbol:"é".repeat(1000001)}));await assert.rejects(readEvidenceWalletMetadata(f.options,f.grant,{kind:"candidates"}),/byte_bound/);
}));

test("native wallet metadata and whole replay fence stale owners and wrong target pins before publication",()=>setup(async f=>{
  const before=stable(f),bad={...f.grant,epoch:f.grant.epoch+1};await assert.rejects(readEvidenceWalletMetadata(f.options,bad,{kind:"transaction",signature:"absent"}),/owner_fenced/);assert.equal((await replayLegacyWalletsOnEvidenceTarget(f.source,f.options,f.journal,bad,f.identities)).state,"held");assert.equal((await replayLegacyWalletsOnEvidenceTarget(f.source,{...f.options,targetPin:"0".repeat(64)},f.journal,f.grant,f.identities)).state,"held");assert.deepEqual(stable(f),before);
}));

test("receipt ownership is rechecked after complete frozen-source admission and all file IO",()=>setup(async f=>{
  const originalPrepare=DatabaseSync.prototype.prepare,open=fs.open;let sourceEnded=false,changing=false,changed=false;
  mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,sql:string){if(sql==="SELECT total_changes() AS n")sourceEnded=true;return originalPrepare.call(this,sql);});
  mock.method(fs,"open",async function(...[name,flags,...args]:Parameters<typeof fs.open>){if(sourceEnded&&!changing&&flags==="r"&&String(name).endsWith("publication.json")){changing=true;await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());changed=true;}return open(name,flags,...args);});
  await assert.rejects(readWalletReplayReceipt(f.source,f.options,f.grant,f.candidate.wallet_analysis!.evidence_hash,f.candidate.address),/owner_fenced/);assert.equal(changed,true);assert.deepEqual(rows(f.copy,"tenx_append_publications"),[]);
}));

test("source substitution and missing encrypted legacy payload hold before SQL instead of returning empty evidence",()=>setup(async f=>{
  const before=stable(f);await assert.rejects(readWalletReplayReceipt({...f.source,capacityPin:"0".repeat(64)},f.options,f.grant,f.candidate.wallet_analysis!.evidence_hash,f.candidate.address));
  const wrong=path.join(f.root,"wrong.key");await fs.writeFile(wrong,Buffer.alloc(32,7));await assert.rejects(readWalletReplayReceipt({...f.source,keyFile:wrong},f.options,f.grant,f.candidate.wallet_analysis!.evidence_hash,f.candidate.address));
  const refs=new DatabaseSync(path.join(f.source.referenceDirectory,"references.sqlite"),{readOnly:true});let descriptor;
  try{descriptor=JSON.parse(String(refs.prepare("SELECT reference_json FROM evidence_references WHERE table_name=? AND identity=?").get("tenx_wallet_evidence",f.candidate.wallet_analysis!.evidence_hash)!.reference_json)).sealed;}finally{refs.close();}
  const folder=await fs.realpath(f.source.sealedDirectory),file=path.join(folder,"objects",String(descriptor.sha256)+".bin");assert.ok(folder.startsWith((await fs.realpath(f.root))+path.sep));assert.equal(path.dirname(file),path.join(folder,"objects"));
  // Only the newly created synthetic fixture is made temporarily unavailable;
  // restore its original ciphertext before the fixture cleanup.
  await fs.rename(file,file+".held");try{await assert.rejects(readWalletReplayReceipt(f.source,f.options,f.grant,f.candidate.wallet_analysis!.evidence_hash,f.candidate.address));}finally{await fs.rename(file+".held",file);}assert.deepEqual(stable(f),before);
}));

test("caller source/target/grant/identity objects are snapshotted across asynchronous replay IO",()=>setup(async f=>{
  const source=structuredClone(f.source),options=structuredClone(f.options),grant={...f.grant},identities=structuredClone(f.identities),pending=replayLegacyWalletsOnEvidenceTarget(source,options,f.journal,grant,identities);source.capacityPin="0".repeat(64);options.targetPin="0".repeat(64);grant.epoch++;identities[0]!.publicationId=randomUUID();assert.equal(complete(await pending).publications[0]!.outcome.publication_id,f.identities[0]!.publicationId);
}));
