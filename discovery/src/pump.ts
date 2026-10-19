import schema from "../protocol/pump-schema.json";
import { base64, bytesEqual, findPda, fromBase58, hashJson, publicKey, Reader, seed } from "./solana";
import type { Candidate, Proof } from "./model";
import type { Account, Accounts, Transaction } from "./rpc";

export const PUMP = schema.pump_program;
export const AMM = schema.amm_program;
export const WSOL = "So11111111111111111111111111111111111111112";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const ADAPTER_VERSION = `pump-${schema.revision.slice(0, 12)}-v1`;
type ResolvedInstruction = {
  program: string; accounts: string[]; data: Uint8Array; path: string;
  top: number; inner: number | null; stack: number | null;
};
export function instructions(tx: Transaction): ResolvedInstruction[] {
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const rows: ResolvedInstruction[] = [];
  const resolve = (ix: Transaction["transaction"]["message"]["instructions"][number], top: number, inner: number | null) => {
    const program = keys[ix.programIdIndex];
    if (!program || ix.accounts.some(index => !keys[index])) throw new Error("invalid_account_index");
    rows.push({ program, accounts: ix.accounts.map(index => keys[index]!), data: ix.data === "" ? new Uint8Array() : fromBase58(ix.data), path: inner === null ? `${top}` : `${top}.${inner}`, top, inner, stack: ix.stackHeight ?? null });
  };
  tx.transaction.message.instructions.forEach((ix, index) => resolve(ix, index, null));
  tx.meta?.innerInstructions?.forEach(group => {
    if (group.index >= tx.transaction.message.instructions.length) throw new Error("invalid_inner_group");
    group.instructions.forEach((ix, index) => resolve(ix, group.index, index));
  });
  return rows;
}
function successful(tx: Transaction): void {
  if (!tx.meta || tx.meta.err !== null || tx.blockTime === null) throw new Error("unsuccessful_or_undated_transaction");
}
function descriptor(ix: ResolvedInstruction, names: string[]) {
  if (ix.program !== PUMP) return undefined;
  return schema.instructions.find(d => names.includes(d.name) && bytesEqual(ix.data, d.discriminator));
}
function mapped(ix: ResolvedInstruction, names: string[]): Record<string, string> {
  if (ix.accounts.length < names.length) throw new Error("missing_instruction_accounts");
  return Object.fromEntries(names.map((name, i) => [name, ix.accounts[i]!]));
}
export async function curveAddress(mint: string): Promise<string> { return findPda(PUMP, [seed("bonding-curve"), publicKey(mint)]); }
export async function canonicalPool(mint: string, quote = WSOL): Promise<{ pool: string; authority: string }> {
  const authority = await findPda(PUMP, [seed("pool-authority"), publicKey(mint)]);
  const pool = await findPda(AMM, [seed("pool"), new Uint8Array([0, 0]), publicKey(authority), publicKey(mint), publicKey(quote)]);
  return { pool, authority };
}
export async function migrationAuthority(account: Account): Promise<string> {
  if (account.owner !== PUMP || account.executable) throw new Error("wrong_global_owner");
  const data = base64(account.data[0]);
  if (!bytesEqual(data, schema.global_discriminator)) throw new Error("wrong_global_discriminator");
  // Pinned Global prefix: discriminator + bool + 2 pubkeys + 5 u64.
  return new Reader(data, 8 + 1 + 64 + 40).key();
}
export type Migration = { address: string; pool: string; quote: string; curve: string; baseVault: string; quoteVault: string; baseProgram: string; ix: ResolvedInstruction };
export async function migrations(tx: Transaction): Promise<Migration[]> {
  successful(tx); const found: Migration[] = [];
  const all = instructions(tx);
  for (const ix of all) {
    const d = descriptor(ix, ["migrate", "migrate_v2"]); if (!d) continue;
    const a = mapped(ix, d.accounts);
    const mint = a.mint ?? a.base_mint!;
    const quote = a.wsol_mint ?? a.quote_mint!;
    const expected = await canonicalPool(mint, quote);
    if (a.pool !== expected.pool || a.pool_authority !== expected.authority || a.bonding_curve !== await curveAddress(mint) || a.pump_amm !== AMM) throw new Error("noncanonical_migration");
    // A successful Pump migrate instruction is mandatory. A sibling create_pool
    // or a spoofed log from another program cannot prove graduation.
    const children = all.filter(child => {
      if (child.top !== ix.top || child.inner === null || child.program !== AMM || !bytesEqual(child.data, schema.create_pool.discriminator)) return false;
      if (ix.inner === null) return true;
      if (ix.stack === null || child.stack === null || child.inner <= ix.inner || child.stack <= ix.stack) return false;
      return !all.some(between => between.top === ix.top && between.inner !== null && between.inner > ix.inner! && between.inner < child.inner! && between.stack !== null && between.stack <= ix.stack!);
    });
    const matched = children.some(child => {
      const c = mapped(child, schema.create_pool.accounts);
      return c.pool === a.pool && c.creator === a.pool_authority && c.base_mint === mint && c.quote_mint === quote && new Reader(child.data, 8).u16() === 0;
    });
    if (!matched) throw new Error("migration_pool_creation_unproven");
    found.push({ address: mint, pool: a.pool!, quote, curve: a.bonding_curve!, baseVault: a.pool_base_token_account!, quoteVault: a.pool_quote_token_account!, baseProgram: a.token_program ?? a.base_token_program!, ix });
  }
  return found;
}
async function proof(tx: Transaction, ix: ResolvedInstruction, kind: Proof["kind"], name: string, fetchedAt: string): Promise<Proof> {
  return {
    kind, signature: tx.transaction.signatures[0]!, slot: tx.slot, block_time: new Date(tx.blockTime! * 1000).toISOString(),
    instruction: name, instruction_index: ix.path, program: PUMP,
    payload_hash: await hashJson(tx), fetched_at: fetchedAt, source: "solana-finalized-rpc", adapter_version: ADAPTER_VERSION,
  };
}
export async function creationProof(tx: Transaction, mint: string, fetchedAt: string): Promise<{ proof: Proof; name: string; symbol: string } | null> {
  successful(tx);
  for (const ix of instructions(tx)) {
    const d = descriptor(ix, ["create", "create_v2"]); if (!d) continue;
    const a = mapped(ix, d.accounts); if (a.mint !== mint) continue;
    if (a.bonding_curve !== await curveAddress(mint) || a.mint_authority !== await findPda(PUMP, [seed("mint-authority")])) throw new Error("noncanonical_creation");
    if (![TOKEN, TOKEN_2022].includes(a.token_program!)) throw new Error("unsupported_token_program");
    // Successful canonical Pump create has onchain program-enforced mint init;
    // arbitrary log payloads and metadata timestamps are never used as proof.
    const reader = new Reader(ix.data, 8);
    const name = reader.string(100), symbol = reader.string(32); reader.string(1024);
    return { proof: await proof(tx, ix, "creation", d.name, fetchedAt), name, symbol };
  }
  return null;
}
export async function creationUser(tx: Transaction, mint: string): Promise<string | null> {
  if (!await creationProof(tx, mint, new Date(tx.blockTime! * 1000).toISOString())) return null;
  const ix = instructions(tx).find(ix => {
    const d = descriptor(ix, ["create", "create_v2"]);
    return d && mapped(ix, d.accounts).mint === mint;
  });
  return ix ? mapped(ix, descriptor(ix, ["create", "create_v2"])!.accounts).user ?? null : null;
}
export async function graduationProof(tx: Transaction, migration: Migration, fetchedAt: string): Promise<Proof> {
  const d = descriptor(migration.ix, ["migrate", "migrate_v2"]);
  if (!d) throw new Error("unsupported_migration");
  return proof(tx, migration.ix, "graduation", d.name, fetchedAt);
}
function owned(account: Account | null | undefined, owner: string): Uint8Array {
  if (!account || account.owner !== owner || account.executable) throw new Error("wrong_or_missing_account_owner");
  return base64(account.data[0]);
}
export async function verifyState(migration: Migration, accounts: Accounts, now: string, minSlot: number): Promise<Candidate["risk"]> {
  if (accounts.context.slot < minSlot || accounts.value.length !== 5) throw new Error("stale_account_context");
  const [mint, pool, baseVault, quoteVault, curve] = accounts.value;
  const data = owned(pool, AMM);
  if (!bytesEqual(data, schema.pool_discriminator)) throw new Error("wrong_pool_discriminator");
  const r = new Reader(data, 8); r.u8();
  if (r.u16() !== 0) throw new Error("noncanonical_pool_index");
  const creator = r.key(), base = r.key(), quote = r.key(); r.key();
  const vaultA = r.key(), vaultB = r.key();
  const expected = await canonicalPool(migration.address, migration.quote);
  if (creator !== expected.authority || migration.pool !== expected.pool || base !== migration.address || quote !== migration.quote || vaultA !== migration.baseVault || vaultB !== migration.quoteVault) throw new Error("pool_identity_mismatch");
  const mintData = owned(mint, migration.baseProgram);
  if (![TOKEN, TOKEN_2022].includes(migration.baseProgram) || mintData.length < 82) throw new Error("unsupported_mint");
  const mr = new Reader(mintData);
  const mintOption = mr.u32(); mr.take(32); mr.u64(); mr.u8();
  if (!mr.bool()) throw new Error("uninitialized_mint");
  const freezeOption = mr.u32();
  if (mintOption > 1 || freezeOption > 1) throw new Error("invalid_mint_authority_option");
  const extensions: number[] = [];
  if (migration.baseProgram === TOKEN_2022 && mintData.length > 82) {
    if (mintData.length < 166 || mintData[165] !== 1) throw new Error("invalid_token2022_layout");
    const ext = new Reader(mintData, 166);
    while (ext.offset + 4 <= mintData.length) {
      const kind = ext.u16(), length = ext.u16(); if (kind === 0 && length === 0) break;
      ext.take(length); extensions.push(kind);
      // Only MetadataPointer / TokenMetadata are certified for this slice.
      if (![18, 19].includes(kind)) throw new Error("unsupported_token_extension");
    }
  }
  for (const [account, expectedMint, tokenProgram, vault] of [
    [baseVault, migration.address, migration.baseProgram, migration.baseVault],
    [quoteVault, migration.quote, TOKEN, migration.quoteVault],
  ] as const) {
    const v = new Reader(owned(account, tokenProgram));
    if (v.key() !== expectedMint || v.key() !== migration.pool || v.u64() <= 0n) throw new Error("invalid_or_empty_pool_vault");
    v.take(36); if (v.u8() !== 1) throw new Error("uninitialized_or_frozen_vault");
    if (vault !== await findPda(ATA, [publicKey(migration.pool), publicKey(tokenProgram), publicKey(expectedMint)])) throw new Error("noncanonical_vault");
  }
  const curveData = owned(curve, PUMP);
  if (!bytesEqual(curveData, schema.curve_discriminator) || !new Reader(curveData, 8 + 40).bool()) throw new Error("curve_not_complete");
  return {
    mint_authority: mintOption === 0 ? "revoked" : "active", freeze_authority: freezeOption === 0 ? "revoked" : "active",
    token_program: migration.baseProgram, mint_extensions: extensions, holder_concentration: "unknown",
    pool_reserves_verified: true, observed_at: now,
    context_slot: accounts.context.slot, payload_hash: await hashJson(accounts),
  };
}
