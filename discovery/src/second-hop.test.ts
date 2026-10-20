import { describe, expect, it } from "vitest";
import { analyzeSecondHop, buildSecondHopOutflows, directFundingEdges, eligibleOutflows, secondHopAnchors } from "./second-hop";
import { WalletTransactionSchema } from "./wallet-rpc";
import { key, signature, walletInput } from "./wallet-fixtures.test-helper";
import { toBase58 } from "./solana";
import { analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
import type { FundingScan } from "./funding-history";
import recorded from "../fixtures/recorded/second-hop-evidence.json";
import { WalletEvidenceSchema } from "./wallet-analysis";
import { WalletAnalysisSchema } from "./wallet-model";

async function transfer(edges: [number, number][], sig: number, slot: number, time = 1792450790) {
  const signers = [...new Set(edges.map(e => key(e[0])))], addresses = [...new Set([...signers, "11111111111111111111111111111111", ...edges.flatMap(e => e.map(key))])];
  const data = new Uint8Array(12); new DataView(data.buffer).setUint32(0, 2, true); new DataView(data.buffer).setBigUint64(4, 1000n, true);
  return WalletTransactionSchema.parse({ version: 0, slot, blockTime: time, transaction: { signatures: signers.map((_, n) => signature(sig + n)), message: { header: { numRequiredSignatures: signers.length }, accountKeys: addresses, instructions: edges.map(([from, to]) => ({ programIdIndex: addresses.indexOf("11111111111111111111111111111111"), accounts: [addresses.indexOf(key(from)), addresses.indexOf(key(to))], data: toBase58(data) })) } }, meta: { err: null, fee: 5000, innerInstructions: [], loadedAddresses: { writable: [], readonly: [] }, preTokenBalances: [], postTokenBalances: [], preBalances: addresses.map(() => 10000), postBalances: addresses.map(() => 10000) } });
}
async function input() {
  const input = await walletInput(); input.version = "wallet-input-v3"; input.funding_scans = []; input.second_hop_scans = [];
  return input;
}
function record(i: WalletEvidence, tx: Awaited<ReturnType<typeof transfer>>) { i.records.push({ signature: tx.transaction.signatures[0]!, fetched_at: i.observed_at, status: "available", purposes: ["wallet"], transaction: tx }); }
function scan(i: WalletEvidence, wallet: string, anchor: FundingScan["anchor"], tx: Awaited<ReturnType<typeof transfer>>): FundingScan {
  return { wallet, anchor, lookback_seconds: 3600, attempted_at: i.observed_at, examined: [{ signature: tx.transaction.signatures[0]!, status: "available" }], pages: [{ before: anchor.signature, fetched_at: i.observed_at, rows: [{ signature: tx.transaction.signatures[0]!, slot: tx.slot, blockTime: tx.blockTime, err: null, confirmationStatus: "finalized" }, { signature: signature(90), slot: tx.slot - 1000, blockTime: Date.parse(anchor.block_time) / 1000 - 3601, err: null, confirmationStatus: "finalized" }] }] };
}
async function pathInput() {
  const i = await input(), buy = i.records[1]!.transaction!, down = await transfer([[20, 8]], 50, 9995, buy.blockTime! - 2), up = await transfer([[7, 20]], 55, 9990, buy.blockTime! - 5);
  record(i, down); record(i, up);
  i.funding_scans = [scan(i, key(8), { wallet: key(8), signature: buy.transaction.signatures[0]!, slot: buy.slot, block_time: new Date(buy.blockTime! * 1000).toISOString(), kind: "sampled_buy" }, down)];
  const outflows = await buildSecondHopOutflows(i.records.filter(r => r.transaction && r.transaction !== up).map(r => r.transaction!), i.asset.address, i.asset.pool, i.asset.creation!.slot, new Set([key(7)]), i.funding_scans.map(s => s.anchor));
  i.second_hop_scans = [scan(i, key(20), secondHopAnchors(outflows, new Set([key(7)]))[0]!, up)];
  return i;
}
describe("evidence-backed bounded second-hop funding", () => {
  it("replays real finalized upstream transfers without inferring a creation-wallet connection", async () => {
    const actual = await analyzeWalletEvidence(WalletEvidenceSchema.parse(recorded.evidence));
    expect(actual).toEqual(WalletAnalysisSchema.parse(recorded.expected)); expect(actual.second_hop?.paths).toHaveLength(18);
    expect(new Set(actual.second_hop?.paths.map(p => p.source)).size).toBe(3); expect(new Set(actual.second_hop?.paths.map(p => p.target)).size).toBe(6);
    expect(actual.second_hop?.coverage.every(c => c.status === "partial")).toBe(true); expect(actual.second_hop?.paths.some(p => p.target_role === "signed_creation")).toBe(false);
  });
  it("detects a shared upstream source across separate creation and buyer funders as a heuristic", async () => {
    const i = await input(), buy = i.records[1]!.transaction!;
    const dev = await transfer([[20, 7]], 50, 9992, buy.blockTime! - 2), buyer = await transfer([[21, 8]], 52, 9993, buy.blockTime! - 2), upper = await transfer([[30, 20], [30, 21]], 55, 9980, buy.blockTime! - 5);
    record(i, dev); record(i, buyer); record(i, upper);
    i.funding_scans = [scan(i, key(7), { wallet: key(7), signature: i.asset.creation!.signature, slot: i.asset.creation!.slot, block_time: i.asset.creation!.block_time, kind: "signed_creation" }, dev), scan(i, key(8), { wallet: key(8), signature: buy.transaction.signatures[0]!, slot: buy.slot, block_time: new Date(buy.blockTime! * 1000).toISOString(), kind: "sampled_buy" }, buyer)];
    const outflows = await buildSecondHopOutflows(i.records.filter(r => r.transaction && r.transaction !== upper).map(r => r.transaction!), i.asset.address, i.asset.pool, i.asset.creation!.slot, new Set([key(7)]), i.funding_scans.map(s => s.anchor));
    i.second_hop_scans = secondHopAnchors(outflows, new Set([key(7)])).map(a => scan(i, a.wallet, a, upper));
    const actual = await analyzeWalletEvidence(i);
    expect(actual.signals).toContainEqual(expect.objectContaining({ code: "shared_upstream_creation_and_buyer_source", strength: "heuristic", wallets: expect.arrayContaining([key(30), key(20), key(21), key(7), key(8)]) }));
  });
  it("rejects an oversized edge expansion before constructing an unbounded graph", async () => {
    const txs = await Promise.all([50, 55, 60].map(sig => transfer(Array.from({ length: 200 }, () => [20, 8] as [number, number]), sig, 9990)));
    await expect(directFundingEdges(txs)).rejects.toThrow("second_hop_edge_limit");
  });
  it("proves signed transfer sequences to early buyers and preserves both transactions and amounts", async () => {
    const i = await pathInput(), actual = await analyzeWalletEvidence(i);
    expect(actual.version).toBe("wallet-signals-v3"); expect(actual.second_hop?.paths[0]).toMatchObject({ source: key(7), intermediary: key(20), target: key(8), target_role: "early_buyer", upstream: { signature: signature(55), lamports_raw: "1000" }, downstream: { signature: signature(50), lamports_raw: "1000" } });
    expect(actual.signals).toContainEqual(expect.objectContaining({ code: "creation_wallet_to_early_buyer_via_funder", strength: "observed" })); expect(actual.second_hop?.coverage[0]?.status).toBe("window_examined");
    expect(actual.second_hop?.gaps).toContain("funding_sequence_not_coin_provenance"); expect(actual.actual_bundle_membership).toBe("unknown");
  });
  it("supports both transfer instructions in one transaction with signer and instruction ordering", async () => {
    const tx = await transfer([[7, 20], [20, 8]], 50, 9990), edges = await directFundingEdges([tx]);
    const result = await analyzeSecondHop([tx], [edges[1]!], new Set([key(7)]), [], "2026-10-20T00:00:00Z");
    expect(result.paths).toHaveLength(1); expect(result.paths[0]?.upstream.instruction_index).toBe(0); expect(result.paths[0]?.downstream.instruction_index).toBe(1);
    expect((await analyzeSecondHop([tx], [edges[0]!], new Set(), [], "2026-10-20T00:00:00Z")).paths).toHaveLength(0);
  });
  it("excludes same-slot separate transactions, cycles, late transfers and transfers beyond the lookback", async () => {
    const down = await transfer([[20, 8]], 50, 9995, 1792450790), [edge] = await directFundingEdges([down]);
    for (const [source, slot, time, gap] of [[7, 9995, 1792450789, "second_hop_same_slot_order_unknown"], [8, 9990, 1792450789, "second_hop_cycles_excluded"], [7, 9990, 1792450791, null], [7, 9990, 1792447189, null]] as const) {
      const up = await transfer([[source, 20]], 55, slot, time), result = await analyzeSecondHop([down, up], [edge!], new Set(), [], "2026-10-20T00:00:00Z");
      expect(result.paths).toHaveLength(0); if (gap) expect(result.gaps).toContain(gap);
    }
  });
  it("rejects failed, unsigned, CPI and non-transfer instruction evidence", async () => {
    const tx = await transfer([[7, 20]], 50, 9990);
    tx.meta!.err = { failed: true }; await expect(directFundingEdges([tx])).rejects.toThrow(); tx.meta!.err = null;
    tx.transaction.message.header.numRequiredSignatures = 2; await expect(directFundingEdges([tx])).rejects.toThrow(); tx.transaction.message.header.numRequiredSignatures = 1;
    const ix = tx.transaction.message.instructions[0]!; tx.meta!.innerInstructions = [{ index: 0, instructions: [{ ...ix, stackHeight: 2 }] }]; tx.transaction.message.instructions = [{ ...ix, data: "" }];
    expect(await directFundingEdges([tx])).toEqual([]);
  });
  it("will not borrow an earlier identical transfer's pre-buy eligibility for a later instruction", async () => {
    const tx = await transfer([[20, 8], [20, 8]], 50, 9990), edges = await directFundingEdges([tx]), i = await pathInput();
    const trade = (await analyzeWalletEvidence(i)).trades.find(t => t.wallet === key(8))!;
    const qualifying = { ...edges[0]!, before_sampled_buy: true };
    const later = { ...edges[1]!, instruction_index: 2 };
    expect(eligibleOutflows([edges[0]!, later], [qualifying], new Set(), new Set([key(8)]), [{ ...trade, slot: tx.slot, signature: tx.transaction.signatures[0]!, instruction_index: "1" }])).toEqual([edges[0]]);
  });
  it("requires a real eligible outflow anchor and immutable history-slot matches", async () => {
    let i = await pathInput(); i.second_hop_scans![0]!.anchor.wallet = key(99); await expect(analyzeWalletEvidence(i)).rejects.toThrow("second_hop_anchor_not_verified");
    i = await pathInput(); i.second_hop_scans![0]!.pages[0]!.rows[0]!.slot++; await expect(analyzeWalletEvidence(i)).rejects.toThrow("wallet_history_transaction_mismatch");
    i = await pathInput(); i.second_hop_scans![0]!.attempted_at = "2030-01-01T00:00:00Z"; await expect(analyzeWalletEvidence(i)).rejects.toThrow("second_hop_scan_from_future");
  });
  it("keeps missing second-hop bodies partial and avoids fabricated paths", async () => {
    const i = await pathInput(), upper = i.records.at(-1)!; upper.status = "missing"; upper.transaction = null; i.second_hop_scans![0]!.examined[0]!.status = "missing";
    const actual = await analyzeWalletEvidence(i); expect(actual.second_hop?.paths).toEqual([]); expect(actual.second_hop?.coverage[0]?.status).toBe("partial"); expect(actual.gaps).toContain("second_hop_coverage_partial");
  });
  it("caps expansion at four direct funders and labels omitted funders", async () => {
    const txs = await Promise.all(Array.from({ length: 6 }, (_, n) => transfer([[20 + n, 8]], 50 + n, 9990 + n)));
    const edges = await directFundingEdges(txs), result = await analyzeSecondHop(txs, edges, new Set(), [], "2026-10-20T00:00:00Z");
    expect(secondHopAnchors(edges, new Set())).toHaveLength(4); expect(result.eligible_funders).toBe(6); expect(result.gaps).toContain("second_hop_funder_limit");
  });
});
