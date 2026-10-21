import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {d1EvidenceWriteStore} from "./evidence-write-store";
import type {HolderReceipt,WalletReceipt} from "./evidence-read-store";
import {holderHistoryFixture} from "./holder-history-fixtures.test-helper";
import {analyzeHolders,HolderEvidenceSchema,type HolderEvidence} from "./holders";
import {fixtureCandidates} from "./fixtures";
import {saveCandidate} from "./store";

const opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
function setup(){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite);return {sqlite,db,store:d1EvidenceWriteStore(db)};
}
const holder:HolderReceipt={payload_hash:"a".repeat(64),address:"mint",slot:42,payload:'{"original":"漢😀","zero":0}',observed_at:"2026-10-22T00:00:00.000Z"};
const wallet:WalletReceipt={payload_hash:"b".repeat(64),address:"mint",payload:'{"observed_at":"2026-10-22T00:00:00.000Z","zero":0}',observed_at:holder.observed_at};

it.each(["holder","wallet"] as const)("%s preparation has no IO; an exact retry is a no-op with original result positions",async kind=>{
  const {sqlite,db,store}=setup(),row=kind==="holder"?holder:wallet;
  const append=kind==="holder"?store.holder(holder):store.wallet(wallet),table=kind==="holder"?"tenx_holder_evidence":"tenx_wallet_evidence";
  expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n).toBe(0);
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No provider calls"));
  const result=await db.batch([db.prepare("SELECT 7 AS before_append"),append,kind==="holder"?store.holder(holder):store.wallet(wallet),db.prepare("SELECT 8 AS after_append")]);
  expect(result[0]!.results).toEqual([{before_append:7}]);expect(result[1]!.meta.changes).toBe(1);expect(result[2]!.meta.changes).toBe(0);expect(result[3]!.results).toEqual([{after_append:8}]);
  expect(sqlite.prepare(`SELECT * FROM ${table}`).get()).toEqual(row);expect(network).not.toHaveBeenCalled();
});

it.each([
  {address:"other mint"},{slot:43},{payload:'{"zero":0,"original":"漢😀"}'},
])("a holder hash cannot silently accept different content or identity: %j",async change=>{
  const {sqlite,db,store}=setup();await db.batch([store.holder(holder)]);
  await expect(db.batch([db.prepare("INSERT INTO tenx_wallet_usage VALUES('test',1)"),store.holder({...holder,...change}),db.prepare("INSERT INTO tenx_usage VALUES('rpc','test',1)")])).rejects.toThrow("NOT NULL");
  expect(sqlite.prepare("SELECT * FROM tenx_holder_evidence").get()).toEqual(holder);
  expect(sqlite.prepare("SELECT count(*) AS n FROM tenx_wallet_usage").get()!.n).toBe(0);expect(sqlite.prepare("SELECT count(*) AS n FROM tenx_usage").get()!.n).toBe(0);
});
it.each([
  {address:"other mint"},{payload:wallet.payload+" "},{observed_at:"2026-10-22T00:01:00.000Z"},
])("a wallet hash cannot silently accept different bytes or metadata: %j",async change=>{
  const {sqlite,db,store}=setup();await db.batch([store.wallet(wallet)]);
  await expect(db.batch([db.prepare("INSERT INTO tenx_wallet_usage VALUES('test',1)"),store.wallet({...wallet,...change}),db.prepare("INSERT INTO tenx_usage VALUES('rpc','test',1)")])).rejects.toThrow("NOT NULL");
  expect(sqlite.prepare("SELECT * FROM tenx_wallet_evidence").get()).toEqual(wallet);
  expect(sqlite.prepare("SELECT count(*) AS n FROM tenx_wallet_usage").get()!.n).toBe(0);expect(sqlite.prepare("SELECT count(*) AS n FROM tenx_usage").get()!.n).toBe(0);
});
it("identical holder content keeps its first receipt time across later observations",async()=>{
  const {sqlite,db,store}=setup();await db.batch([store.holder(holder)]);
  const result=await db.batch([store.holder({...holder,observed_at:"2026-10-22T00:01:00.000Z"})]);
  expect(result[0]!.meta.changes).toBe(0);expect(sqlite.prepare("SELECT * FROM tenx_holder_evidence").get()).toEqual(holder);
});
it.each(["holder","wallet"] as const)("a later batch failure rolls back new %s evidence without refunding previously spent allowance",async kind=>{
  const {sqlite,db,store}=setup();await db.prepare("INSERT INTO tenx_usage VALUES('rpc','test',3)").run();await db.prepare("INSERT INTO tenx_wallet_usage VALUES('test',3)").run();
  await expect(db.batch([db.prepare("UPDATE tenx_wallet_control SET last_success='published' WHERE id=1"),kind==="holder"?store.holder(holder):store.wallet(wallet),db.prepare("INSERT INTO tenx_wallet_usage VALUES('test',1)")])).rejects.toThrow();
  expect(sqlite.prepare(`SELECT count(*) AS n FROM tenx_${kind}_evidence`).get()!.n).toBe(0);expect(sqlite.prepare("SELECT last_success FROM tenx_wallet_control").get()!.last_success).toBeNull();
  expect(sqlite.prepare("SELECT used FROM tenx_usage").get()!.used).toBe(3);expect(sqlite.prepare("SELECT used FROM tenx_wallet_usage").get()!.used).toBe(3);
});
function assertHolder(raw:unknown):asserts raw is HolderEvidence {HolderEvidenceSchema.parse(raw);}
async function candidateInput(){
  const history=await holderHistoryFixture(),evidence=history.samples[0]!.evidence;assertHolder(evidence);
  const candidate={...(await fixtureCandidates(new Date(history.cutoff_at)))[0]!,mode:"live" as const,address:evidence.mint,pool:evidence.pool,holders:await analyzeHolders(evidence,history.index[0]!.observed_at)};
  return {candidate,evidence};
}
it("saveCandidate retains original receipt bytes and first time when re-observing holder content",async()=>{
  const {sqlite,db}=setup(),{candidate,evidence}=await candidateInput();
  await saveCandidate(db,candidate,[],undefined,evidence);
  const before=sqlite.prepare("SELECT * FROM tenx_holder_evidence").get(),later="2026-10-22T00:05:00.000Z";
  await saveCandidate(db,{...candidate,checked_at:later,holders:{...candidate.holders,observed_at:later}},[],undefined,evidence);
  expect(sqlite.prepare("SELECT * FROM tenx_holder_evidence").get()).toEqual(before);expect(before!.payload).toBe(JSON.stringify(evidence));
  expect(sqlite.prepare("SELECT checked_at FROM tenx_candidates WHERE mode='live'").get()!.checked_at).toBe(later);
});
it("saveCandidate rolls back candidate updates on a conflicting holder append and never reaches cohort capture",async()=>{
  const {sqlite,db}=setup(),{candidate,evidence}=await candidateInput();await saveCandidate(db,candidate);
  sqlite.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(candidate.holders.payload_hash,candidate.address,evidence.inventory.context.slot,'{"corrupt":true}',candidate.holders.observed_at);
  const tables=["tenx_candidates","tenx_holder_evidence","tenx_wallet_signals","tenx_market_history","tenx_cohorts","tenx_wallet_cohorts","tenx_selections"],before=tables.map(t=>sqlite.prepare(`SELECT * FROM ${t}`).all());
  await expect(saveCandidate(db,{...candidate,checked_at:"2026-10-22T00:06:00.000Z"},[],undefined,evidence)).rejects.toThrow("NOT NULL");
  expect(tables.map(t=>sqlite.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
});
