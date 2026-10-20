import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { collectFundingHistories, fundingCoverage, fundingTask, FundingScanSchema, type FundingScan } from "./funding-history";
import { RpcClient, SourceError, type SignatureRow } from "./rpc";
import { key, signature, trade, walletInput } from "./wallet-fixtures.test-helper";
import { analyzeWalletEvidence, WalletEvidenceSchema } from "./wallet-analysis";
import { toBase58 } from "./solana";
import recordedFunding from "../fixtures/recorded/funding-evidence.json";
import { WalletAnalysisSchema } from "./wallet-model";

const dbs: DatabaseSync[] = [];
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
const anchor = { wallet: key(8), signature: signature(31), slot: 10001, block_time: "2026-10-19T23:00:01.000Z", kind: "sampled_buy" as const };
const row = (n: number, seconds = 10, failed = false): SignatureRow => ({ signature: signature(n), slot: anchor.slot - n, blockTime: Date.parse(anchor.block_time) / 1000 - seconds, err: failed ? { failed: true } : null, confirmationStatus: "finalized" });
function fixture(pages: SignatureRow[][]) {
  const db = new DatabaseSync(":memory:"); dbs.push(db); db.exec(readFileSync(new URL("../migrations/0007_funding_history.sql", import.meta.url), "utf8"));
  const d1 = sqliteD1(db), calls: { address: string; before: string }[] = [];
  db.exec(readFileSync(new URL("../migrations/0008_second_hop.sql", import.meta.url), "utf8"));
  const rpc = new RpcClient("https://rpc.example", async () => {}, async (_input, init) => {
    const body = JSON.parse(String(init?.body)); expect(body.method).toBe("getSignaturesForAddress"); expect(body.params[1]).toMatchObject({ commitment: "finalized", limit: 50 });
    calls.push({ address: body.params[0], before: body.params[1].before });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: pages.shift() ?? [] });
  }, 18);
  const reads: string[] = [], cached = new Set<string>();
  const read = async (sig: string) => { if (!cached.has(sig)) { reads.push(sig); cached.add(sig); } return { transaction: await trade(), status: "available" as const }; };
  return { d1, rpc, read, calls, reads, cached };
}
const coverage = (scan: FundingScan) => fundingCoverage(scan, new Set(scan.examined.filter(r => r.status === "available").map(r => r.signature)));
describe("resumable anchored pre-buy funding windows", () => {
  it("isolates second-hop progress and reserves RPC room without expanding the cycle ceiling", async () => {
    const f = fixture([[], []]);
    await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    const upstream = { ...anchor, kind: "funding_transfer" as const, instruction_index: 0 };
    f.rpc.calls = 13;
    await collectFundingHistories(f.d1, f.rpc, key(41), [upstream], f.read, { secondHop: true, rpcCeiling: 14 }); expect(f.calls).toHaveLength(1);
    await collectFundingHistories(f.d1, f.rpc, key(41), [upstream], f.read, { secondHop: true }); expect(f.calls).toHaveLength(2);
    expect((await f.d1.prepare("SELECT count(*) AS n FROM tenx_second_hop_scans").first<{ n: number }>())?.n).toBe(1);
    expect((await f.d1.prepare("SELECT count(*) AS n FROM tenx_funding_scans").first<{ n: number }>())?.n).toBe(1);
    await f.d1.prepare("UPDATE tenx_second_hop_scans SET anchor_signature=?1").bind(upstream.signature).run();
    const before = f.calls.length;
    await collectFundingHistories(f.d1, f.rpc, key(41), [upstream], f.read, { secondHop: true }); expect(f.calls).toHaveLength(before);
    await collectFundingHistories(f.d1, f.rpc, key(41), [{ ...upstream, instruction_index: 1 }], f.read, { secondHop: true });
    expect((await f.d1.prepare("SELECT count(*) AS n FROM tenx_second_hop_scans").first<{ n: number }>())?.n).toBe(2);
  });
  it("replays real finalized pre-buy funding for six buyers and retains the creation-history gap", async () => {
    const actual = await analyzeWalletEvidence(WalletEvidenceSchema.parse(recordedFunding.evidence));
    expect(actual).toEqual(WalletAnalysisSchema.parse(recordedFunding.expected));
    expect(actual.metrics.shared_funder_buyers).toBe(6); expect(actual.funding).toHaveLength(7);
    expect(actual.funding_coverage?.filter(c => c.status === "window_examined")).toHaveLength(6);
    expect(actual.funding_coverage?.find(c => c.anchor_kind === "signed_creation")?.gaps).toContain("provider_history_ended_before_window_boundary");
  });
  it("starts before the verified buy, pages older, resumes, and avoids re-fetching examined transactions", async () => {
    const first = Array.from({ length: 50 }, (_, n) => row(40 + n, 10 + n, n >= 3));
    const f = fixture([first, [row(100, 100), row(101, 3601)]]);
    let scans = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    expect(f.calls[0]).toEqual({ address: anchor.wallet, before: anchor.signature }); expect(coverage(scans[0]!).status).toBe("partial");
    scans = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    expect(f.calls[1]?.before).toBe(first.at(-1)!.signature); expect(f.reads).toHaveLength(4);
    expect(coverage(scans[0]!)).toMatchObject({ status: "window_examined", transactions_examined: 4, boundary_reached: true });
    await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read); expect(f.calls).toHaveLength(2); expect(f.reads).toHaveLength(4);
  });
  it("recognizes impossible windows before spending twelve body reads without changing evidence coverage", async () => {
    const f = fixture([[...Array.from({ length: 14 }, (_, n) => row(40 + n)), row(80, 3601)]]);
    let scan: FundingScan;
    for (let n = 0; n < 5; n++) [scan!] = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    expect(f.calls).toHaveLength(1); expect(f.reads).toHaveLength(0); expect(fundingTask(scan!).gaps).toContain("funding_window_exceeds_transaction_bound"); expect(coverage(scan!).gaps).toContain("funding_transactions_pending"); expect(coverage(scan!).status).toBe("partial");
  });
  it("drains finishable queued bodies without paging or expanding the per-turn read bound",async()=>{
    const f=fixture([[...Array.from({length:7},(_,n)=>row(40+n)),row(80,3601)]]);
    let scan:FundingScan;
    [scan!]=await collectFundingHistories(f.d1,f.rpc,key(41),[anchor],f.read); expect(f.reads).toHaveLength(3);
    [scan!]=await collectFundingHistories(f.d1,f.rpc,key(41),[anchor],f.read); expect(f.reads).toHaveLength(6);
    [scan!]=await collectFundingHistories(f.d1,f.rpc,key(41),[anchor],f.read); expect(f.reads).toHaveLength(7);
    expect(f.calls).toHaveLength(1);expect(coverage(scan!).status).toBe("window_examined");
  });
  it("retains page and transaction progress through an interruption", async () => {
    const f = fixture([[row(40), row(41), row(42), row(80, 3601)]]); let reads = 0;
    await expect(collectFundingHistories(f.d1, f.rpc, key(41), [anchor], async sig => { if (++reads === 2) throw new SourceError("rpc_rate_limited"); return f.read(sig); })).rejects.toThrow("rpc_rate_limited");
    const resumed = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    expect(f.calls).toHaveLength(1); expect(coverage(resumed[0]!).status).toBe("window_examined");
  });
  it("does not call an empty archival response a complete one-hour window", async () => {
    const f = fixture([[]]), [scan] = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    expect(coverage(scan!)).toMatchObject({ status: "partial", transactions_examined: 0, boundary_reached: false });
    expect(coverage(scan!).gaps).toContain("provider_history_ended_before_window_boundary");
  });
  it("stops at the page cap and labels nonfinalized references instead of clearing coverage", async () => {
    const pages = Array.from({ length: 3 }, (_, p) => Array.from({ length: 50 }, (_, n) => row(40 + p * 50 + n, 10, true)));
    const f = fixture(pages); let scan: FundingScan;
    for (let n = 0; n < 4; n++) [scan!] = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    expect(f.calls).toHaveLength(3); expect(coverage(scan!).gaps).toContain("funding_page_limit");
    scan!.pages[0]!.rows[0] = { ...scan!.pages[0]!.rows[0]!, err: null, confirmationStatus: "confirmed" };
    expect(coverage(scan!).gaps).toContain("funding_signature_not_finalized");
  });
  it("keeps null timestamps and unavailable transaction bodies explicit", async () => {
    const f = fixture([[{ ...row(40), blockTime: null }, row(80, 3601)]]);
    const [scan] = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], async () => ({ transaction: null, status: "unsupported" as const }));
    expect(coverage(scan!).gaps).toEqual(expect.arrayContaining(["funding_signature_time_unknown", "funding_transactions_pending"]));
    expect(fundingTask(scan!).blocked).toBe(true);expect(f.reads).toHaveLength(0);
    const dated=fixture([[row(41),row(80,3601)]]);
    const [unsupported]=await collectFundingHistories(dated.d1,dated.rpc,key(41),[anchor],async()=>({transaction:null,status:"unsupported" as const}));
    expect(coverage(unsupported!).gaps).toContain("funding_transaction_missing_or_unsupported");
  });
  it("enforces cursor continuity, duplicate/order checks and persisted hash integrity", async () => {
    const f = fixture([[row(40), row(80, 3601)]]), [scan] = await collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read);
    const corrupt = structuredClone(scan!); corrupt.pages[0]!.before = signature(99); expect(() => coverage(corrupt)).toThrow("funding_cursor_chain_mismatch");
    corrupt.pages[0]!.before = anchor.signature; corrupt.pages[0]!.rows.push(corrupt.pages[0]!.rows[0]!); expect(() => coverage(corrupt)).toThrow("funding_page_order_mismatch");
    await f.d1.prepare("UPDATE tenx_funding_scans SET payload_hash=?1").bind("a".repeat(64)).run();
    await expect(collectFundingHistories(f.d1, f.rpc, key(41), [anchor], f.read)).rejects.toThrow("funding_progress_hash_mismatch");
  });
  it("rotates bounded work across more than three wallets and respects the RPC ceiling", async () => {
    const f = fixture([[], [], [], [], []]), anchors = Array.from({ length: 5 }, (_, n) => ({ ...anchor, wallet: key(8 + n) }));
    await collectFundingHistories(f.d1, f.rpc, key(41), anchors, f.read); expect(f.calls).toHaveLength(3);
    await collectFundingHistories(f.d1, f.rpc, key(41), anchors, f.read); expect(new Set(f.calls.map(c => c.address)).size).toBe(5);
    f.rpc.calls = 17; await collectFundingHistories(f.d1, f.rpc, key(42), anchors, f.read); expect(f.calls).toHaveLength(5);
  });
  it("validates anchors against actual signed creation or canonical buys before accepting coverage", async () => {
    const input = await walletInput(); input.version = "wallet-input-v2"; input.funding_scans = [FundingScanSchema.parse({ wallet: anchor.wallet, anchor: { ...anchor, signature: signature(99) }, lookback_seconds: 3600, pages: [], examined: [], attempted_at: input.observed_at })];
    await expect(analyzeWalletEvidence(input)).rejects.toThrow("funding_anchor_not_verified");
  });
  it("identifies a common direct funder before signed creation and a buyer without implying common control", async () => {
    const input = await walletInput(), funding = await trade(key(12), 9900, "buy", 55), addresses = funding.transaction.message.accountKeys;
    addresses.push("11111111111111111111111111111111", key(7), key(8)); funding.meta!.preBalances.push(10000, 0, 0); funding.meta!.postBalances.push(10000, 1000, 1000); funding.meta!.innerInstructions = []; funding.blockTime = Date.parse(anchor.block_time) / 1000 - 10;
    const data = new Uint8Array(12); new DataView(data.buffer).setUint32(0, 2, true); new DataView(data.buffer).setBigUint64(4, 1000n, true);
    funding.transaction.message.instructions = [key(7), key(8)].map(wallet => ({ programIdIndex: addresses.length - 3, accounts: [0, addresses.indexOf(wallet)], data: toBase58(data) }));
    input.records.push({ signature: signature(55), status: "available", fetched_at: input.observed_at, purposes: ["wallet"], transaction: funding });
    input.version = "wallet-input-v2"; input.funding_scans = [{ wallet: key(7), anchor: { wallet: key(7), signature: input.asset.creation!.signature, slot: input.asset.creation!.slot, block_time: input.asset.creation!.block_time, kind: "signed_creation" }, pages: [], examined: [], lookback_seconds: 3600, attempted_at: input.observed_at }];
    const actual = await analyzeWalletEvidence(WalletEvidenceSchema.parse(input));
    expect(actual.signals).toContainEqual(expect.objectContaining({ code: "shared_creation_and_buyer_funder", strength: "heuristic", wallets: expect.arrayContaining([key(12), key(7), key(8)]) }));
    expect(actual.funding.find(f => f.to === key(7))?.before_signed_creation).toBe(true); expect(actual.actual_bundle_membership).toBe("unknown");
  });
});
