import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {toBase58,hashJson} from "./solana";
import {createElection,electionRecord,electionSummaries,replayElection} from "./elections";
import {ElectionStorageManifest,encodeElectionStorage,ELECTION_CHUNK_BYTES,ELECTION_INPUT_BYTES} from "./election-storage";
import {type Candidate} from "./model";
import {gateSample,signature} from "./wallet-fixtures.test-helper";

const opened:DatabaseSync[]=[],at=new Date("2026-10-21T00:00:00.000Z");
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
const opts={id:"daily-2026-10-21",kind:"daily" as const,reason:"Isolated storage recovery",now:at};
async function put(db:D1Database,c:Candidate){await db.prepare("INSERT OR REPLACE INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(c.address,c.pool,JSON.stringify(c),c.checked_at).run();}
async function inventory(db:D1Database,bytes=20000,count=90){
  const sample=await gateSample();
  // Valid synthetic bounded wallet/trade snapshots grow inputs, while the
  // unchanged engine still reports missing holders and stale wallet evidence.
  const wallet_analysis={...sample,trades:Array.from({length:Math.min(100,Math.ceil(bytes/600))},(_,i)=>({...sample.trades[0]!,signature:signature(i+1)}))};
  const base={...(await fixtureCandidates(at))[0]!,mode:"live" as const,wallet_analysis};
  for(let i=1;i<=count;i++)await put(db,{...base,address:toBase58(new Uint8Array(32).fill(i))});
  return base;
}
async function manifest(db:D1Database){const row=await db.prepare("SELECT inputs FROM tenx_election_runs WHERE id=?1").bind(opts.id).first<{inputs:string}>();return ElectionStorageManifest.parse(JSON.parse(row!.inputs));}

describe("bounded chunk storage for unchanged v1 election records",()=>{
  it("freezes every candidate above the old aggregate limit and replays with no source calls",async()=>{
    const {db}=setup();await inventory(db);const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network forbidden"));
    const record=await createElection(db,opts),stored=await manifest(db);
    expect(record.inputs.version).toBe("election-input-v1");expect(record.result.counts).toMatchObject({observed:90,eligible:0});expect(record.inputs.candidates).toHaveLength(90);
    expect(stored.input_bytes).toBeGreaterThan(1600000);expect(stored.chunks.length).toBeGreaterThan(1);expect(stored.chunks.length).toBeLessThanOrEqual(8);expect(stored.chunks.every(c=>c.bytes<=ELECTION_CHUNK_BYTES)).toBe(true);
    expect(await replayElection(record)).toMatchObject({status:"verified",provider_requests:0});expect(await electionRecord(db,opts.id)).toEqual(record);expect(await electionSummaries(db)).toHaveLength(1);expect(network).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT count(*) n FROM tenx_audit WHERE action='election_snapshot'").first()).toEqual({n:1});
  });
  it("uses the same portable hashes after inline or chunked storage",async()=>{
    const {db}=setup();await inventory(db,100,1);const record=await createElection(db,opts),text=JSON.stringify(record.inputs),inline=await encodeElectionStorage(text,record.input_hash),chunked=await encodeElectionStorage(text,record.input_hash,true);
    expect(inline.stored).toBe(text);expect(inline.chunks).toEqual([]);expect(chunked.chunks.map(c=>c.payload).join("")).toBe(text);expect(await hashJson(JSON.parse(text))).toBe(record.input_hash);
    expect(JSON.parse((await db.prepare("SELECT inputs FROM tenx_election_runs").first<{inputs:string}>())!.inputs).version).toBe("election-input-v1");
  });
  it("keeps UTF-8 boundary characters intact and enforces the complete-input cap",async()=>{
    const text="x".repeat(511999)+"🧪"+"x".repeat(1100000),encoded=await encodeElectionStorage(text,"a".repeat(64));
    expect(encoded.chunks[0]?.bytes).toBe(511999);expect(encoded.chunks.map(c=>c.payload).join("")).toBe(text);expect(encoded.chunks.some(c=>c.payload.includes("�"))).toBe(false);
    const maximum=await encodeElectionStorage("x".repeat(ELECTION_INPUT_BYTES),"a".repeat(64));expect(maximum.chunks).toHaveLength(8);
    await expect(encodeElectionStorage("x".repeat(ELECTION_INPUT_BYTES+1),"a".repeat(64))).rejects.toThrow("election_snapshot_size_limit");
  });
  it("retains original chunks on retries after the live inventory is gone",async()=>{
    const {db}=setup();await inventory(db);const first=await createElection(db,opts),saved=await manifest(db);await db.prepare("DELETE FROM tenx_candidates").run();
    expect(await createElection(db,{...opts,now:new Date("2026-10-22T00:00:00Z")})).toEqual(first);expect(await manifest(db)).toEqual(saved);expect(await db.prepare("SELECT count(*) n FROM tenx_audit").first()).toEqual({n:1});
  });
  it("rolls back parent, every chunk and audit if a middle chunk fails",async()=>{
    const {db,sqlite}=setup();await inventory(db);sqlite.exec("CREATE TRIGGER chunk_failure BEFORE INSERT ON tenx_election_chunks WHEN NEW.ordinal=1 BEGIN SELECT RAISE(ABORT,'chunk_write_failed'); END");
    await expect(createElection(db,opts)).rejects.toThrow("chunk_write_failed");for(const table of ["tenx_election_runs","tenx_election_chunks","tenx_audit"])expect(await db.prepare(`SELECT count(*) n FROM ${table}`).first()).toEqual({n:0});
  });
  it("rolls back chunks when the final audit fails",async()=>{
    const {db,sqlite}=setup();await inventory(db);sqlite.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON tenx_audit BEGIN SELECT RAISE(ABORT,'audit_write_failed'); END");
    await expect(createElection(db,opts)).rejects.toThrow("audit_write_failed");expect(await electionRecord(db,opts.id)).toBeNull();expect(await db.prepare("SELECT count(*) n FROM tenx_election_chunks").first()).toEqual({n:0});
  });
  it("enforces immutable parts and rejects an extra part not named in the manifest",async()=>{
    const {db}=setup();await inventory(db);await createElection(db,opts);
    await expect(db.prepare("UPDATE tenx_election_chunks SET payload='x'").run()).rejects.toThrow("immutable_election_chunk");await expect(db.prepare("DELETE FROM tenx_election_chunks").run()).rejects.toThrow("immutable_election_chunk");
    await expect(db.prepare("INSERT INTO tenx_election_chunks(run_id,ordinal,payload,payload_bytes,payload_hash) VALUES(?1,7,'x',1,?2)").bind(opts.id,await hashJson("x")).run()).rejects.toThrow("election_chunk_manifest_mismatch");
  });
  it.each(["missing","changed","extra","reordered_manifest","wrong_input_hash"])("fails closed on %s storage corruption",async kind=>{
    const {db,sqlite}=setup();await inventory(db);await createElection(db,opts);
    if(kind==="missing"){sqlite.exec("DROP TRIGGER tenx_election_chunks_no_delete");await db.prepare("DELETE FROM tenx_election_chunks WHERE ordinal=0").run();}
    if(kind==="changed"){sqlite.exec("DROP TRIGGER tenx_election_chunks_no_update");await db.prepare("UPDATE tenx_election_chunks SET payload='['||substr(payload,2) WHERE ordinal=0").run();}
    if(kind==="extra"){sqlite.exec("DROP TRIGGER tenx_election_chunks_manifest");await db.prepare("INSERT INTO tenx_election_chunks(run_id,ordinal,payload,payload_bytes,payload_hash) VALUES(?1,7,'x',1,?2)").bind(opts.id,await hashJson("x")).run();}
    if(kind==="reordered_manifest"||kind==="wrong_input_hash"){
      sqlite.exec("DROP TRIGGER tenx_election_runs_no_update");const value=await manifest(db);if(kind==="reordered_manifest")value.chunks.reverse();else value.input_hash="b".repeat(64);
      await db.prepare("UPDATE tenx_election_runs SET inputs=?1").bind(JSON.stringify(value)).run();
    }
    await expect(electionRecord(db,opts.id)).rejects.toThrow(/election_chunk_/);
  });
  it("keeps the winning inline race record and cannot attach the loser's chunks",async()=>{
    const {db}=setup();const base=await inventory(db);const batch=db.batch.bind(db);let raced=false;
    db.batch=async statements=>{
      if(!raced){raced=true;await db.prepare("DELETE FROM tenx_candidates").run();await put(db,{...base,verification_reasons:[]});await createElection(db,opts);}
      return batch(statements);
    };
    const result=await createElection(db,opts);expect(result.result.counts.observed).toBe(1);expect(await db.prepare("SELECT count(*) n FROM tenx_election_chunks").first()).toEqual({n:0});expect(await db.prepare("SELECT count(*) n FROM tenx_audit").first()).toEqual({n:1});
  },15000);
  it("keeps an independent chunked winner on a concurrent same-ID attempt",async()=>{
    const {db}=setup();await inventory(db);const batch=db.batch.bind(db);let raced=false;
    db.batch=async statements=>{
      if(!raced){raced=true;await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.name','Winning snapshot')").run();await createElection(db,opts);}
      return batch(statements);
    };
    const result=await createElection(db,opts);expect(result.inputs.candidates.every(c=>c.name==="Winning snapshot")).toBe(true);expect(await replayElection(result)).toMatchObject({status:"verified"});expect(await db.prepare("SELECT count(*) n FROM tenx_audit").first()).toEqual({n:1});
  },15000);
  it("bounds the aggregate inventory before attempting to decode it",async()=>{
    const {db}=setup();for(let i=0;i<3;i++)await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,'pool',?2,?3)").bind(`oversized${i}`,"x".repeat(1500000),at.toISOString()).run();
    await expect(createElection(db,opts)).rejects.toThrow("election_snapshot_size_limit");expect(await electionSummaries(db)).toEqual([]);
  });
  it("keeps a decision list above the previous 200 KB guard within a bounded run row",async()=>{
    const {db}=setup(),base={...(await fixtureCandidates(at))[0]!,mode:"live" as const,name:"n".repeat(100),symbol:"s".repeat(32)};
    const padding=Math.max(0,3140-new TextEncoder().encode(JSON.stringify(base)).length-10);
    base.verification_reasons=["x".repeat(padding)];
    // 500 distinct valid addresses without relaxing any eligibility checks.
    for(let i=0;i<500;i++){const key=new Uint8Array(32);new DataView(key.buffer).setUint32(0,i+1);await put(db,{...base,address:toBase58(key)});}
    const result=await createElection(db,opts);expect(new TextEncoder().encode(JSON.stringify(result.result)).length).toBeGreaterThan(200000);expect(result.result.counts.observed).toBe(500);expect(result.result.counts.eligible).toBe(0);expect(await replayElection(result)).toMatchObject({status:"verified"});
    const row=await db.prepare("SELECT length(CAST(inputs AS BLOB))+length(CAST(summary AS BLOB)) bytes FROM tenx_election_runs").first<{bytes:number}>();expect(row!.bytes).toBeLessThanOrEqual(1800000);
    // Chunk even sub-1.6 MB inputs when input + decision bytes exceed the row guard.
    expect((await manifest(db)).input_bytes).toBeLessThanOrEqual(1600000);
  });
});
