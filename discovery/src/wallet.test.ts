import { describe, it, expect } from "vitest";
import { analyzeWalletEvidence, WalletEvidenceSchema } from "./wallet-analysis";
import { creationRoles, verifiedTrades, fundingTransfers } from "./wallet-trades";
import { key, signature, trade, walletInput, gateSample, now } from "./wallet-fixtures.test-helper";
import { assess, DEFAULT_POLICY } from "./model";
import { fixtureCandidates } from "./fixtures";
import { hashJson, toBase58 } from "./solana";
import { TransactionSchema } from "./rpc";
import { measureOutcome } from "./research";
import recorded from "../fixtures/recorded/wallet-evidence.json";
import { WalletAnalysisSchema } from "./wallet-model";
import { analyzeHolders, HolderEvidenceSchema } from "./holders";
import holderRecord from "../fixtures/recorded/holder-evidence.json";
import tradeSchema from "../protocol/trade-schema.json";
import { AMM, ATA, TOKEN, WSOL } from "./pump";
import { findPda, publicKey } from "./solana";

describe("canonical finalized trade and wallet evidence", () => {
  it("certifies PumpSwap buys only with both canonical base and WSOL quote flows", async () => {
    const i = await walletInput(), tx = await trade(), wallet = key(8), d = tradeSchema.instructions.find(d => d.program === AMM && d.name === "buy_v2")!;
    const ata = (owner: string, mint: string) => findPda(ATA, [publicKey(owner), publicKey(TOKEN), publicKey(mint)]);
    const baseVault = await ata(i.asset.pool, i.asset.address), quoteVault = await ata(i.asset.pool, WSOL), userBase = await ata(wallet, i.asset.address), userQuote = await ata(wallet, WSOL);
    const values: Record<string, string> = { pool: i.asset.pool, user: wallet, base_mint: i.asset.address, quote_mint: WSOL, user_base_token_account: userBase, user_quote_token_account: userQuote, pool_base_token_account: baseVault, pool_quote_token_account: quoteVault, base_token_program: TOKEN, quote_token_program: TOKEN };
    const keys = [...new Set([wallet, AMM, TOKEN, ...d.accounts.map(n => values[n] ?? key(99))])], index = (key: string) => keys.indexOf(key);
    tx.transaction.message.accountKeys = keys;
    const transferData = new Uint8Array(9); transferData[0] = 3; new DataView(transferData.buffer).setBigUint64(1, 100n, true);
    tx.transaction.message.instructions = [{ programIdIndex: index(AMM), accounts: d.accounts.map(n => index(values[n] ?? key(99))), data: toBase58(Uint8Array.from([...d.discriminator, ...new Uint8Array(16)])) }];
    tx.meta!.preBalances = keys.map(() => 10000); tx.meta!.postBalances = keys.map(() => 10000);
    const balance = (account: string, mint: string, amount: string) => ({ accountIndex: index(account), owner: wallet, mint, programId: TOKEN, uiTokenAmount: { amount, decimals: 6 } });
    tx.meta!.preTokenBalances = [balance(userBase, i.asset.address, "0"), balance(userQuote, WSOL, "100")]; tx.meta!.postTokenBalances = [balance(userBase, i.asset.address, "100"), balance(userQuote, WSOL, "0")];
    tx.meta!.innerInstructions = [{ index: 0, instructions: [[baseVault, userBase], [userQuote, quoteVault]].map(([from, to]) => ({ programIdIndex: index(TOKEN), accounts: [index(from!), index(to!)], data: toBase58(transferData), stackHeight: 2 })) }];
    expect((await verifiedTrades(tx, i.asset.address, i.asset.pool)).trades[0]).toMatchObject({ side: "buy", quote_kind: "wsol_raw", base_amount_raw: "100", quote_amount_raw: "100" });
    tx.meta!.innerInstructions[0]!.instructions.pop(); expect((await verifiedTrades(tx, i.asset.address, i.asset.pool)).trades).toEqual([]);
  });
  it("computes exposure only from a replayed fresh full holder inventory", async () => {
    const i = WalletEvidenceSchema.parse(recorded.evidence), evidence = HolderEvidenceSchema.parse(holderRecord.evidence);
    // Same recorded account bytes, synthetic observation times for freshness boundaries.
    i.holders = { evidence, analysis: await analyzeHolders(evidence, i.observed_at) };
    const a = await analyzeWalletEvidence(i); expect(a.metrics.dev_sold_supply_pct).toBe(0); expect(a.wallets.every(w => w.current_supply_pct !== null)).toBe(true);
    i.holders.analysis = await analyzeHolders(evidence, new Date(Date.parse(i.observed_at) - 1800001).toISOString());
    expect((await analyzeWalletEvidence(i)).metrics.dev_sold_supply_pct).toBeNull();
    i.holders.analysis.top1_pct = 99; await expect(analyzeWalletEvidence(i)).rejects.toThrow("wallet_holder_snapshot_mismatch");
  });
  it("links direct signed creation-wallet funding to multiple buyers without asserting common ownership", async () => {
    const i = await walletInput(), tx = await trade(key(7), 10000, "buy", 55), addresses = tx.transaction.message.accountKeys;
    const system = "11111111111111111111111111111111"; addresses.push(system, key(8), key(9));
    tx.meta!.preBalances.push(10000, 0, 0); tx.meta!.postBalances.push(10000, 1000, 1000); tx.meta!.innerInstructions = [];
    const data = new Uint8Array(12); new DataView(data.buffer).setUint32(0, 2, true); new DataView(data.buffer).setBigUint64(4, 1000n, true);
    tx.transaction.message.instructions = [key(8), key(9)].map(to => ({ programIdIndex: addresses.indexOf(system), accounts: [0, addresses.indexOf(to)], data: toBase58(data) })); tx.blockTime!--;
    i.records.push({ signature: tx.transaction.signatures[0]!, fetched_at: i.observed_at, status: "available", purposes: ["wallet"], transaction: tx });
    const a = await analyzeWalletEvidence(i); expect(a.metrics).toMatchObject({ shared_funder_buyers: 2, dev_funded_buyers: 2 });
    expect(a.signals).toContainEqual(expect.objectContaining({ code: "creation_wallet_funded_buyers", strength: "observed" })); expect(a.actual_bundle_membership).toBe("unknown");
  });
  it("retains both sides of a same-transaction round trip with a zero net wallet balance", async () => {
    const i = await walletInput(), buy = await trade(), sell = await trade(key(8), 10001, "sell"), sellKeys = sell.transaction.message.accountKeys, keys = buy.transaction.message.accountKeys;
    for (const k of sellKeys) if (!keys.includes(k)) { keys.push(k); buy.meta!.preBalances.push(10000); buy.meta!.postBalances.push(10000); }
    const mapIx = (ix: typeof sell.transaction.message.instructions[number]) => ({ ...ix, programIdIndex: keys.indexOf(sellKeys[ix.programIdIndex]!), accounts: ix.accounts.map(n => keys.indexOf(sellKeys[n]!)) });
    buy.transaction.message.instructions.push(mapIx(sell.transaction.message.instructions[0]!));
    buy.meta!.innerInstructions!.push({ index: 1, instructions: sell.meta!.innerInstructions![0]!.instructions.map(mapIx) }); buy.meta!.postTokenBalances[0]!.uiTokenAmount.amount = "0";
    i.records = [i.records[0]!, { signature: buy.transaction.signatures[0]!, fetched_at: i.observed_at, status: "available", purposes: ["early"], transaction: buy }];
    const a = await analyzeWalletEvidence(i); expect(a.metrics).toMatchObject({ verified_buys: 1, verified_sells: 1, round_trip_wallets: 1 }); expect(a.trades.every(t => t.net_wallet_base_raw === "0")).toBe(true);
  });
  it("replays real mainnet native-SOL v2/v3 buys and retains gaps instead of asserting bundle membership", async () => {
    const actual = await analyzeWalletEvidence(WalletEvidenceSchema.parse(recorded.evidence));
    expect(actual).toEqual(WalletAnalysisSchema.parse(recorded.expected));
    expect(actual.metrics).toMatchObject({ verified_buys: 7, distinct_buyers: 7, max_same_slot_buyers: 7, max_same_transaction_buyers: 3 });
    expect(actual.trades[0]?.quote_kind).toBe("native_lamports"); expect(actual.actual_bundle_membership).toBe("unknown");
  });
  it("certifies actual token CPI flows, signed creation roles, and same-slot heuristics without claiming bundles", async () => {
    const input = await walletInput(), a = await analyzeWalletEvidence(input);
    expect(a.metrics).toMatchObject({ verified_buys: 3, distinct_buyers: 3, max_same_slot_buyers: 3, dev_funded_supply_pct: null });
    expect(a.signals).toContainEqual(expect.objectContaining({ code: "same_slot_early_buys", strength: "heuristic" }));
    expect(a.actual_bundle_membership).toBe("unknown"); expect(a.exhaustive).toBe(false);
    expect(a.scope.early_window_reached).toBe(true);
    expect(a.wallets.find(w => w.wallet === key(7))).toMatchObject({ signed_creation: true, roles: ["creation_user", "declared_creator"], history_complete: false });
    expect(a.evidence_hash).toBe(await hashJson(WalletEvidenceSchema.parse(input)));
    expect(await hashJson(TransactionSchema.parse(input.records[0]!.transaction))).toBe(input.asset.creation!.payload_hash);
  });
  it("does not label transfers, unsigned users or failed transactions as buyers", async () => {
    const i = await walletInput(), tx = await trade();
    tx.transaction.message.instructions[0]!.data = "1";
    expect((await verifiedTrades(tx, i.asset.address, i.asset.pool)).trades).toEqual([]);
    const unsigned = await trade(); unsigned.transaction.message.header.numRequiredSignatures = 2;
    await expect(verifiedTrades(unsigned, i.asset.address, i.asset.pool)).rejects.toThrow("unsuccessful");
    const failed = await trade(); failed.meta!.err = { InstructionError: [0, "failed"] };
    await expect(verifiedTrades(failed, i.asset.address, i.asset.pool)).rejects.toThrow("unsuccessful");
  });
  it("rejects owner, mint, vault, duplicate-index and missing transfer evidence", async () => {
    const i = await walletInput();
    for (const corrupt of [
      (t: Awaited<ReturnType<typeof trade>>) => { t.meta!.postTokenBalances[0]!.owner = key(55); },
      (t: Awaited<ReturnType<typeof trade>>) => { t.meta!.postTokenBalances[0]!.mint = key(55); },
      (t: Awaited<ReturnType<typeof trade>>) => { t.meta!.innerInstructions = []; },
      (t: Awaited<ReturnType<typeof trade>>) => { t.transaction.message.instructions[0]!.accounts[3] = 0; },
    ]) { const tx = await trade(); corrupt(tx); expect((await verifiedTrades(tx, i.asset.address, i.asset.pool)).trades).toEqual([]); }
    const tx = await trade(); tx.meta!.postTokenBalances.push(tx.meta!.postTokenBalances[0]!);
    await expect(verifiedTrades(tx, i.asset.address, i.asset.pool)).rejects.toThrow("invalid_wallet_token_balance");
  });
  it("resolves loaded addresses while requiring static signer membership", async () => {
    const i = await walletInput(), tx = await trade();
    const last = tx.transaction.message.accountKeys.pop()!; tx.meta!.loadedAddresses!.readonly.push(last);
    expect((await verifiedTrades(tx, i.asset.address, i.asset.pool)).trades).toHaveLength(1);
  });
  it("will not borrow token flows from a sibling CPI", async () => {
    const i = await walletInput(), tx = await trade();
    const buy = tx.transaction.message.instructions[0]!;
    tx.transaction.message.instructions = [{ programIdIndex: 0, accounts: [], data: "1" }];
    tx.meta!.innerInstructions![0]!.instructions.unshift({ ...buy, stackHeight: 2 });
    // Token transfer is another depth-2 CPI, outside the buy subtree.
    expect((await verifiedTrades(tx, i.asset.address, i.asset.pool)).trades).toEqual([]);
  });
  it("keeps missing origin, unsupported responses and truncated early coverage visible", async () => {
    const i = await walletInput(); i.histories = []; i.records[0] = { ...i.records[0]!, status: "unsupported", transaction: null };
    const a = await analyzeWalletEvidence(i);
    expect(a.gaps).toEqual(expect.arrayContaining(["creation_wallets_unverified", "early_history_window_not_reached", "transactions_missing_or_unsupported"]));
    expect(a.metrics.verified_buys).toBe(3);
  });
  it("fails closed on immutable proof, signature, future and history-slot mismatches", async () => {
    for (const kind of ["proof", "signature", "future", "slot", "duplicate"]) {
      const i = await walletInput();
      if (kind === "proof") i.asset.creation!.payload_hash = "a".repeat(64);
      if (kind === "signature") i.records[0]!.signature = signature(70);
      if (kind === "future") i.records[0]!.fetched_at = "2030-01-01T00:00:00Z";
      if (kind === "slot") i.histories[0]!.rows[0]!.slot++;
      if (kind === "duplicate") i.records.push(i.records[0]!);
      await expect(analyzeWalletEvidence(i)).rejects.toThrow();
    }
  });
  it("separates unsigned declared creator from the signed creation user", async () => {
    const i = await walletInput(), tx = i.records[0]!.transaction!, instruction = tx.transaction.message.instructions[0]!;
    const { fromBase58 } = await import("./solana");
    const data = fromBase58(instruction.data); data.set(new Uint8Array(32).fill(12), data.length - 32); instruction.data = toBase58(data);
    expect(await creationRoles(tx, i.asset.address)).toContainEqual({ wallet: key(12), role: "declared_creator", signed: false });
  });
  it("never infers within-slot funding order between separate transactions", async () => {
    const i = await walletInput(), buy = (await verifiedTrades(await trade(), i.asset.address, i.asset.pool)).trades[0]!;
    const tx = await trade(key(12), buy.slot, "buy", 55), system = "11111111111111111111111111111111";
    tx.transaction.message.accountKeys.push(system, key(8)); tx.meta!.preBalances.push(1000, 1000); tx.meta!.postBalances.push(1000, 1000);
    const data = new Uint8Array(12); new DataView(data.buffer).setUint32(0, 2, true); new DataView(data.buffer).setBigUint64(4, 1000n, true);
    tx.transaction.message.instructions = [{ programIdIndex: tx.transaction.message.accountKeys.length - 2, accounts: [0, tx.transaction.message.accountKeys.length - 1], data: toBase58(data) }];
    const links = await fundingTransfers(tx, new Set([key(8)]), [buy]); expect(links[0]?.before_sampled_buy).toBe(false);
    tx.slot--; expect((await fundingTransfers(tx, new Set([key(8)]), [buy]))[0]?.before_sampled_buy).toBe(true);
  });
  it("counts distinct previous token outcomes rather than duplicate reports or the current asset", async () => {
    const i = await walletInput(); i.prior_losses = [{ wallet: key(8), tokens: [key(40), key(40), key(41)], report_hashes: ["a".repeat(64)] }];
    const a = await analyzeWalletEvidence(i); expect(a.wallets.find(w => w.wallet === key(8))?.prior_loss_associations).toBe(1);
    expect(a.signals.some(s => s.code === "prior_distinct_token_loss_associations")).toBe(false);
  });
  it("applies provisional coverage gates and observed exposure exclusions without a same-slot ban", async () => {
    const c = (await fixtureCandidates(now))[0]!, w = await gateSample(), policy = { ...DEFAULT_POLICY, require_holder_evidence: false };
    expect(assess({ ...c, wallet_analysis: w }, policy, now).eligibility).toBe("eligible");
    expect(assess({ ...c, wallet_analysis: { ...w, metrics: { ...w.metrics, dev_sold_supply_pct: 6 } } }, policy, now).reasons).toContain("creation_wallet_sampled_sales_high");
    expect(assess({ ...c, wallet_analysis: { ...w, scope: { ...w.scope, early_window_reached: false } } }, policy, now).eligibility).toBe("provisional");
  });
  it("freezes wallet metrics and roles without borrowing later wallet snapshots", async () => {
    const c = (await fixtureCandidates(now))[0]!, w = await gateSample();
    const measured = (offset: number) => measureOutcome({ candidate: assess({ ...c, wallet_analysis: { ...w, observed_at: new Date(now.getTime() + offset).toISOString() } }, DEFAULT_POLICY, now), selected_at: now.toISOString(), policy: DEFAULT_POLICY }, [], "a".repeat(64), new Date(now.getTime() + 86400000));
    expect(measured(0).features.same_slot_buyers).toBe(3); expect(measured(1).features.same_slot_buyers).toBeNull();
    expect(measured(0).wallets).toContainEqual(expect.objectContaining({ wallet: key(8), role: "buyer" }));
  });
});
