import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {candidateExpiry,expireCandidates,inventoryStatus} from "./candidate-expiry";
import {candidates,saveCandidate} from "./store";
import {createElection,electionRecord,replayElection} from "./elections";
import {hashJson,toBase58} from "./solana";
import {handle,type LocalEnv} from "./worker";
import type {Candidate} from "./model";

const opened:DatabaseSync[]=[],at=new Date("2026-10-21T00:00:00.000Z"),later=new Date(at.getTime()+23*3600000+1);
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
function address(i:number){const bytes=new Uint8Array(32);new DataView(bytes.buffer).setUint32(0,i);bytes[31]=1;return toBase58(bytes);}
function variant(c:Candidate,i:number){const bytes=new Uint8Array(64);new DataView(bytes.buffer).setUint32(0,i);bytes[63]=1;return {...c,mode:"live" as const,address:address(i),creation:c.creation?{...c.creation,signature:toBase58(bytes)}:null};}
async function sample(i=1){return variant((await fixtureCandidates(at))[0]!,i);}
async function put(db:D1Database,c:Candidate,proof=true){
  await db.prepare("INSERT OR REPLACE INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?1,?2,?3,?4,?5)").bind(c.mode,c.address,c.pool,JSON.stringify(c),c.checked_at).run();
  if(proof&&c.creation)await db.prepare("INSERT OR REPLACE INTO tenx_proofs(address,kind,signature,instruction_index,slot,payload_hash,payload) VALUES(?1,'creation',?2,?3,?4,?5,?6)").bind(c.address,c.creation.signature,c.creation.instruction_index,c.creation.slot,c.creation.payload_hash,JSON.stringify(c.creation)).run();
}
describe("verified creation expiry with retained evidence",()=>{
  it("expires strictly after 24h and retains unresolved, future, fixture and unmatched proof rows",async()=>{
    const {db}=setup(),base=await sample();await put(db,base);
    await put(db,{...await sample(2),creation:null});
    const future=await sample(3);await put(db,{...future,creation:{...future.creation!,block_time:new Date(later.getTime()+1).toISOString()}});
    await put(db,{...await sample(4),mode:"fixture"},false);
    await put(db,await sample(5),false);
    await put(db,await sample(6));await db.prepare("UPDATE tenx_proofs SET payload=json_set(payload,'$.slot',99) WHERE address=?1").bind(address(6)).run();
    const oversized=await sample(7);await put(db,{...oversized,creation:{...oversized.creation!,instruction:"x".repeat(8193)}});
    expect(await expireCandidates(db,new Date(later.getTime()-1))).toMatchObject({expired:0});
    expect(await expireCandidates(db,later)).toMatchObject({expired:1,provider_requests:0});
    expect(await inventoryStatus(db)).toMatchObject({retained:6,active:5,expired:1,active_over_limit:false});
    const receipt=await candidateExpiry(db,base.address);expect(receipt?.creation).toEqual(base.creation);expect(receipt?.expired_at).toBe(later.toISOString());
    expect((await candidates(db)).map(c=>c.address)).not.toContain(base.address);expect(await candidates(db,"fixture")).toHaveLength(1);
    expect(await db.prepare("SELECT count(*) n FROM tenx_candidates").first()).toEqual({n:7});
  });
  it("bounds each cached tick, honors pause, and never changes quotas",async()=>{
    const {db}=setup(),base=await sample();for(let i=1;i<=25;i++)await put(db,variant(base,i));
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("provider forbidden"));
    await db.prepare("UPDATE tenx_control SET paused=1 WHERE id=1").run();expect(await expireCandidates(db,later)).toMatchObject({state:"paused",expired:0});
    await db.prepare("UPDATE tenx_control SET paused=0 WHERE id=1").run();expect(await expireCandidates(db,later)).toMatchObject({expired:20});expect(await expireCandidates(db,later)).toMatchObject({expired:5});expect(await expireCandidates(db,later)).toMatchObject({expired:0});
    expect(await db.prepare("SELECT count(*) n FROM tenx_audit WHERE action='candidate_expired'").first()).toEqual({n:25});expect(await db.prepare("SELECT count(*) n FROM tenx_usage").first()).toEqual({n:0});expect(network).not.toHaveBeenCalled();
  });
  it.each(["pause","proof_changed"])("checks %s again inside the transaction",async change=>{
    const {db}=setup();await put(db,await sample());const original=db.batch.bind(db);
    vi.spyOn(db,"batch").mockImplementationOnce(async statements=>{
      if(change==="pause")await db.prepare("UPDATE tenx_control SET paused=1 WHERE id=1").run();
      else await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.creation.slot',99)").run();
      return original(statements);
    });
    expect(await expireCandidates(db,later)).toMatchObject({expired:0});expect(await inventoryStatus(db)).toMatchObject({expired:0,active:1});expect(await db.prepare("SELECT count(*) n FROM tenx_audit").first()).toEqual({n:0});
  });
  it("keeps the first concurrent receipt and its matching audit",async()=>{
    const {db}=setup();await put(db,await sample());const original=db.batch.bind(db);
    vi.spyOn(db,"batch").mockImplementationOnce(async statements=>{await expireCandidates(db,new Date(later.getTime()+1000));return original(statements);});
    expect(await expireCandidates(db,later)).toMatchObject({expired:0});
    const receipt=(await candidateExpiry(db,address(1)))!;
    expect(receipt.expired_at).toBe(new Date(later.getTime()+1000).toISOString());
    expect(await db.prepare("SELECT data_hash FROM tenx_audit WHERE action='candidate_expired'").first()).toEqual({data_hash:receipt.receipt_hash});
    await expect(db.prepare("UPDATE tenx_candidate_expiry SET expired_at=?1").bind(later.toISOString()).run()).rejects.toThrow("immutable_candidate_expiry");
    await expect(db.prepare("DELETE FROM tenx_candidate_expiry").run()).rejects.toThrow("immutable_candidate_expiry");
  });
  it("rolls back the complete tick when its audit fails",async()=>{
    const {db,sqlite}=setup();await put(db,await sample());await put(db,await sample(2));sqlite.exec("CREATE TRIGGER expiry_audit_fail BEFORE INSERT ON tenx_audit BEGIN SELECT RAISE(ABORT,'audit_failed'); END");
    await expect(expireCandidates(db,later)).rejects.toThrow("audit_failed");expect(await inventoryStatus(db)).toMatchObject({active:2,expired:0});
  });
  it("retains frozen elections, token detail, cohort inputs and proofs after expiry and later saves",async()=>{
    const {db}=setup(),base=await sample();await saveCandidate(db,base);const cohort=await db.prepare("SELECT input_hash,payload FROM tenx_cohorts").all();
    const first=await createElection(db,{id:"daily-2026-10-21",kind:"daily",reason:"Before expiry",now:at});
    await expireCandidates(db,later);await saveCandidate(db,{...base,checked_at:later.toISOString()});
    expect(await candidates(db)).toEqual([]);expect(await candidates(db,"live",true)).toHaveLength(1);expect(await db.prepare("SELECT input_hash,payload FROM tenx_cohorts WHERE day=?1").bind("2026-10-21").all()).toEqual(cohort);
    expect(await electionRecord(db,first.id)).toEqual(first);expect(await replayElection(first)).toMatchObject({status:"verified",provider_requests:0});
    const next=await createElection(db,{id:`manual-${crypto.randomUUID()}`,kind:"manual",reason:"Active inventory",now:later});expect(next.inputs.candidates).toEqual([]);
    vi.useFakeTimers();vi.setSystemTime(later);const env={TENX_DB:db,TENX_LOCAL_ONLY:"true"} as LocalEnv;
    const response=await handle(new Request(`http://127.0.0.1:8794/api/10x/candidates/solana/${base.address}`),env);expect(response.status).toBe(200);
    const detail=await response.json() as {retention:{receipt_hash:string};data:{reasons:string[];creation:unknown}};
    expect(detail.retention.receipt_hash).toBe((await candidateExpiry(db,base.address))!.receipt_hash);expect(detail.data.reasons).toContain("token_older_than_24h");expect(detail.data.creation).toEqual(base.creation);
  });
  it("holds a rehearsal above 500 active rows, then includes every remaining row after bounded expiry",async()=>{
    const {db}=setup(),base=await sample(),id=`manual-${crypto.randomUUID()}`;for(let i=1;i<=502;i++)await put(db,{...variant(base,i),creation:i<=2?variant(base,i).creation:null});
    await expect(createElection(db,{id,kind:"manual",reason:"Bound check",now:later})).rejects.toThrow("election_candidate_limit");
    expect(await inventoryStatus(db)).toMatchObject({active:502,active_over_limit:true});expect(await expireCandidates(db,later)).toMatchObject({expired:2});
    const record=await createElection(db,{id,kind:"manual",reason:"Bound check",now:later});expect(record.result.counts.observed).toBe(500);expect(record.inputs.candidates).toHaveLength(500);expect(await inventoryStatus(db)).toMatchObject({active:500,expired:2,retained:502});
  },15000);
  it("rejects corrupt receipts on detail reads",async()=>{
    const {db,sqlite}=setup();await put(db,await sample());await expireCandidates(db,later);
    sqlite.exec("DROP TRIGGER tenx_candidate_expiry_no_update");await db.prepare("UPDATE tenx_candidate_expiry SET receipt_hash=?1").bind(await hashJson("corrupt")).run();
    await expect(candidateExpiry(db,address(1))).rejects.toThrow("candidate_expiry_receipt_mismatch");
  });
});
