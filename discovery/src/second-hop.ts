import { instructions } from "./pump";
import { fundingTransfers, validWalletTransaction, verifiedTrades } from "./wallet-trades";
import { signer, type WalletTransaction } from "./wallet-rpc";
import { hashJson, Reader } from "./solana";
import { FundingEdgeSchema, SecondHopSchema, type Funding, type FundingEdge, type SecondHop, type VerifiedTrade } from "./wallet-model";
import { fundingCoverage, type FundingAnchor, type FundingScan } from "./funding-history";

export async function directFundingEdges(transactions: WalletTransaction[], recipients?: Set<string>): Promise<FundingEdge[]> {
  const edges: FundingEdge[] = [];
  for (const tx of transactions) {
    validWalletTransaction(tx);
    const hash = await hashJson(tx);
    for (const ix of instructions(tx)) {
      if (ix.inner !== null || ix.program !== "11111111111111111111111111111111" || ix.data.length !== 12) continue;
      const [from, to] = ix.accounts;
      if (!from || !to || from === to || recipients && !recipients.has(to) || !signer(tx, from)) continue;
      const r = new Reader(ix.data); if (r.u32() !== 2) continue; const amount = r.u64(); if (!amount) continue;
      if (edges.length >= 512) throw new Error("second_hop_edge_limit");
      edges.push(FundingEdgeSchema.parse({ from, to, lamports_raw: amount.toString(), signature: tx.transaction.signatures[0], slot: tx.slot, block_time: new Date(tx.blockTime! * 1000).toISOString(), instruction_index: ix.top, transaction_hash: hash }));
    }
  }
  return edges;
}
export function eligibleOutflows(edges: FundingEdge[], funding: Funding[], devs: Set<string>, earlyBuyers: Set<string>, trades: VerifiedTrade[]) {
  return edges.filter(edge => {
    const buy = trades.filter(t => t.wallet === edge.to && t.side === "buy").sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature))[0];
    const beforeBuy = buy && (edge.slot < buy.slot || edge.signature === buy.signature && edge.instruction_index < Number(buy.instruction_index.split(".")[0]));
    return funding.some(f => f.signature === edge.signature && f.from === edge.from && f.to === edge.to && f.lamports_raw === edge.lamports_raw && (f.before_signed_creation && devs.has(f.to) || f.before_sampled_buy && beforeBuy && earlyBuyers.has(f.to)));
  });
}
export function secondHopAnchors(outflows: FundingEdge[], devs: Set<string>): FundingAnchor[] {
  const funders = [...new Set(outflows.map(e => e.from))].sort((a, b) => Number(outflows.some(e => e.from === b && devs.has(e.to))) - Number(outflows.some(e => e.from === a && devs.has(e.to))) || a.localeCompare(b));
  return funders.slice(0, 4).map(wallet => {
    const edge = outflows.filter(e => e.from === wallet).sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature) || a.instruction_index - b.instruction_index)[0]!;
    return { wallet, signature: edge.signature, slot: edge.slot, block_time: edge.block_time, kind: "funding_transfer", instruction_index: edge.instruction_index };
  });
}
export async function buildSecondHopOutflows(transactions: WalletTransaction[], mint: string, pool: string, creationSlot: number | null, devs: Set<string>, anchors: FundingAnchor[], temporaryWsol = false) {
  const trades = (await Promise.all(transactions.map(async tx => (await verifiedTrades(tx, mint, pool, { temporaryWsol })).trades))).flat().sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature) || a.instruction_index.localeCompare(b.instruction_index)).slice(0, 100);
  const early = new Set(trades.filter(t => t.side === "buy" && creationSlot !== null && t.slot >= creationSlot && t.slot <= creationSlot + 20).map(t => t.wallet));
  const targets = new Set([...devs, ...early]);
  const funding = (await Promise.all(transactions.map(tx => fundingTransfers(tx, targets, trades, anchors)))).flat();
  return eligibleOutflows(await directFundingEdges(transactions, targets), funding, devs, early, trades);
}
export async function analyzeSecondHop(transactions: WalletTransaction[], outflows: FundingEdge[], devs: Set<string>, scans: FundingScan[], observedAt: string): Promise<SecondHop> {
  const anchors = secondHopAnchors(outflows, devs), available = new Set(transactions.map(t => t.transaction.signatures[0]!)), gaps = new Set<string>(["common_control_unknown", "funding_sequence_not_coin_provenance", "single_outflow_anchor_per_funder", "third_hop_not_scanned"]);
  if (new Set(scans.map(s => s.wallet)).size !== scans.length) throw new Error("duplicate_second_hop_funder");
  const coverage = [];
  for (const scan of scans) {
    const anchor = anchors.find(a => a.wallet === scan.wallet);
    if (!anchor || await hashJson(anchor) !== await hashJson(scan.anchor)) throw new Error("second_hop_anchor_not_verified");
    if (Date.parse(scan.attempted_at) > Date.parse(observedAt) || scan.pages.some(p => Date.parse(p.fetched_at) > Date.parse(observedAt))) throw new Error("second_hop_scan_from_future");
    for (const record of scan.examined.filter(r => r.status === "available")) {
      const tx = transactions.find(t => t.transaction.signatures[0] === record.signature);
      if (tx) {
        validWalletTransaction(tx);
        if (![...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])].includes(scan.wallet)) throw new Error("second_hop_wallet_not_referenced");
      }
    }
    coverage.push(fundingCoverage(scan, available));
  }
  const eligibleFunders = new Set(outflows.map(e => e.from)).size;
  if (!eligibleFunders) gaps.add("verified_direct_funders_unavailable");
  if (eligibleFunders > 4) gaps.add("second_hop_funder_limit");
  if (anchors.some(a => !scans.some(s => s.wallet === a.wallet)) || coverage.some(c => c.status !== "window_examined")) gaps.add("second_hop_history_partial");
  // Never certify malformed transactions as transfers; missing bodies stay gaps.
  const incoming = await directFundingEdges(transactions, new Set(anchors.map(a => a.wallet)));
  const paths: SecondHop["paths"] = [], seen = new Set<string>();
  for (const down of outflows.filter(d => anchors.some(a => a.wallet === d.from))) for (const up of incoming.filter(e => e.to === down.from)) {
    if (up.from === down.to || up.from === down.from || down.from === down.to) { gaps.add("second_hop_cycles_excluded"); continue; }
    const delta = Date.parse(down.block_time) - Date.parse(up.block_time);
    if (delta < 0 || delta > 3600000) continue;
    const precedes = up.slot < down.slot || up.signature === down.signature && up.instruction_index < down.instruction_index;
    if (!precedes) { if (up.slot === down.slot && up.signature !== down.signature) gaps.add("second_hop_same_slot_order_unknown"); continue; }
    const id = `${up.signature}:${up.instruction_index}:${down.signature}:${down.instruction_index}`;
    if (seen.has(id)) continue; seen.add(id);
    if (paths.length >= 50) { gaps.add("second_hop_path_limit"); continue; }
    paths.push({ source: up.from, intermediary: down.from, target: down.to, target_role: devs.has(down.to) ? "signed_creation" : "early_buyer", upstream: up, downstream: down });
  }
  return SecondHopSchema.parse({ depth: 2, eligible_funders: eligibleFunders, coverage, paths, gaps: [...gaps] });
}
