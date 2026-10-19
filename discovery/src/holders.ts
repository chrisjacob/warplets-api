import { HolderSchema, type HolderAnalysis } from "./holder-model";
import { base64, hashJson, Reader } from "./solana";
import { ATA, canonicalPool, TOKEN, TOKEN_2022 } from "./pump";
import { findPda, publicKey } from "./solana";
import type { Accounts, Inventory } from "./rpc";
import { AccountsSchema, InventorySchema } from "./rpc";
import { Address } from "./model";
import { z } from "zod";

export type HolderEvidence = { mint: string; pool: string; program: string; creator: string | null; inventory: Inventory; mint_state: Accounts };
export const HolderEvidenceSchema = z.object({ mint: Address, pool: Address, program: Address, creator: Address.nullable(), inventory: InventorySchema, mint_state: AccountsSchema }).strict();
const pct = (amount: bigint, supply: bigint) => Number((amount * 100_000_000n + supply - 1n) / supply) / 1_000_000;

export async function analyzeHolders(input: HolderEvidence, at: string): Promise<HolderAnalysis> {
  const { mint, pool, program, creator, inventory, mint_state: state } = input;
  if (![TOKEN, TOKEN_2022].includes(program)) throw new Error("unsupported_holder_program");
  const canonical = await canonicalPool(mint);
  if (canonical.pool !== pool) throw new Error("noncanonical_holder_pool");
  const baseVault = await findPda(ATA, [publicKey(pool), publicKey(program), publicKey(mint)]);
  const mintAccount = state.value[0];
  if (state.value.length !== 1 || !mintAccount || mintAccount.owner !== program || mintAccount.executable || inventory.context.slot > state.context.slot || state.context.slot - inventory.context.slot > 150) throw new Error("holder_context_mismatch");
  const mintData = base64(mintAccount.data[0]); const mr = new Reader(mintData);
  const authority = mr.u32(); mr.take(32); const supply = mr.u64(); mr.u8();
  if (!mr.bool() || supply <= 0n) throw new Error("invalid_holder_supply");
  const totals = new Map<string, bigint>(); const seen = new Set<string>();
  let inventoried = 0n, poolBalance = 0n;
  const legacyPrefix = inventory.value.some(row => base64(row.account.data[0]).length === 109);
  const sized = inventory.value.every(row => row.account.space !== undefined);
  for (const { pubkey, account } of inventory.value) {
    if (seen.has(pubkey) || account.owner !== program || account.executable) throw new Error("invalid_holder_account"); seen.add(pubkey);
    const bytes = base64(account.data[0]);
    if (legacyPrefix ? bytes.length !== 109 : program === TOKEN ? bytes.length !== 165 : bytes.length !== 165 && (bytes.length !== 166 || bytes[165] !== 2)) throw new Error("invalid_holder_slice");
    // Preserve RPC account size: a sliced multisig must not impersonate an
    // account by arranging signer bytes to look like mint/owner/amount fields.
    if (account.space !== undefined && (program === TOKEN ? account.space !== 165 : account.space < 165 || account.space === 355 || account.space < bytes.length || (account.space > 165 && bytes[165] !== 2))) throw new Error("invalid_holder_account_size");
    const r = new Reader(bytes); if (r.key() !== mint) throw new Error("holder_mint_mismatch");
    const owner = r.key(), amount = r.u64(); r.take(36); const status = r.u8();
    if (![1, 2].includes(status)) throw new Error("uninitialized_holder_account");
    inventoried += amount;
    // Only this exact, canonically derived vault is exempt. Unknown custody,
    // off-curve owners, other pools and exchange labels receive no exemption.
    if (pubkey === baseVault) {
      if (owner !== pool) throw new Error("holder_vault_owner_mismatch");
      poolBalance += amount;
    } else if (amount > 0n) totals.set(owner, (totals.get(owner) ?? 0n) + amount);
  }
  if (inventoried > supply) throw new Error("holder_supply_exceeded");
  const complete = inventoried === supply && authority === 0 && inventory.value.length < 5000;
  const owners = [...totals].sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0].localeCompare(b[0]));
  const gaps = ["beneficial_owner_links_unknown", "bundle_risk_unknown", "lp_lock_status_unknown"];
  if (inventoried !== supply) gaps.push("holder_supply_not_reconciled");
  if (authority !== 0) gaps.push("holder_supply_can_change");
  if (inventory.value.length === 5000) gaps.push("holder_account_limit");
  if (!creator) gaps.push("creation_user_unknown");
  return HolderSchema.parse({
    version: legacyPrefix ? "owners-v1" : "owners-v2", status: complete ? "verified" : "partial", observed_at: at,
    layout_certified: !legacyPrefix && sized,
    context_slot: inventory.context.slot, payload_hash: await hashJson(input), supply_raw: supply.toString(), inventoried_raw: inventoried.toString(),
    account_count: inventory.value.length, holder_count: totals.size,
    top1_pct: pct(owners[0]?.[1] ?? 0n, supply), top10_pct: pct(owners.slice(0, 10).reduce((sum, [, amount]) => sum + amount, 0n), supply),
    pool_pct: pct(poolBalance, supply), creator_pct: creator ? pct(totals.get(creator) ?? 0n, supply) : null, creator,
    owners: owners.slice(0, 19).map(([owner, amount]) => ({ owner, amount_raw: amount.toString(), supply_pct: pct(amount, supply), role: "holder" }))
      .concat(poolBalance ? [{ owner: pool, amount_raw: poolBalance.toString(), supply_pct: pct(poolBalance, supply), role: "canonical_pool_vault" }] : []),
    gaps,
  });
}
