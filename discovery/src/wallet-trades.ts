import tradeSchema from "../protocol/trade-schema.json";
import pumpSchema from "../protocol/pump-schema.json";
import { AMM, ATA, canonicalPool, creationProof, curveAddress, instructions, PUMP, TOKEN, TOKEN_2022, WSOL } from "./pump";
import { bytesEqual, findPda, hashJson, publicKey, Reader } from "./solana";
import { TransactionSchema } from "./rpc";
import { keys, signer, type WalletTransaction } from "./wallet-rpc";
import { TradeSchema, type Funding, type VerifiedTrade } from "./wallet-model";
import type { FundingAnchor } from "./funding-history";
import { temporaryWsolOwner } from "./temporary-wsol";

const SYSTEM = "11111111111111111111111111111111";
type Ix = ReturnType<typeof instructions>[number];
const ata = (owner: string, program: string, mint: string) => findPda(ATA, [publicKey(owner), publicKey(program), publicKey(mint)]);
function descendants(all: Ix[], parent: Ix): Ix[] {
  return all.filter(child => {
    if (child.top !== parent.top || child.inner === null) return false;
    if (parent.inner === null) return true;
    if (parent.stack === null || child.stack === null || child.inner <= parent.inner || child.stack <= parent.stack) return false;
    return !all.some(between => between.top === parent.top && between.inner !== null && between.inner > parent.inner! && between.inner < child.inner! && between.stack !== null && between.stack <= parent.stack!);
  });
}
function tokenFlow(children: Ix[], from: string, to: string, program: string, mint: string): bigint {
  let sum = 0n;
  for (const ix of children) {
    if (ix.program !== program || !ix.data.length) continue;
    const r = new Reader(ix.data), tag = r.u8();
    if (tag === 3 && ix.data.length === 9 && ix.accounts[0] === from && ix.accounts[1] === to) sum += r.u64();
    if (tag === 12 && ix.data.length === 10 && ix.accounts[0] === from && ix.accounts[1] === mint && ix.accounts[2] === to) sum += r.u64();
  }
  return sum;
}
function nativeFlow(children: Ix[], from: string, to: string): bigint {
  let sum = 0n;
  for (const ix of children) if (ix.program === SYSTEM && ix.data.length === 12 && ix.accounts[0] === from && ix.accounts[1] === to) {
    const r = new Reader(ix.data); if (r.u32() === 2) sum += r.u64();
  }
  return sum;
}
export function validWalletTransaction(tx: WalletTransaction): void {
  const addresses = keys(tx), meta = tx.meta;
  if (!meta || meta.err !== null || tx.blockTime === null || !signer(tx, tx.transaction.message.accountKeys[0]!)) throw new Error("unsuccessful_or_unsupported_wallet_transaction");
  if (addresses.length > 256 || new Set(addresses).size !== addresses.length || meta.preBalances.length !== addresses.length || meta.postBalances.length !== addresses.length) throw new Error("wallet_account_index_mismatch");
  for (const balances of [meta.preTokenBalances, meta.postTokenBalances]) {
    const indexes = new Set<number>();
    for (const balance of balances) {
      if (balance.accountIndex >= addresses.length || indexes.has(balance.accountIndex) || BigInt(balance.uiTokenAmount.amount) > 18446744073709551615n) throw new Error("invalid_wallet_token_balance");
      indexes.add(balance.accountIndex);
    }
  }
}
function ownsAccount(tx: WalletTransaction, account: string, wallet: string, mint: string, program: string): boolean {
  const index = keys(tx).indexOf(account), meta = tx.meta!;
  if (index < 0) return false;
  const pre = meta.preTokenBalances.find(b => b.accountIndex === index), post = meta.postTokenBalances.find(b => b.accountIndex === index);
  if (!pre && !post) return false;
  if (!pre && meta.preBalances[index] !== 0) return false;
  if (!post && meta.postBalances[index] !== 0) return false;
  return [pre, post].every(b => !b || b.mint === mint && b.owner === wallet && (!b.programId || b.programId === program));
}
function walletNet(tx: WalletTransaction, wallet: string, mint: string): bigint {
  const sum = (rows: NonNullable<WalletTransaction["meta"]>["preTokenBalances"]) => rows.filter(b => b.owner === wallet && b.mint === mint).reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(tx.meta!.postTokenBalances) - sum(tx.meta!.preTokenBalances);
}
export async function verifiedTrades(tx: WalletTransaction, mint: string, pool: string, options: { temporaryWsol?: boolean } = {}): Promise<{ trades: VerifiedTrade[]; gaps: string[] }> {
  validWalletTransaction(tx);
  const all = instructions(tx), canonical = await canonicalPool(mint), curve = await curveAddress(mint);
  if (pool !== canonical.pool) throw new Error("noncanonical_wallet_pool");
  const trades: VerifiedTrade[] = [], gaps = new Set<string>();
  const transactionHash = await hashJson(tx);
  for (const ix of all) {
    const d = tradeSchema.instructions.find(d => d.program === ix.program && bytesEqual(ix.data, d.discriminator));
    if (!d) continue;
    if (ix.accounts.length < d.accounts.length || ix.data.length < 24) { gaps.add("trade_layout_not_certified"); continue; }
    const a = Object.fromEntries(d.accounts.map((name, i) => [name, ix.accounts[i]!]));
    if ((a.mint ?? a.base_mint) !== mint) continue;
    const user = a.user!, tokenProgram = a.token_program ?? a.base_token_program!;
    if (![TOKEN, TOKEN_2022].includes(tokenProgram) || !signer(tx, user)) { gaps.add("trade_user_not_transaction_signer"); continue; }
    const side = d.name.startsWith("buy") ? "buy" : "sell", children = descendants(all, ix);
    let vault: string, userBase: string, quoteAmount: bigint | null = null;
    let quoteKind: "native_lamports" | "wsol_raw";
    let temporaryQuote = false;
    if (ix.program === PUMP) {
      vault = a.associated_bonding_curve ?? a.associated_base_bonding_curve!;
      userBase = a.associated_user ?? a.associated_base_user!;
      if (a.bonding_curve !== curve || vault !== await ata(curve, tokenProgram, mint) || userBase !== await ata(user, tokenProgram, mint) || a.quote_mint && a.quote_mint !== WSOL) { gaps.add("noncanonical_trade_accounts"); continue; }
      quoteKind = "native_lamports";
      if (!a.quote_mint) quoteAmount = nativeFlow(children, side === "buy" ? user : curve, side === "buy" ? curve : user) || null;
      else {
        // Pump BUY/SELL v2/v3 use native SOL for SOL-paired curves. Their
        // quote ATAs are seed-constrained placeholders, not required balances.
        if (a.quote_token_program !== TOKEN || a.associated_quote_bonding_curve !== await ata(curve, TOKEN, WSOL) || a.associated_quote_user !== await ata(user, TOKEN, WSOL)) { gaps.add("quote_trade_accounts_unverified"); continue; }
        quoteAmount = nativeFlow(children, side === "buy" ? user : curve, side === "buy" ? curve : user) || null;
      }
    } else if (ix.program === AMM) {
      vault = a.pool_base_token_account!; userBase = a.user_base_token_account!;
      if (a.pool !== pool || a.quote_mint !== WSOL || a.quote_token_program !== TOKEN || vault !== await ata(pool, tokenProgram, mint) || a.pool_quote_token_account !== await ata(pool, TOKEN, WSOL)) { gaps.add("noncanonical_trade_accounts"); continue; }
      if (!ownsAccount(tx, a.user_quote_token_account!, user, WSOL, TOKEN)) {
        if (!options.temporaryWsol || !temporaryWsolOwner(tx, a.user_quote_token_account!, user, ix)) { gaps.add("quote_trade_accounts_unverified"); continue; }
        temporaryQuote = true;
      }
      quoteKind = "wsol_raw";
      quoteAmount = tokenFlow(children, side === "buy" ? a.user_quote_token_account! : a.pool_quote_token_account!, side === "buy" ? a.pool_quote_token_account! : a.user_quote_token_account!, TOKEN, WSOL) || null;
      if (quoteAmount === null) { gaps.add("amm_quote_transfer_unverified"); continue; }
    } else continue;
    if (!ownsAccount(tx, userBase, user, mint, tokenProgram)) { gaps.add("trade_token_owner_unverified"); continue; }
    const amount = tokenFlow(children, side === "buy" ? vault : userBase, side === "buy" ? userBase : vault, tokenProgram, mint);
    if (amount <= 0n) { gaps.add("trade_base_transfer_unverified"); continue; }
    if (quoteAmount === null) gaps.add("native_quote_amount_unmeasured");
    trades.push(TradeSchema.parse({
      signature: tx.transaction.signatures[0], slot: tx.slot, block_time: new Date(tx.blockTime! * 1000).toISOString(),
      instruction_index: ix.path, program: ix.program, instruction: d.name, side, wallet: user,
      fee_payer: tx.transaction.message.accountKeys[0], base_amount_raw: amount.toString(), quote_amount_raw: quoteAmount?.toString() ?? null,
      quote_kind: quoteKind, net_wallet_base_raw: walletNet(tx, user, mint).toString(), transaction_hash: transactionHash,
      ...(temporaryQuote ? { quote_account_proof: "temporary_wsol_lifecycle" } : {}),
    }));
  }
  return { trades, gaps: [...gaps] };
}
export async function creationRoles(tx: WalletTransaction, mint: string): Promise<{ wallet: string; role: "creation_user" | "declared_creator"; signed: boolean }[]> {
  validWalletTransaction(tx);
  if (!await creationProof(TransactionSchema.parse(tx), mint, new Date(tx.blockTime! * 1000).toISOString())) return [];
  for (const ix of instructions(tx)) {
    const d = pumpSchema.instructions.find(d => ["create", "create_v2"].includes(d.name) && ix.program === PUMP && bytesEqual(ix.data, d.discriminator));
    if (!d || ix.accounts[d.accounts.indexOf("mint")] !== mint) continue;
    const user = ix.accounts[d.accounts.indexOf("user")]!;
    const r = new Reader(ix.data, 8); r.string(100); r.string(32); r.string(1024); const creator = r.key();
    return [{ wallet: user, role: "creation_user", signed: signer(tx, user) }, { wallet: creator, role: "declared_creator", signed: signer(tx, creator) }];
  }
  return [];
}
export async function fundingTransfers(tx: WalletTransaction, tracked: Set<string>, trades: VerifiedTrade[], anchors?: FundingAnchor[]): Promise<Funding[]> {
  validWalletTransaction(tx); const found: Funding[] = [], transactionHash = await hashJson(tx);
  for (const ix of instructions(tx)) {
    // Top-level, directly signed System transfers only. Rent, wrapped-SOL
    // refunds and pool CPIs are not treated as wallet funding links.
    if (ix.inner !== null || ix.program !== SYSTEM || ix.data.length !== 12) continue;
    const [from, to] = ix.accounts; if (!from || !to || from === to || !tracked.has(to) || !signer(tx, from)) continue;
    const r = new Reader(ix.data); if (r.u32() !== 2) continue; const amount = r.u64(); if (!amount) continue;
    const first = trades.filter(t => t.wallet === to && t.side === "buy").sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature))[0];
    const time = tx.blockTime! * 1000, buyTime = first ? Date.parse(first.block_time) : null;
    const precedes = first && (tx.slot < first.slot || first.signature === tx.transaction.signatures[0] && ix.top < Number(first.instruction_index.split(".")[0]));
    const creation = anchors?.find(a => a.wallet === to && a.kind === "signed_creation"), createdAt = creation ? Date.parse(creation.block_time) : null;
    found.push({ from, to, lamports_raw: amount.toString(), signature: tx.transaction.signatures[0]!, slot: tx.slot, block_time: new Date(time).toISOString(), transaction_hash: transactionHash, before_sampled_buy: Boolean(precedes && buyTime !== null && time <= buyTime && buyTime - time <= 3600000),
      ...(anchors ? { before_signed_creation: Boolean(creation && tx.slot < creation.slot && createdAt !== null && time <= createdAt && createdAt - time <= 3600000) } : {}),
    });
  }
  return found;
}
