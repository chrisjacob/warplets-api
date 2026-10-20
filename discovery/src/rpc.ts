import { z } from "zod";
import { Address, Signature } from "./model";

export class SourceError extends Error {
  constructor(readonly code: string, readonly retryAfterSeconds = 60) { super(code); }
}
export async function persistRpcBackoff(db: D1Database, error: unknown, now: Date): Promise<void> {
  if (!(error instanceof SourceError) || error.code !== "rpc_rate_limited") return;
  const until = new Date(now.getTime() + error.retryAfterSeconds * 1000).toISOString();
  await db.prepare("UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after=?1 WHERE id=1 AND (retry_after IS NULL OR retry_after<?1)").bind(until).run();
}
export async function boundedJson(response: Response, limit = 3_000_000): Promise<unknown> {
  if (!response.body) throw new SourceError("empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) throw new SourceError("response_too_large");
      chunks.push(chunk.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new SourceError("invalid_json"); }
}
const InstructionSchema = z.object({
  programIdIndex: z.number().int().min(0).max(255),
  accounts: z.array(z.number().int().min(0).max(255)).max(256),
  data: z.string().max(10_000), stackHeight: z.number().int().positive().nullable().optional(),
});
export const TransactionSchema = z.object({
  slot: z.number().int().safe().nonnegative(), blockTime: z.number().int().nonnegative().nullable(),
  version: z.union([z.literal("legacy"), z.literal(0)]).optional(),
  transaction: z.object({
    signatures: z.array(Signature).min(1).max(64),
    message: z.object({ accountKeys: z.array(Address).max(256), instructions: z.array(InstructionSchema).max(256) }),
  }),
  meta: z.object({
    err: z.unknown(),
    innerInstructions: z.array(z.object({ index: z.number().int().nonnegative(), instructions: z.array(InstructionSchema).max(1024) })).nullable(),
    loadedAddresses: z.object({ writable: z.array(Address), readonly: z.array(Address) }).optional(),
  }).nullable(),
});
export type Transaction = z.infer<typeof TransactionSchema>;
export const AccountSchema = z.object({
  owner: Address, executable: z.boolean(), data: z.tuple([z.string().max(2_000_000), z.literal("base64")]),
  space: z.number().int().nonnegative().max(10000000).optional(),
});
export type Account = z.infer<typeof AccountSchema>;
export const AccountsSchema = z.object({
  context: z.object({ slot: z.number().int().safe().nonnegative() }), value: z.array(AccountSchema.nullable()).max(100),
});
export type Accounts = z.infer<typeof AccountsSchema>;
export const InventorySchema = z.object({ context: z.object({ slot: z.number().int().safe().nonnegative() }), value: z.array(z.object({ pubkey: Address, account: AccountSchema })).max(5000) });
export type Inventory = z.infer<typeof InventorySchema>;
export const SignatureRows = z.array(z.object({
  signature: Signature, slot: z.number().int().safe().nonnegative(), err: z.unknown(),
  blockTime: z.number().int().nullable(), confirmationStatus: z.string().nullable(),
})).max(1000);
export type SignatureRow = z.infer<typeof SignatureRows>[number];
type Method = "getGenesisHash" | "getSlot" | "getSignaturesForAddress" | "getTransaction" | "getMultipleAccounts" | "getProgramAccounts";
export type Reserve = (provider: "rpc" | "market") => Promise<void>;
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export class RpcClient {
  calls = 0;
  constructor(readonly url: string, readonly reserve: Reserve, readonly transport: typeof fetch = (input, init) => globalThis.fetch(input, init), readonly maxCalls = 24) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new SourceError("invalid_rpc_configuration");
  }
  async call(method: Method, params: unknown[]): Promise<unknown> {
    if (++this.calls > this.maxCalls) throw new SourceError("cycle_rpc_budget_exhausted");
    await this.reserve("rpc");
    let response: Response;
    try {
      // Native workerd fetch must not receive this RpcClient as its receiver.
      const send = this.transport;
      response = await send(this.url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.calls, method, params }),
        signal: AbortSignal.timeout(12_000), redirect: "manual",
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: "tenx_rpc_transport_failed", error_type: error instanceof Error ? error.name : "unknown", detail: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 200) : "unknown" }));
      throw new SourceError("rpc_unavailable", 120);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const rawRetry = response.headers.get("retry-after"), seconds = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : rawRetry ? Math.ceil((Date.parse(rawRetry) - Date.now()) / 1000) : 300;
      throw new SourceError(response.status === 429 ? "rpc_rate_limited" : "rpc_http_error", response.status === 429 ? Math.max(300, Number.isFinite(seconds) ? Math.min(31536000, seconds) : 300) : 120);
    }
    const envelope = z.object({ jsonrpc: z.literal("2.0"), id: z.number(), result: z.unknown().optional(), error: z.unknown().optional() }).parse(await boundedJson(response));
    if (envelope.error) {
      const error = z.object({ code: z.number() }).safeParse(envelope.error);
      throw new SourceError(error.success && error.data.code === -32015 ? "unsupported_transaction_version" : "rpc_error", 120);
    }
    if (envelope.id !== this.calls || !("result" in envelope)) throw new SourceError("rpc_error", 120);
    return envelope.result;
  }
  async checkCluster(): Promise<void> {
    if (await this.call("getGenesisHash", []) !== MAINNET_GENESIS) throw new SourceError("wrong_solana_cluster", 3600);
  }
  async signatures(address: string, limit = 100, before?: string, until?: string): Promise<SignatureRow[]> {
    Address.parse(address);
    return SignatureRows.parse(await this.call("getSignaturesForAddress", [address, { commitment: "finalized", limit, ...(before ? { before } : {}), ...(until ? { until } : {}) }]));
  }
  async transaction(signature: string): Promise<Transaction | null> {
    Signature.parse(signature);
    const value = await this.call("getTransaction", [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
    if (value === null) return null;
    const tx = TransactionSchema.parse(value);
    if (tx.transaction.signatures[0] !== signature) throw new SourceError("transaction_signature_mismatch");
    return tx;
  }
  async accounts(addresses: string[], minContextSlot?: number): Promise<Accounts> {
    addresses.forEach(a => Address.parse(a));
    const result = AccountsSchema.parse(await this.call("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64", ...(minContextSlot === undefined ? {} : { minContextSlot }) }]));
    if (result.value.length !== addresses.length || (minContextSlot !== undefined && result.context.slot < minContextSlot)) throw new SourceError("account_context_mismatch");
    return result;
  }
  async inventory(program: string, mint: string, minContextSlot: number): Promise<Inventory> {
    Address.parse(program); Address.parse(mint);
    const result = InventorySchema.parse(await this.call("getProgramAccounts", [program, {
      commitment: "finalized", withContext: true, encoding: "base64", minContextSlot,
      dataSlice: { offset: 0, length: 166 }, filters: [{ memcmp: { offset: 0, bytes: mint } }],
    }]));
    if (result.context.slot < minContextSlot) throw new SourceError("holder_inventory_stale");
    return result;
  }
}
