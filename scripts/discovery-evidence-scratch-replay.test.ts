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
import {runScratchReplay} from "./discovery-evidence-scratch-replay";
import {scratchCandidateReplayer,type ScratchResolver} from "./lib/evidence-scratch-replay";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {holderHistoryFixture} from "../discovery/src/holder-history-fixtures.test-helper";
import {walletInput} from "../discovery/src/wallet-fixtures.test-helper";
import {analyzeHolders} from "../discovery/src/holders";
import {analyzeWalletEvidence} from "../discovery/src/wallet-analysis";
import {defaultScoreInput,freezeDiscoveryScore} from "../discovery/src/discovery-score";
import {defaultScoreInputV2,freezeDiscoveryScoreV2} from "../discovery/src/discovery-score-v2";
import {defaultScoreInputV4,freezeDiscoveryScoreV4} from "../discovery/src/discovery-score-v4";
import {freezeScoreCohort} from "../discovery/src/score-research-analysis";
import {freezeElection,evaluateElection} from "../discovery/src/elections";
import {encodeElectionStorage} from "../discovery/src/election-storage";
import {hashJson} from "../discovery/src/solana";
import type {Candidate} from "../discovery/src/model";
type Options={capacityDirectory:string;capacityPin:string;referenceDirectory:string;referencePin:string;sealedDirectory:string;keyFile:string};
async function fixture(run:(f:{root:string;options:Options;args:string[];candidate:Candidate;holderHash:string;walletHash:string})=>Promise<void>,alter?:(c:Candidate)=>void,finalize?:(db:DatabaseSync)=>void){
  await mkdir(".tmp",{recursive:true});const root=await mkdtemp(path.resolve(".tmp","scratch-replay-test-")),file=path.join(root,"source.sqlite"),db=new DatabaseSync(file);
  try{
    db.exec(`CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);
      CREATE TABLE tenx_score_cohorts(address TEXT,model TEXT,captured_at TEXT,payload TEXT,PRIMARY KEY(address,model));CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY,state TEXT);
      INSERT INTO tenx_source_reservations VALUES('failed-spent','failed');
      CREATE TABLE tenx_holder_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,slot INTEGER,payload TEXT,observed_at TEXT);
      CREATE TABLE tenx_wallet_evidence(payload_hash TEXT PRIMARY KEY,address TEXT,payload TEXT,observed_at TEXT);
      CREATE TABLE tenx_election_runs(id TEXT PRIMARY KEY,kind TEXT,created_at TEXT,summary TEXT,inputs TEXT);
      CREATE TABLE tenx_election_chunks(run_id TEXT,ordinal INTEGER,payload TEXT,payload_bytes INTEGER,payload_hash TEXT,PRIMARY KEY(run_id,ordinal));`);
    const wallet=await walletInput(),at=new Date(wallet.observed_at),holder=(await holderHistoryFixture()).samples[0]!.evidence as Parameters<typeof analyzeHolders>[0];
    const h=await analyzeHolders(holder,at.toISOString()),w=await analyzeWalletEvidence(wallet),candidate:Candidate={...(await fixtureCandidates(at))[0]!,mode:"live",holders:h,wallet_analysis:w};
    db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(h.payload_hash,candidate.address,h.context_slot,JSON.stringify(holder),h.observed_at);
    db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(w.evidence_hash,candidate.address,JSON.stringify(wallet),w.observed_at);alter?.(candidate);
    for(const record of [await freezeDiscoveryScore(defaultScoreInput(candidate,at)),await freezeDiscoveryScoreV2(defaultScoreInputV2(candidate,at)),await freezeDiscoveryScoreV4(defaultScoreInputV4(candidate,at))]){
      const cohort=await freezeScoreCohort(record);db.prepare("INSERT INTO tenx_score_cohorts VALUES(?,?,?,?)").run(candidate.address,cohort.summary.score.version,cohort.summary.captured_at,JSON.stringify(cohort));
    }
    for(const chunked of [false,true]){
      const inputs=freezeElection([candidate],at),result=evaluateElection(inputs),meta={id:chunked?"manual-00000000-0000-4000-8000-000000000001":`daily-${at.toISOString().slice(0,10)}`,kind:chunked?"manual":"daily",day:at.toISOString().slice(0,10),created_at:at.toISOString(),input_hash:await hashJson(inputs),result_hash:await hashJson(result)};
      const summary={...meta,record_hash:await hashJson(meta),result},storage=await encodeElectionStorage(JSON.stringify(inputs),meta.input_hash,chunked);
      db.prepare("INSERT INTO tenx_election_runs VALUES(?,?,?,?,?)").run(meta.id,meta.kind,meta.created_at,JSON.stringify(summary),storage.stored);
      for(const c of storage.chunks)db.prepare("INSERT INTO tenx_election_chunks VALUES(?,?,?,?,?)").run(meta.id,c.ordinal,c.payload,c.bytes,c.payload_hash);
    }
    finalize?.(db);
    const archive=path.join(root,"archive"),a=await exportArchive(file,archive),objects=path.join(root,"objects"),o=await packEvidenceObjects(archive,a.manifest_sha256,objects),keyFile=path.join(root,"key.bin");
    await createEvidenceKey(keyFile);const sealedDirectory=path.join(root,"sealed"),s=await sealEvidenceObjects(objects,o.catalog_manifest_sha256,keyFile,sealedDirectory),index=path.join(root,"index"),i=await buildEvidenceIndex(sealedDirectory,s.sealed_manifest_sha256,keyFile,index);
    const referenceDirectory=path.join(root,"references"),r=await buildEvidenceReferences(index,i.index_manifest_sha256,referenceDirectory),capacityDirectory=path.join(root,"capacity"),c=await studyMetadataCapacity(archive,a.manifest_sha256,referenceDirectory,r.reference_manifest_sha256,capacityDirectory);
    const options={capacityDirectory,capacityPin:c.capacity_manifest_sha256,referenceDirectory,referencePin:r.reference_manifest_sha256,sealedDirectory,keyFile};
    await run({root,options,args:[capacityDirectory,c.capacity_manifest_sha256,referenceDirectory,r.reference_manifest_sha256,sealedDirectory,keyFile,path.join(root,"replay")],candidate,holderHash:h.payload_hash!,walletHash:w.evidence_hash});
    assert.equal(await hashFile(path.join(archive,"discovery.sqlite")),a.database.sha256);
  }finally{db.close();const actual=await realpath(root),base=await realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("scratch-replay-test-"));await rm(actual,{recursive:true,force:true});}
}
test("resolver reconstructs frozen v1/v2/v4 cohorts and inline/chunked elections with original hashes and no source writes",()=>fixture(async({args})=>{
  const r=await runScratchReplay(args),report=JSON.parse(await readFile(path.join(args[6]!,"replay.json"),"utf8"));
  assert.equal(r.status,"verified");assert.equal(r.cohorts,3);assert.equal(r.elections,2);assert.equal(r.held_records,0);assert.equal(r.resolved_rows,2);assert.ok(r.raw_payload_bytes>0);
  assert.equal(report.value.analysis.regenerated_analyses,2);assert.equal(report.database_writes,0);assert.equal(report.network_attempts,0);assert.equal(report.statistics.plaintext_payloads_cached,0);assert.equal(report.production_adoption_accepted,false);
  await assert.rejects(runScratchReplay(args),/EEXIST/);await assert.rejects(runScratchReplay([...args.slice(0,-1),path.join(args[0]!,"nested")]),/separate/);
}));
test("missing frozen receipt references remain held for every original record instead of disappearing from results",()=>fixture(async({args})=>{
  const r=await runScratchReplay(args),report=JSON.parse(await readFile(path.join(args[6]!,"replay.json"),"utf8"));
  assert.equal(r.status,"held");assert.equal(r.cohorts,3);assert.equal(r.elections,2);assert.equal(r.held_records,5);assert.ok(report.value.cohorts.every((c:{original_replay:string})=>c.original_replay==="verified"));
},c=>{c.holders!.payload_hash="f".repeat(64);}));
test("regenerated-analysis disagreement cannot be substituted into frozen scores or elections",()=>fixture(async({args})=>{
  const r=await runScratchReplay(args),report=JSON.parse(await readFile(path.join(args[6]!,"replay.json"),"utf8"));assert.equal(r.status,"held");assert.equal(r.held_records,5);
  assert.ok(report.value.cohorts.every((c:{held_reason:string})=>c.held_reason==="scratch_original_analysis_mismatch"));
},c=>{c.holders!.holder_count++;}));
test("closed admission rejects wrong pins/keys, co-located keys, corrupt catalog and invalid identities",()=>fixture(async({root,options,holderHash})=>{
  await assert.rejects(withScratchEvidenceResolver({...options,capacityPin:"0".repeat(64)},async()=>null));
  await assert.rejects(withScratchEvidenceResolver({...options,referencePin:"0".repeat(64)},async()=>null));
  const wrong=path.join(root,"wrong.bin");await createEvidenceKey(wrong);await assert.rejects(withScratchEvidenceResolver({...options,keyFile:wrong},async()=>null));
  const internal=path.join(options.capacityDirectory,"key.bin");await writeFile(internal,await readFile(options.keyFile));await assert.rejects(withScratchEvidenceResolver({...options,keyFile:internal},async()=>null),/separate_key/);
  await withScratchEvidenceResolver(options,async reader=>{assert.throws(()=>reader.sqlite.exec("UPDATE tenx_source_reservations SET state='fresh'"));await assert.rejects(reader.resolve("unknown",holderHash));await assert.rejects(reader.resolve("tenx_holder_evidence","missing"),/no_absence_proof/);return null;});
  const catalog=path.join(options.sealedDirectory,"catalog.bin"),bytes=await readFile(catalog);bytes[0]^=1;await writeFile(catalog,bytes);await assert.rejects(withScratchEvidenceResolver(options,async()=>null));
}));
test("ciphertext corruption and changed frozen inputs prevent selected/session results from being released",()=>fixture(async({options,holderHash})=>{
  const db=new DatabaseSync(path.join(options.referenceDirectory,"references.sqlite"),{readOnly:true});const ref=JSON.parse(String(db.prepare("SELECT reference_json FROM evidence_references WHERE table_name='tenx_holder_evidence'").get()!.reference_json));db.close();
  const object=path.join(options.sealedDirectory,"objects",ref.sealed.sha256+".bin"),original=await readFile(object),bad=Buffer.from(original);bad[0]^=1;await writeFile(object,bad);
  await assert.rejects(withScratchEvidenceResolver(options,async reader=>reader.resolve("tenx_holder_evidence",holderHash)));await writeFile(object,original);
  let released=false;await assert.rejects(withScratchEvidenceResolver(options,async reader=>{await reader.resolve("tenx_holder_evidence",holderHash);const catalog=path.join(options.sealedDirectory,"catalog.bin"),bytes=await readFile(catalog);bytes[0]^=1;await writeFile(catalog,bytes);return "must not release";}).then(()=>{released=true;}),/frozen_input_changed/);assert.equal(released,false);
}));
test("candidate scope/time mismatches and absent receipt identities cannot use the analysis cache",()=>fixture(async({options,candidate})=>{
  await withScratchEvidenceResolver(options,async reader=>{
    const r=scratchCandidateReplayer(reader as unknown as ScratchResolver);await r.rebuild(candidate,candidate.checked_at);
    await assert.rejects(r.rebuild({...candidate,pool:(await fixtureCandidates())[1]!.address},candidate.checked_at),/scope/);
    await assert.rejects(r.rebuild(candidate,new Date(Date.parse(candidate.checked_at)-1).toISOString()),/future_receipt/);
    await assert.rejects(r.rebuild({...candidate,holders:{...candidate.holders!,payload_hash:null}},candidate.checked_at),/without_receipt/);
    await r.rebuild({...candidate,holders:null,wallet_analysis:null},candidate.checked_at);assert.equal(r.statistics().candidates_without_receipts,1);return null;
  });
}));
test("an admitted but empty replay population cannot produce a verified completion report",()=>fixture(async({args})=>{
  await assert.rejects(runScratchReplay(args),/population_missing/);await assert.rejects(stat(path.join(args[6]!,"replay.json")),/ENOENT/);assert.ok((await stat(args[6]!)).isDirectory());
},undefined,db=>{db.exec("DELETE FROM tenx_score_cohorts");}));
