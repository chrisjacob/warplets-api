// Synthetic RPC-shaped inputs only. Never advertise these as chain transactions.
import schema from "../protocol/pump-schema.json";
import { creationProof, graduationProof, migrations, canonicalPool, curveAddress, PUMP, AMM, WSOL, TOKEN, ATA, verifyState } from "./pump";
import { findPda, publicKey, seed, toBase58 } from "./solana";
import type { Account, Accounts, Transaction } from "./rpc";
import type { Candidate } from "./model";

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function integer(value: bigint, length: number): Uint8Array {
  const b = new Uint8Array(length); for (let i = 0; i < length; i++) { b[i] = Number(value & 255n); value >>= 8n; } return b;
}
const concat = (...parts: (Uint8Array | readonly number[])[]) => Uint8Array.from(parts.flatMap(p => Array.from(p)));
function string(value: string): Uint8Array { const b = seed(value); return concat(integer(BigInt(b.length), 4), b); }
const fakeKey = (value: number) => toBase58(new Uint8Array(32).fill(value));
function account(owner: string, bytes: Uint8Array): Account { return { owner, executable: false, data: [encode(bytes), "base64"] }; }

export async function syntheticBundle(now = new Date("2026-10-20T00:00:00Z"), key = 41) {
  const mint = fakeKey(key), { pool, authority } = await canonicalPool(mint), curve = await curveAddress(mint);
  const baseVault = await findPda(ATA, [publicKey(pool), publicKey(TOKEN), publicKey(mint)]);
  const quoteVault = await findPda(ATA, [publicKey(pool), publicKey(TOKEN), publicKey(WSOL)]);
  const create = schema.instructions.find(i => i.name === "create")!;
  const migrate = schema.instructions.find(i => i.name === "migrate")!;
  const common: Record<string, string> = {
    mint, bonding_curve: curve, mint_authority: await findPda(PUMP, [seed("mint-authority")]),
    pool, pool_authority: authority, wsol_mint: WSOL, pump_amm: AMM, token_program: TOKEN,
    pool_base_token_account: baseVault, pool_quote_token_account: quoteVault,
  };
  function tx(signatureByte: number, blockTime: number, definition: { accounts: string[]; discriminator: number[] }, values: Record<string, string>, data: Uint8Array): Transaction {
    const addresses = definition.accounts.map(name => values[name] ?? fakeKey(7));
    return {
      slot: signatureByte * 1000, blockTime, version: 0,
      transaction: { signatures: [toBase58(new Uint8Array(64).fill(signatureByte))], message: {
        accountKeys: [PUMP, ...addresses], instructions: [{ programIdIndex: 0, accounts: addresses.map((_, i) => i + 1), data: toBase58(concat(definition.discriminator, data)) }],
      } },
      meta: { err: null, innerInstructions: [], loadedAddresses: { writable: [], readonly: [] } },
    };
  }
  const creation = tx(10, Math.floor(now.getTime() / 1000) - 3600, create, common, concat(string("Simulation Meme"), string("SIM"), string("https://example.invalid/synthetic"), publicKey(fakeKey(7))));
  const graduation = tx(20, Math.floor(now.getTime() / 1000) - 1800, migrate, common, new Uint8Array());
  const ammValues = { pool, creator: authority, base_mint: mint, quote_mint: WSOL };
  const childKeys = schema.create_pool.accounts.map(name => ammValues[name as keyof typeof ammValues] ?? fakeKey(7));
  const keys = graduation.transaction.message.accountKeys;
  const ammIndex = keys.length; keys.push(AMM);
  const start = keys.length; keys.push(...childKeys);
  graduation.meta!.innerInstructions = [{ index: 0, instructions: [{
    programIdIndex: ammIndex, accounts: childKeys.map((_, i) => start + i), stackHeight: 2,
    data: toBase58(concat(schema.create_pool.discriminator, integer(0n, 2), integer(10n, 8), integer(20n, 8))),
  }] }];
  const mintData = concat(integer(0n, 4), new Uint8Array(32), integer(1_000_000_000n, 8), [6, 1], integer(0n, 4), new Uint8Array(32));
  const poolData = concat(schema.pool_discriminator, [255], integer(0n, 2), publicKey(authority), publicKey(mint), publicKey(WSOL), publicKey(fakeKey(3)), publicKey(baseVault), publicKey(quoteVault), integer(0n, 8));
  const vault = (asset: string) => concat(publicKey(asset), publicKey(pool), integer(100n, 8), new Uint8Array(36), [1], new Uint8Array(56));
  const accounts: Accounts = { context: { slot: 30_000 }, value: [
    account(TOKEN, mintData), account(AMM, poolData), account(TOKEN, vault(mint)), account(TOKEN, vault(WSOL)),
    account(PUMP, concat(schema.curve_discriminator, new Uint8Array(40), [1], publicKey(fakeKey(7)))),
  ] };
  return { mint, pool, creation, graduation, accounts };
}
export async function fixtureCandidates(now = new Date()): Promise<Candidate[]> {
  const bundle = await syntheticBundle(now);
  const migration = (await migrations(bundle.graduation))[0]!;
  const creation = (await creationProof(bundle.creation, bundle.mint, now.toISOString()))!;
  const candidate: Candidate = {
    chain: "solana", address: bundle.mint, pool: bundle.pool, name: creation.name, symbol: creation.symbol,
    creation: creation.proof, graduation: await graduationProof(bundle.graduation, migration, now.toISOString()),
    verification: "verified", verification_reasons: [],
    risk: await verifyState(migration, bundle.accounts, now.toISOString(), bundle.graduation.slot),
    holders: null, wallet_analysis: null,
    market: { source: "geckoterminal", fetched_at: now.toISOString(), observed_at: null, price_usd: 0.001, market_cap_usd: 200_000, fdv_usd: 250_000, liquidity_usd: 50_000, volume_24h_usd: 10_000, image_url: null },
    first_seen_at: now.toISOString(), checked_at: now.toISOString(), mode: "fixture",
  };
  return [candidate,
    { ...candidate, address: fakeKey(42), name: "Old Token / New Pool", symbol: "OLD", creation: { ...creation.proof, block_time: new Date(now.getTime() - 48 * 3600_000).toISOString() } },
    { ...candidate, address: fakeKey(43), name: "No Migration Evidence", symbol: "WAIT", graduation: null, verification: "provisional", verification_reasons: ["graduation_unverified"] },
    { ...candidate, address: fakeKey(44), name: "FDV Is Not Market Cap", symbol: "FDV", market: { ...candidate.market!, market_cap_usd: null } },
  ];
}
