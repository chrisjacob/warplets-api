// Synthetic test builders; never served as live evidence.
import schema from "../protocol/trade-schema.json";
import { syntheticBundle } from "./fixtures";
import { ATA, curveAddress, TOKEN, PUMP, canonicalPool, creationProof } from "./pump";
import { findPda, publicKey, toBase58 } from "./solana";
import { TransactionSchema } from "./rpc";
import { WalletTransactionSchema, type WalletTransaction } from "./wallet-rpc";
import { analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
export const key = (n: number) => toBase58(new Uint8Array(32).fill(n));
export const signature = (n: number) => toBase58(new Uint8Array(64).fill(n));
const bytes = (amount: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, amount, true); return [...b]; };
export const now = new Date("2026-10-20T00:00:00Z");
export async function trade(wallet = key(8), slot = 10001, side = "buy", sig = 31): Promise<WalletTransaction> {
  const b = await syntheticBundle(now), curve = await curveAddress(b.mint);
  const ata = (owner: string) => findPda(ATA, [publicKey(owner), publicKey(TOKEN), publicKey(b.mint)]);
  const vault = await ata(curve), user = await ata(wallet), d = schema.instructions.find(d => d.program === PUMP && d.name === side)!;
  const values: Record<string, string> = { mint: b.mint, bonding_curve: curve, associated_bonding_curve: vault, associated_user: user, user: wallet, token_program: TOKEN };
  const addresses = [...new Set([wallet, PUMP, TOKEN, ...d.accounts.map(n => values[n] ?? key(99))])];
  const index = (s: string) => addresses.indexOf(s);
  const balance = (amount: string) => ({ accountIndex: index(user), mint: b.mint, owner: wallet, programId: TOKEN, uiTokenAmount: { amount, decimals: 6 } });
  return WalletTransactionSchema.parse({ slot, blockTime: Math.floor(now.getTime() / 1000) - 3599, version: 0,
    transaction: { signatures: [signature(sig)], message: { header: { numRequiredSignatures: 1 }, accountKeys: addresses, instructions: [{ programIdIndex: index(PUMP), accounts: d.accounts.map(n => index(values[n] ?? key(99))), data: toBase58(Uint8Array.from([...d.discriminator, ...bytes(100n), ...bytes(100n)])) }] } },
    meta: { err: null, fee: 5000, loadedAddresses: { writable: [], readonly: [] }, preBalances: addresses.map(() => 10000), postBalances: addresses.map(() => 10000), preTokenBalances: [balance(side === "buy" ? "0" : "100")], postTokenBalances: [balance(side === "buy" ? "100" : "0")], innerInstructions: [{ index: 0, instructions: [{ programIdIndex: index(TOKEN), accounts: side === "buy" ? [index(vault), index(user)] : [index(user), index(vault)], stackHeight: 2, data: toBase58(Uint8Array.from([3, ...bytes(100n)])) }] }] } });
}
export async function walletInput(): Promise<WalletEvidence> {
  const b = await syntheticBundle(now), old = b.creation.transaction.message.accountKeys;
  const unique = [...new Set([key(7), ...old])];
  const tx = WalletTransactionSchema.parse({ ...b.creation, transaction: { signatures: b.creation.transaction.signatures, message: { header: { numRequiredSignatures: 1 }, accountKeys: unique, instructions: b.creation.transaction.message.instructions.map(i => ({ ...i, programIdIndex: unique.indexOf(old[i.programIdIndex]!), accounts: i.accounts.map(n => unique.indexOf(old[n]!)) })) } }, meta: { ...b.creation.meta, fee: 5000, preBalances: unique.map(() => 10000), postBalances: unique.map(() => 10000), preTokenBalances: [], postTokenBalances: [] } });
  const proof = (await creationProof(TransactionSchema.parse(tx), b.mint, now.toISOString()))!.proof;
  const trades = await Promise.all([trade(key(8), 10001, "buy", 31), trade(key(9), 10001, "buy", 32), trade(key(10), 10001, "buy", 33)]);
  return { version: "wallet-input-v1", observed_at: now.toISOString(), cluster: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", asset: { address: b.mint, pool: (await canonicalPool(b.mint)).pool, token_program: TOKEN, creation: proof, graduation: null }, records: [tx, ...trades].map((t, i) => ({ signature: t.transaction.signatures[0]!, fetched_at: now.toISOString(), status: "available", purposes: [i ? "early" : "origin"], transaction: t })), histories: [{ address: await curveAddress(b.mint), purpose: "curve", fetched_at: now.toISOString(), rows: [{ signature: proof.signature, slot: proof.slot, blockTime: tx.blockTime, err: null, confirmationStatus: "finalized" }] }], holders: null, prior_losses: [], gaps: [] };
}
export async function gateSample() {
  const w = await analyzeWalletEvidence(await walletInput());
  // Policy-only fixture: integration holder replay is tested separately.
  return { ...w, gaps: w.gaps.filter(g => g !== "buyer_funding_histories_not_all_sampled"), metrics: { ...w.metrics, dev_funded_supply_pct: 0, dev_sold_supply_pct: 0 } };
}
