import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdir,mkdtemp,readFile,writeFile,realpath,rm,stat} from "node:fs/promises";
import path from "node:path";
import {exportArchive,hashFile} from "./discovery-archive.mjs";
import {packEvidenceObjects} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects} from "./discovery-evidence-sealed.mjs";
import {buildEvidenceIndex} from "./discovery-evidence-index.mjs";
import {buildEvidenceReferences} from "./discovery-evidence-references.mjs";
import {studyMetadataCapacity} from "./discovery-metadata-capacity.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {scratchEvidenceReadStore} from "./lib/evidence-scratch-read-store";
import {runEvidenceReadParity} from "./discovery-evidence-read-parity";
import {holderAcquisitionFixture} from "../discovery/src/holder-acquisition-fixtures.test-helper";
import {holderHistoryInputsFromStore} from "../discovery/src/holder-history-store";
import {holderAcquisitionInputsFromStore} from "../discovery/src/holder-acquisition-store";
import {reviewHolderAcquisition} from "../discovery/src/holder-acquisition";
import {d1EvidenceReadStore} from "../discovery/src/evidence-read-store";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {holderKey} from "../discovery/src/holder-history-fixtures.test-helper";
import {hashJson} from "../discovery/src/solana";
import {priorWalletEvidenceFromStore} from "../discovery/src/wallet-work";
import {walletHolderInputFromStore} from "../discovery/src/wallet-cycle";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {analyzeWalletEvidence,WalletEvidenceSchema} from "../discovery/src/wallet-analysis";
import {analyzeHolders,HolderEvidenceSchema,type HolderEvidence} from "../discovery/src/holders";
import type {Candidate} from "../discovery/src/model";

type Options={capacityDirectory:string;capacityPin:string;referenceDirectory:string;referencePin:string;sealedDirectory:string;keyFile:string};
async function fixture(work:(f:{root:string;db:DatabaseSync;input:Awaited<ReturnType<typeof holderAcquisitionFixture>>;options:Options;args:string[]})=>Promise<void>,alter?:(db:DatabaseSync,input:Awaited<ReturnType<typeof holderAcquisitionFixture>>)=>void|Promise<void>){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","evidence-read-test-")),file=path.join(root,"source.sqlite"),db=new DatabaseSync(file);
  try{
    db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY);CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY,state TEXT);
      INSERT INTO tenx_source_reservations VALUES('spent','failed');CREATE TABLE tenx_holder_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);CREATE TABLE tenx_wallet_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);`);
    const input=await holderAcquisitionFixture();for(const m of input.history.index)db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(m.payload_hash,m.address,m.slot,JSON.stringify(input.history.samples.find(s=>s.payload_hash===m.payload_hash)!.evidence),m.observed_at);
    const wallet=input.wallet_index[0]!;db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(wallet.evidence_hash,wallet.address,JSON.stringify(input.wallet!.evidence),wallet.observed_at);await alter?.(db,input);
    const archive=path.join(root,"archive"),a=await exportArchive(file,archive),objects=path.join(root,"objects"),o=await packEvidenceObjects(archive,a.manifest_sha256,objects),keys=path.join(root,"keys");await mkdir(keys);const keyFile=path.join(keys,"key.bin");await createEvidenceKey(keyFile);
    const sealedDirectory=path.join(root,"sealed"),s=await sealEvidenceObjects(objects,o.catalog_manifest_sha256,keyFile,sealedDirectory),index=path.join(root,"index"),i=await buildEvidenceIndex(sealedDirectory,s.sealed_manifest_sha256,keyFile,index),referenceDirectory=path.join(root,"references"),r=await buildEvidenceReferences(index,i.index_manifest_sha256,referenceDirectory),capacityDirectory=path.join(root,"capacity"),c=await studyMetadataCapacity(archive,a.manifest_sha256,referenceDirectory,r.reference_manifest_sha256,capacityDirectory);
    const options={capacityDirectory,capacityPin:c.capacity_manifest_sha256,referenceDirectory,referencePin:r.reference_manifest_sha256,sealedDirectory,keyFile};
    await work({root,db,input,options,args:[archive,a.manifest_sha256,capacityDirectory,c.capacity_manifest_sha256,referenceDirectory,r.reference_manifest_sha256,sealedDirectory,keyFile,path.join(root,"parity")]});
    assert.equal(await hashFile(path.join(archive,"discovery.sqlite")),a.database.sha256);
  }finally{db.close();const actual=await realpath(root),base=await realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("evidence-read-test-"));await rm(actual,{recursive:true,force:true});}
}

test("shared application reads preserve original inputs/reports over encrypted metadata and exact source rows",()=>fixture(async({db,input,options,args})=>{
  const ordinary=d1EvidenceReadStore(sqliteD1(db)),at=new Date(input.history.cutoff_at);
  assert.deepEqual(await holderAcquisitionInputsFromStore(ordinary,input.history.address,at),input);
  await withScratchEvidenceResolver(options,async reader=>{
    const rebuilt=await holderAcquisitionInputsFromStore(scratchEvidenceReadStore(reader),input.history.address,at);
    assert.deepEqual(rebuilt,input);assert.deepEqual(await reviewHolderAcquisition(rebuilt),await reviewHolderAcquisition(input));assert.equal(reader.statistics().resolved_rows,4);
    assert.equal(reader.sqlite.prepare("SELECT state FROM tenx_source_reservations").get()!.state,"failed");return null;
  });
  const result=await runEvidenceReadParity(args);assert.equal(result.cases,1);assert.equal(result.reviewed,1);assert.equal(result.held,0);assert.equal(result.database_writes,0);assert.equal(result.provider_requests,0);
  const report=JSON.parse(await readFile(path.join(args[8]!,"read-parity.json"),"utf8"));assert.equal(report.cases[0].meaningful_growth_held,true);assert.equal(report.cases[0].organic_demand_held,true);assert.equal(report.operational_adoption_accepted,false);
}));

async function candidateFor(input:Awaited<ReturnType<typeof holderAcquisitionFixture>>):Promise<Candidate>{
  function assertHolder(raw:unknown):asserts raw is HolderEvidence{HolderEvidenceSchema.parse(raw);}
  const wallet=WalletEvidenceSchema.parse(input.wallet!.evidence),meta=input.history.index[0]!,holder=input.history.samples[0]!.evidence;assertHolder(holder);
  return {...(await fixtureCandidates(new Date(input.history.cutoff_at)))[0]!,address:input.history.address,pool:wallet.asset.pool,creation:wallet.asset.creation,graduation:wallet.asset.graduation,
    holders:await analyzeHolders(holder,meta.observed_at),wallet_analysis:await analyzeWalletEvidence(wallet)};
}
test("all exact-hash receipt reads preserve full rows and payload bytes with optional mint scope",()=>fixture(async({db,input,options})=>{
  const ordinary=d1EvidenceReadStore(sqliteD1(db));await withScratchEvidenceResolver(options,async reader=>{
    const compact=scratchEvidenceReadStore(reader);
    for(const meta of input.history.index){const before=await ordinary.holderReceipt(meta.payload_hash),after=await compact.holderReceipt(meta.payload_hash);assert.equal(await hashJson(before),await hashJson(after));assert.equal(after!.payload,before!.payload);assert.equal(await hashJson(await compact.holderReceipt(meta.payload_hash,meta.address)),await hashJson(before));}
    const meta=input.wallet_index[0]!,before=await ordinary.walletReceipt(meta.evidence_hash),after=await compact.walletReceipt(meta.evidence_hash,meta.address);assert.equal(await hashJson(before),await hashJson(after));assert.equal(after!.payload,before!.payload);return null;
  });
}));
test("absent frozen rows and wrong mint scope return null without resolving an object; missing proof still holds",()=>fixture(async({db,input,options})=>{
  const ordinary=d1EvidenceReadStore(sqliteD1(db));await withScratchEvidenceResolver(options,async reader=>{
    const compact=scratchEvidenceReadStore(reader);
    for(const store of [ordinary,compact]){assert.equal(await store.holderReceipt("0".repeat(64)),null);assert.equal(await store.walletReceipt("0".repeat(64)),null);assert.equal(await store.holderReceipt(input.history.index[0]!.payload_hash,holderKey(201)),null);assert.equal(await store.walletReceipt(input.wallet_index[0]!.evidence_hash,holderKey(201)),null);}
    assert.throws(()=>reader.describe("tenx_holder_evidence","0".repeat(64)),/no_absence_proof/);assert.equal(reader.statistics().resolution_attempts,0);return null;
  });
}));
test("candidate wallet continuation and holder-cycle inputs retain replay, scope and missing-evidence checks",()=>fixture(async({db,input,options})=>{
  const candidate=await candidateFor(input),ordinary=d1EvidenceReadStore(sqliteD1(db));await withScratchEvidenceResolver(options,async reader=>{
    const compact=scratchEvidenceReadStore(reader);
    for(const store of [ordinary,compact]){
      assert.deepEqual(await priorWalletEvidenceFromStore(store,candidate),WalletEvidenceSchema.parse(input.wallet!.evidence));
      const held=await walletHolderInputFromStore(store,candidate);assert.ok(held);assert.equal(await hashJson(held),await hashJson(await walletHolderInputFromStore(ordinary,candidate)));
      assert.equal(await priorWalletEvidenceFromStore(store,{...candidate,wallet_analysis:null}),null);assert.equal(await walletHolderInputFromStore(store,{...candidate,holders:null}),null);
      await assert.rejects(priorWalletEvidenceFromStore(store,{...candidate,wallet_analysis:{...candidate.wallet_analysis!,evidence_hash:"0".repeat(64)}}),/cache_missing/);
      await assert.rejects(priorWalletEvidenceFromStore(store,{...candidate,pool:holderKey(201)}),/asset_mismatch/);
      const changed=structuredClone(candidate);changed.wallet_analysis!.metrics.distinct_buyers++;await assert.rejects(priorWalletEvidenceFromStore(store,changed),/replay_mismatch/);
      assert.equal(await walletHolderInputFromStore(store,{...candidate,holders:{...candidate.holders!,payload_hash:"0".repeat(64)}}),null);
    }return null;
  });
}));
test("complete parity includes every retained receipt and candidate continuation",()=>fixture(async({args})=>{
  const result=await runEvidenceReadParity(args),report=JSON.parse(await readFile(path.join(args[8]!,"read-parity.json"),"utf8"));assert.equal(result.receipts,4);assert.equal(result.continuations,1);assert.equal(result.continuations_held,0);assert.equal(report.version,"discovery-evidence-read-parity-v2");assert.equal(report.candidate_payload_column_present,true);assert.ok(report.receipt_comparisons.every((r:{identical:boolean})=>r.identical));
},async(db,input)=>{db.exec("ALTER TABLE tenx_candidates ADD COLUMN payload TEXT");const candidate=await candidateFor(input);db.prepare("INSERT INTO tenx_candidates VALUES(?,?)").run(candidate.address,JSON.stringify(candidate));}));
test("raw exact-hash lookup never converts an existing corrupt encrypted object into a missing row",()=>fixture(async({options,input})=>{
  const db=new DatabaseSync(path.join(options.referenceDirectory,"references.sqlite"),{readOnly:true}),ref=JSON.parse(String(db.prepare("SELECT reference_json FROM evidence_references WHERE table_name='tenx_wallet_evidence'").get()!.reference_json));db.close();
  const file=path.join(options.sealedDirectory,"objects",ref.sealed.sha256+".bin"),bytes=await readFile(file);bytes[0]^=1;await writeFile(file,bytes);
  await assert.rejects(withScratchEvidenceResolver(options,async reader=>scratchEvidenceReadStore(reader).walletReceipt(input.wallet_index[0]!.evidence_hash)));
}));
test("malformed stored holder inputs stay rejected by the unchanged wallet-cycle schema",()=>fixture(async({input,options,db})=>{
  const candidate=await candidateFor(input);await withScratchEvidenceResolver(options,async reader=>{
    for(const store of [d1EvidenceReadStore(sqliteD1(db)),scratchEvidenceReadStore(reader)])await assert.rejects(walletHolderInputFromStore(store,candidate));return null;
  });
},db=>{db.exec("UPDATE tenx_holder_evidence SET payload='{}'");}));

test("bounded indexes preserve cutoffs, deterministic order and ambiguous latest wallet holds",()=>fixture(async({db,input,options})=>{
  const ordinary=d1EvidenceReadStore(sqliteD1(db));await withScratchEvidenceResolver(options,async reader=>{
    const compact=scratchEvidenceReadStore(reader),address=input.history.address;
    for(const time of ["2026-10-20T00:00:00.000Z","2026-10-21T08:40:00.000Z",input.history.cutoff_at]){
      const a=await holderAcquisitionInputsFromStore(ordinary,address,new Date(time)),b=await holderAcquisitionInputsFromStore(compact,address,new Date(time));assert.deepEqual(b,a);
      if(time===input.history.cutoff_at)assert.equal(b.wallet,null);
    }return null;
  });
},db=>{const row=db.prepare("SELECT * FROM tenx_wallet_evidence").get()!;db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run("f".repeat(64),row.address,row.payload,row.observed_at);}));

test("archive exhaustion preserves limited history without resolving or crediting truncated samples",()=>fixture(async({options,input})=>{
  await withScratchEvidenceResolver(options,async reader=>{
    const rebuilt=await holderHistoryInputsFromStore(scratchEvidenceReadStore(reader),input.history.address,new Date(input.history.cutoff_at));
    assert.equal(rebuilt.index.length,97);assert.equal(rebuilt.samples.length,0);assert.equal(reader.statistics().resolution_attempts,0);return null;
  });
},db=>{const row=db.prepare("SELECT * FROM tenx_holder_evidence LIMIT 1").get()!;db.exec("DELETE FROM tenx_holder_evidence");for(let n=0;n<98;n++)db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(n.toString(16).padStart(64,"0"),row.address,n,row.payload,new Date(Date.parse("2026-10-21T07:00:00Z")+n*60000).toISOString());}));

test("metadata identity, sizes and missing-reference checks reject before payload decryption",()=>fixture(async({options,input})=>{
  await withScratchEvidenceResolver(options,async reader=>{
    const store=scratchEvidenceReadStore(reader),h=input.history.index[0]!,w=input.wallet_index[0]!;
    assert.equal(await store.holderPayload({...h,slot:h.slot+1},3000000),null);assert.equal(await store.holderPayload({...h,address:holderKey(201)},3000000),null);
    assert.equal(await store.walletPayload({...w,observed_at:"2026-10-21T09:04:00.000Z"},1800000),null);
    assert.equal(await store.walletPayload(w,w.bytes-1),null);assert.equal(await store.holderPayload({...h,bytes:h.bytes+1},3000000),null);
    await assert.rejects(store.holderPayload(h,NaN),/byte_bound/);await assert.rejects(store.holderPayload({...h,payload_hash:"0".repeat(64)},3000000),/no_absence_proof/);
    assert.throws(()=>reader.describe("unknown",h.payload_hash),/unsupported/);const description=reader.describe("tenx_holder_evidence",h.payload_hash);assert.ok(Object.isFrozen(description));
    await assert.rejects(holderHistoryInputsFromStore({...store,holderIndex:async()=>[{...h,address:holderKey(201)}]},input.history.address,new Date(input.history.cutoff_at)),/index_mismatch/);
    await assert.rejects(holderAcquisitionInputsFromStore({...store,walletIndex:async()=>[{...w,address:holderKey(201)}]},input.history.address,new Date(input.history.cutoff_at),input.history),/wallet_identity/);
    assert.equal(reader.statistics().resolution_attempts,0);assert.deepEqual(Object.keys(store).sort(),["holderIndex","holderPayload","holderReceipt","walletIndex","walletPayload","walletReceipt"]);return null;
  });
}));

test("authenticated malformed receipts retain identical held outcomes rather than disappearing or passing",()=>fixture(async({args})=>{
  const result=await runEvidenceReadParity(args);assert.equal(result.cases,1);assert.equal(result.held,1);assert.equal(result.reviewed,0);assert.equal(result.all_cases_identical,true);
},db=>{db.exec("UPDATE tenx_holder_evidence SET payload='{}'");}));

test("selected ciphertext corruption cannot produce a matching or successful comparison report",()=>fixture(async({root,options,args})=>{
  const db=new DatabaseSync(path.join(options.referenceDirectory,"references.sqlite"),{readOnly:true});const row=db.prepare("SELECT reference_json FROM evidence_references WHERE table_name='tenx_holder_evidence' LIMIT 1").get()!;db.close();
  const ref=JSON.parse(String(row.reference_json)),file=path.join(options.sealedDirectory,"objects",ref.sealed.sha256+".bin"),bytes=await readFile(file);bytes[0]^=1;await writeFile(file,bytes);
  await assert.rejects(runEvidenceReadParity(args),/semantics_mismatch/);await assert.rejects(stat(path.join(root,"parity","read-parity.json")),/ENOENT/);
}));

test("wrong source pins, nested outputs and existing reports hold without overwriting evidence",()=>fixture(async({root,args})=>{
  const wrong=[...args];wrong[1]="0".repeat(64);await assert.rejects(runEvidenceReadParity(wrong));await assert.rejects(runEvidenceReadParity([...args.slice(0,-1),path.join(args[2]!,"nested")]),/separate/);
  await mkdir(args[8]!);await writeFile(path.join(args[8]!,"retained"),"private partial");await assert.rejects(runEvidenceReadParity(args),/EEXIST/);assert.equal(await readFile(path.join(root,"parity","retained"),"utf8"),"private partial");
}));
