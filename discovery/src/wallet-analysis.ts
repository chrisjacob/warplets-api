import { z } from "zod";
import { Address, ProofSchema, Signature } from "./model";
import { HolderSchema } from "./holder-model";
import { analyzeHolders, HolderEvidenceSchema } from "./holders";
import { MAINNET_GENESIS, SignatureRows, TransactionSchema } from "./rpc";
import { WalletTransactionSchema, type WalletTransaction } from "./wallet-rpc";
import { creationRoles, fundingTransfers, verifiedTrades, validWalletTransaction } from "./wallet-trades";
import { WalletAnalysisSchema, type WalletAnalysis, type VerifiedTrade } from "./wallet-model";
import { base64, hashJson, Reader } from "./solana";
import { ATA } from "./pump";
import { findPda, publicKey } from "./solana";
import { FundingScanSchema, fundingCoverage } from "./funding-history";
import { analyzeSecondHop, buildSecondHopOutflows } from "./second-hop";

export const WalletEvidenceSchema = z.object({
  version: z.enum(["wallet-input-v1", "wallet-input-v2", "wallet-input-v3", "wallet-input-v4"]), observed_at: z.string().datetime(), cluster: z.literal(MAINNET_GENESIS),
  funding_scans: z.array(FundingScanSchema).max(8).optional(),
  second_hop_scans: z.array(FundingScanSchema).max(4).optional(),
  asset: z.object({ address: Address, pool: Address, token_program: Address, creation: ProofSchema.nullable(), graduation: ProofSchema.nullable() }).strict(),
  records: z.array(z.object({ signature: Signature, fetched_at: z.string().datetime(), status: z.enum(["available", "missing", "unsupported"]), purposes: z.array(z.enum(["origin", "early", "recent", "wallet"])).max(4), transaction: WalletTransactionSchema.nullable() }).strict()).max(64),
  histories: z.array(z.object({ address: Address, purpose: z.enum(["curve", "pool", "wallet"]), fetched_at: z.string().datetime(), rows: SignatureRows }).strict()).max(8),
  holders: z.object({ analysis: HolderSchema, evidence: HolderEvidenceSchema }).strict().nullable(),
  prior_losses: z.array(z.object({ wallet: Address, tokens: z.array(Address).max(100), report_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(30) }).strict()).max(20),
  gaps: z.array(z.string()).max(40),
}).strict();
export type WalletEvidence = z.infer<typeof WalletEvidenceSchema>;
const ratio = (amount: bigint, supply: bigint) => Number((amount * 100000000n + supply - 1n) / supply) / 1000000;
const distinct = <T>(items: T[]) => [...new Set(items)];
export async function analyzeWalletEvidence(raw: WalletEvidence): Promise<WalletAnalysis> {
  const input = WalletEvidenceSchema.parse(raw), { asset } = input;
  if (input.version !== "wallet-input-v1" && !input.funding_scans || input.version === "wallet-input-v1" && input.funding_scans) throw new Error("funding_evidence_version_mismatch");
  const secondHopEnabled = input.version === "wallet-input-v3" || input.version === "wallet-input-v4";
  if (secondHopEnabled ? !input.second_hop_scans : input.second_hop_scans !== undefined) throw new Error("second_hop_evidence_version_mismatch");
  const gaps = new Set([...input.gaps, "actual_bundle_membership_unknown", "beneficial_owner_links_unknown", "historical_wallet_coverage_incomplete", "exchange_or_sponsor_funding_possible", "cross_token_pnl_and_fees_unknown"]);
  const available: WalletTransaction[] = [], seen = new Set<string>();
  for (const record of input.records) {
    if (seen.has(record.signature)) throw new Error("duplicate_wallet_transaction"); seen.add(record.signature);
    if (record.status !== "available") { if (record.transaction !== null) throw new Error("invalid_wallet_record"); continue; }
    if (!record.transaction || record.transaction.transaction.signatures[0] !== record.signature) throw new Error("wallet_record_signature_mismatch");
    if (Date.parse(record.fetched_at) > Date.parse(input.observed_at) || record.transaction.blockTime === null || record.transaction.blockTime * 1000 > Date.parse(input.observed_at)) throw new Error("wallet_record_from_future");
    // A history row cannot be swapped for a different slot/transaction response.
    for (const history of [...input.histories, ...(input.funding_scans ?? []).flatMap(s => s.pages), ...(input.second_hop_scans ?? []).flatMap(s => s.pages)]) for (const row of history.rows.filter(r => r.signature === record.signature)) {
      if (row.slot !== record.transaction.slot || row.err !== null || row.confirmationStatus !== "finalized") throw new Error("wallet_history_transaction_mismatch");
    }
    available.push(record.transaction);
  }
  for (const proof of [asset.creation, asset.graduation]) {
    const tx = available.find(t => t.transaction.signatures[0] === proof?.signature);
    if (tx && proof && (tx.slot !== proof.slot || await hashJson(TransactionSchema.parse(tx)) !== proof.payload_hash)) throw new Error("wallet_origin_proof_mismatch");
  }
  const origin = available.find(tx => tx.transaction.signatures[0] === asset.creation?.signature);
  const roles = origin ? await creationRoles(origin, asset.address) : [];
  if (!roles.length) gaps.add("creation_wallets_unverified");
  const tradeMap = new Map<string, VerifiedTrade>();
  for (const tx of available) {
    try {
      const result = await verifiedTrades(tx, asset.address, asset.pool, { temporaryWsol: input.version === "wallet-input-v4" });
      result.gaps.forEach(g => gaps.add(g));
      for (const t of result.trades) tradeMap.set(`${t.signature}:${t.instruction_index}`, t);
    } catch { gaps.add("transaction_not_certified_for_trade_analysis"); }
  }
  const trades = [...tradeMap.values()].sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature) || a.instruction_index.localeCompare(b.instruction_index)).slice(0, 100);
  if (tradeMap.size > 100) gaps.add("trade_output_limit");
  const buyers = distinct(trades.filter(t => t.side === "buy").map(t => t.wallet));
  const coverage = (input.funding_scans ?? []).map(scan => {
    const anchor = scan.anchor, tx = available.find(t => t.transaction.signatures[0] === anchor.signature);
    if (anchor.kind === "funding_transfer" || anchor.instruction_index !== undefined) throw new Error("invalid_first_hop_anchor");
    const buy = trades.find(t => t.side === "buy" && t.wallet === scan.wallet && t.signature === anchor.signature && t.slot === anchor.slot && t.block_time === anchor.block_time);
    const creation = asset.creation;
    if (scan.wallet !== anchor.wallet || !tx || (anchor.kind === "sampled_buy" ? !buy : !roles.some(r => r.wallet === scan.wallet && r.signed) || creation?.signature !== anchor.signature || creation.slot !== anchor.slot || creation.block_time !== anchor.block_time)) throw new Error("funding_anchor_not_verified");
    if (Date.parse(scan.attempted_at) > Date.parse(input.observed_at) || scan.pages.some(p => Date.parse(p.fetched_at) > Date.parse(input.observed_at))) throw new Error("funding_scan_from_future");
    for (const record of scan.examined.filter(r => r.status === "available")) {
      const transaction = available.find(t => t.transaction.signatures[0] === record.signature);
      if (transaction) { validWalletTransaction(transaction); if (![...transaction.transaction.message.accountKeys, ...(transaction.meta?.loadedAddresses?.writable ?? []), ...(transaction.meta?.loadedAddresses?.readonly ?? [])].includes(scan.wallet)) throw new Error("funding_wallet_not_referenced"); }
    }
    return fundingCoverage(scan, new Set(available.map(t => t.transaction.signatures[0]!)));
  });
  if (new Set(coverage.map(c => c.wallet)).size !== coverage.length) throw new Error("duplicate_funding_wallet_scan");
  if (buyers.some(wallet => input.version !== "wallet-input-v1" ? !coverage.some(c => c.wallet === wallet && c.status === "window_examined" && (c.anchor_kind === "sampled_buy" || c.anchor_at === trades.find(t => t.side === "buy" && t.wallet === wallet)?.block_time)) : !input.histories.some(h => h.purpose === "wallet" && h.address === wallet))) gaps.add("buyer_funding_histories_not_all_sampled");
  if (coverage.some(c => c.status !== "window_examined")) gaps.add("pre_buy_funding_coverage_partial");
  const devs = new Set(roles.filter(r => r.signed).map(r => r.wallet));
  const tracked = new Set([...roles.map(r => r.wallet), ...buyers, ...trades.filter(t => t.side === "sell").map(t => t.wallet)].slice(0, 20));
  if (distinct([...roles.map(r => r.wallet), ...trades.map(t => t.wallet)]).length > 20) gaps.add("wallet_output_limit");
  const allFunding = (await Promise.all(available.map(async tx => { try { return await fundingTransfers(tx, tracked, trades, input.funding_scans?.map(s => s.anchor)); } catch { return []; } }))).flat();
  if (input.version !== "wallet-input-v1" && allFunding.length > 100) gaps.add("funding_output_limit");
  const funding = allFunding.slice(0, 100);
  const early = trades.filter(t => t.side === "buy" && asset.creation && t.slot >= asset.creation.slot && t.slot <= asset.creation.slot + 20);
  const firstHopSignatures = new Set(input.records.filter(r => r.purposes.some(p => p !== "wallet")).map(r => r.signature).concat((input.funding_scans ?? []).flatMap(s => s.examined.map(e => e.signature))));
  const secondHop = secondHopEnabled ? await analyzeSecondHop(available, await buildSecondHopOutflows(available.filter(t => firstHopSignatures.has(t.transaction.signatures[0]!)), asset.address, asset.pool, asset.creation?.slot ?? null, devs, input.funding_scans!.map(s => s.anchor), input.version === "wallet-input-v4"), devs, input.second_hop_scans!, input.observed_at) : undefined;
  const slotGroups = new Map<number, Set<string>>(), transactionGroups = new Map<string, Set<string>>(), feeGroups = new Map<string, Set<string>>();
  for (const t of early) {
    slotGroups.set(t.slot, new Set([...(slotGroups.get(t.slot) ?? []), t.wallet]));
    transactionGroups.set(t.signature, new Set([...(transactionGroups.get(t.signature) ?? []), t.wallet]));
    feeGroups.set(t.fee_payer, new Set([...(feeGroups.get(t.fee_payer) ?? []), t.wallet]));
  }
  const linked = funding.filter(f => f.before_sampled_buy && buyers.includes(f.to));
  const byFunder = new Map<string, Set<string>>();
  for (const f of linked) byFunder.set(f.from, new Set([...(byFunder.get(f.from) ?? []), f.to]));
  const commonBuyers = distinct([...byFunder.values()].filter(s => s.size >= 2).flatMap(s => [...s]));
  const devFunded = distinct(linked.filter(f => devs.has(f.from) && f.from !== f.to).map(f => f.to));
  const roundTrips = distinct(trades.filter(t => trades.some(other => other.wallet === t.wallet && other.signature === t.signature && other.side !== t.side)).map(t => t.wallet));
  const signals: WalletAnalysis["signals"] = [];
  const add = (code: string, wallets: string[], signatures: string[], strength: "observed" | "heuristic" = "heuristic") => {
    if (signals.length < 20) signals.push({ code, wallets: distinct(wallets).slice(0, 20), signatures: distinct(signatures).slice(0, 20), strength });
  };
  for (const [slot, group] of slotGroups) if (group.size >= 3) add("same_slot_early_buys", [...group], early.filter(t => t.slot === slot).map(t => t.signature));
  for (const [signature, group] of transactionGroups) if (group.size >= 2) add("same_transaction_early_buys", [...group], [signature], "observed");
  for (const [payer, group] of feeGroups) if (group.size >= 2) add("shared_early_fee_payer", [payer, ...group], early.filter(t => t.fee_payer === payer).map(t => t.signature));
  if (commonBuyers.length) add("shared_direct_funding_source", commonBuyers, linked.filter(f => commonBuyers.includes(f.to)).map(f => f.signature));
  if (secondHop) {
    for (const source of distinct(secondHop.paths.map(p => p.source))) {
      const paths = secondHop.paths.filter(p => p.source === source), intermediaries = distinct(paths.map(p => p.intermediary));
      if (intermediaries.length >= 2 && paths.some(p => p.target_role === "signed_creation") && paths.some(p => p.target_role === "early_buyer")) add("shared_upstream_creation_and_buyer_source", [source, ...intermediaries, ...paths.map(p => p.target)], paths.flatMap(p => [p.upstream.signature, p.downstream.signature]));
    }
    const devPaths = secondHop.paths.filter(p => devs.has(p.source) && p.target_role === "early_buyer");
    if (devPaths.length) add("creation_wallet_to_early_buyer_via_funder", devPaths.flatMap(p => [p.source, p.intermediary, p.target]), devPaths.flatMap(p => [p.upstream.signature, p.downstream.signature]), "observed");
    if (secondHop.gaps.some(g => g.endsWith("_limit") || g === "second_hop_history_partial")) gaps.add("second_hop_coverage_partial");
  }
  for (const source of distinct(funding.filter(f => f.before_signed_creation && devs.has(f.to)).map(f => f.from))) {
    const connections = funding.filter(f => f.from === source && (f.before_signed_creation && devs.has(f.to) || f.before_sampled_buy && buyers.includes(f.to)));
    if (connections.some(f => buyers.includes(f.to) && !devs.has(f.to))) add("shared_creation_and_buyer_funder", [source, ...connections.map(f => f.to)], connections.map(f => f.signature));
  }
  if (devFunded.length) add("creation_wallet_funded_buyers", devFunded, linked.filter(f => devs.has(f.from)).map(f => f.signature), "observed");
  if (roundTrips.length) add("same_transaction_round_trip", roundTrips, trades.filter(t => roundTrips.includes(t.wallet)).map(t => t.signature), "observed");
  const devSales = trades.filter(t => devs.has(t.wallet) && t.side === "sell");
  if (devSales.length) add("creation_wallet_sales_observed", devSales.map(t => t.wallet), devSales.map(t => t.signature), "observed");
  let supply: bigint | null = null;
  const balances = new Map<string, bigint>();
  if (input.holders) {
    const h = input.holders.analysis, replay = await analyzeHolders(input.holders.evidence, h.observed_at);
    if (await hashJson(replay) !== await hashJson(h) || input.holders.evidence.mint !== asset.address || input.holders.evidence.pool !== asset.pool || input.holders.evidence.program !== asset.token_program) throw new Error("wallet_holder_snapshot_mismatch");
    if (h.status === "verified" && h.layout_certified && Date.parse(input.observed_at) >= Date.parse(h.observed_at) && Date.parse(input.observed_at) - Date.parse(h.observed_at) <= 1800000) {
      supply = BigInt(h.supply_raw);
      const vault = await findPda(ATA, [publicKey(asset.pool), publicKey(asset.token_program), publicKey(asset.address)]);
      for (const row of input.holders.evidence.inventory.value) {
        if (row.pubkey === vault) continue;
        const r = new Reader(base64(row.account.data[0])); r.key(); const owner = r.key(), amount = r.u64(); balances.set(owner, (balances.get(owner) ?? 0n) + amount);
      }
    } else gaps.add("wallet_current_holdings_unverified_or_stale");
  } else gaps.add("wallet_current_holdings_unverified_or_stale");
  const wallets: WalletAnalysis["wallets"] = [];
  for (const wallet of tracked) {
    const own = trades.filter(t => t.wallet === wallet), history = input.histories.find(h => h.purpose === "wallet" && h.address === wallet);
    const historyRows = input.version !== "wallet-input-v1" ? input.funding_scans?.find(s => s.wallet === wallet)?.pages.flatMap(p => p.rows) : history?.rows;
    const prior = input.prior_losses.find(p => p.wallet === wallet);
    const losses = devs.has(wallet) || own.length ? distinct(prior?.tokens.filter(token => token !== asset.address) ?? []).length : 0;
    if (losses >= 2) add("prior_distinct_token_loss_associations", [wallet], [], "observed");
    const bought = own.filter(t => t.side === "buy").reduce((n, t) => n + BigInt(t.base_amount_raw), 0n), sold = own.filter(t => t.side === "sell").reduce((n, t) => n + BigInt(t.base_amount_raw), 0n);
    const roleNames = [...roles.filter(r => r.wallet === wallet).map(r => r.role), ...(own.some(t => t.side === "buy") ? ["buyer" as const] : []), ...(own.some(t => t.side === "sell") ? ["seller" as const] : [])];
    wallets.push({ wallet, roles: distinct(roleNames), signed_creation: devs.has(wallet), buys: own.filter(t => t.side === "buy").length, sells: own.filter(t => t.side === "sell").length, bought_raw: bought.toString(), sold_raw: sold.toString(), net_bought_raw: (bought - sold).toString(), current_supply_pct: supply ? ratio(balances.get(wallet) ?? 0n, supply) : null,
      oldest_observed_reference_at: historyRows?.filter(r => r.blockTime !== null).map(r => new Date(r.blockTime! * 1000).toISOString()).sort()[0] ?? null,
      history_signatures: historyRows?.length ?? 0, history_complete: false, prior_loss_associations: losses,
      gaps: ["lifetime_wallet_history_unknown", ...(historyRows ? [] : ["wallet_history_not_sampled"]), ...(roles.some(r => r.wallet === wallet && !r.signed) ? ["declared_role_not_signed_creation"] : [])],
    });
  }
  const curveHistories = input.histories.filter(h => h.purpose === "curve");
  const reached = Boolean(asset.creation && curveHistories.some(h => h.rows.some(r => r.signature === asset.creation!.signature)));
  if (!reached) gaps.add("early_history_window_not_reached");
  if (!buyers.length) gaps.add("verified_buyer_sample_unavailable");
  if (input.records.some(r => r.status !== "available")) gaps.add("transactions_missing_or_unsupported");
  return WalletAnalysisSchema.parse({
    version: input.version === "wallet-input-v4" ? "wallet-signals-v4" : input.version === "wallet-input-v3" ? "wallet-signals-v3" : input.version !== "wallet-input-v1" ? "wallet-signals-v2" : "wallet-signals-v1", ...(input.version !== "wallet-input-v1" ? { funding_coverage: coverage } : {}), ...(secondHop ? { second_hop: secondHop } : {}), observed_at: input.observed_at, evidence_hash: await hashJson(input), status: signals.length ? "signals_detected" : trades.length ? "no_signal_in_sample" : "unavailable",
    source: "solana-finalized-rpc", coverage: "bounded_sample", actual_bundle_membership: "unknown", exhaustive: false,
    creation_slot: asset.creation?.slot ?? null, holder_snapshot_at: input.holders?.analysis.observed_at ?? null,
    scope: { curve_pages: curveHistories.length, early_window_reached: reached, signatures_considered: input.histories.reduce((n, h) => n + h.rows.length, 0) + coverage.reduce((n, c) => n + c.signatures, 0) + (secondHop?.coverage.reduce((n, c) => n + c.signatures, 0) ?? 0), transactions_examined: available.length, unsupported_or_missing_transactions: input.records.filter(r => r.status !== "available").length, wallet_histories_examined: input.version !== "wallet-input-v1" ? coverage.filter(c => c.pages > 0).length + (secondHop?.coverage.filter(c => c.pages > 0).length ?? 0) : input.histories.filter(h => h.purpose === "wallet").length },
    metrics: { verified_buys: trades.filter(t => t.side === "buy").length, verified_sells: trades.filter(t => t.side === "sell").length, distinct_buyers: buyers.length, max_same_slot_buyers: Math.max(0, ...[...slotGroups.values()].map(s => s.size)), max_same_transaction_buyers: Math.max(0, ...[...transactionGroups.values()].map(s => s.size)), shared_funder_buyers: commonBuyers.length, dev_funded_buyers: devFunded.length, dev_funded_supply_pct: supply ? ratio(devFunded.reduce((n, wallet) => n + (balances.get(wallet) ?? 0n), 0n), supply) : null, dev_sold_supply_pct: supply ? ratio(devSales.reduce((n, t) => n + BigInt(t.base_amount_raw), 0n), supply) : null, round_trip_wallets: roundTrips.length },
    signals, trades, funding, wallets, gaps: [...gaps].slice(0, 50),
  });
}
