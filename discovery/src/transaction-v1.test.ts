import { describe, expect, it, vi } from "vitest";
import { RpcClient, TransactionSchema } from "./rpc";
import { WalletTransactionSchema, walletTransaction } from "./wallet-rpc";
import { key, signature, trade, walletInput } from "./wallet-fixtures.test-helper";
import { hashJson, toBase58 } from "./solana";
import { fundingTransfers, verifiedTrades } from "./wallet-trades";
import recorded from "../fixtures/recorded/temporary-wsol-trade.json";
import recordedMigration from "../fixtures/recorded/v1-pump-migration.json";
import {graduationProof,migrations,WSOL} from "./pump";

// Synthetic RPC layout based on pinned Agave v4.2.2 UiRawMessage /
// UiTransactionConfig. This is never presented as recorded chain evidence.
async function v1() {
  const tx = await trade();
  return { ...tx, version: 1 as const, transaction: { ...tx.transaction, message: { ...tx.transaction.message,
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    transactionConfig: { priorityFee: 12000, computeUnitLimit: 200000, loadedAccountsDataSizeLimit: 67108864, heapSize: null },
  } } };
}
function reader(raw: unknown) {
  const reserve = vi.fn(async () => {}), transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: raw });
  });
  return { rpc: new RpcClient("https://rpc.example", reserve, transport), reserve, transport };
}
describe("version-aware finalized transaction reads", () => {
  it("replays the real finalized v1 migration recovered by the metered local collector",async()=>{
    const tx=TransactionSchema.parse(recordedMigration.transaction);
    expect(recordedMigration.source).toBe("solana-finalized-rpc");expect(tx.version).toBe(1);
    expect(tx.transaction.signatures[0]).toBe(recordedMigration.signature);
    expect(await hashJson(tx)).toBe(recordedMigration.transaction_hash);
    expect(tx.transaction.message.transactionConfig).toEqual(recordedMigration.transaction.transaction.message.transactionConfig);
    const found=(await migrations(tx)).find(m=>m.address===recordedMigration.mint&&m.pool===recordedMigration.pool);
    expect(found).toBeDefined();expect(found!.quote).toBe(WSOL);
    const proof=await graduationProof(tx,found!,recordedMigration.recorded_at);
    expect(proof).toMatchObject({kind:"graduation",signature:recordedMigration.signature,slot:tx.slot,payload_hash:recordedMigration.transaction_hash});
    // This retained normalized migration does not contain wallet balances or
    // independently prove creation, holders, funding coverage or eligibility.
    expect(WalletTransactionSchema.safeParse(tx).success).toBe(false);
  });
  it("opts in to v1 in both readers and retains the exact resource config", async () => {
    const raw = await v1();
    for (const wallet of [false, true]) {
      const { rpc, reserve, transport } = reader(raw);
      const tx = wallet ? await walletTransaction(rpc, signature(31)) : await rpc.transaction(signature(31));
      expect(tx?.version).toBe(1);
      expect(tx?.transaction.message.transactionConfig).toEqual(raw.transaction.message.transactionConfig);
      expect(JSON.parse(String(transport.mock.calls[0]![1]!.body)).params[1]).toEqual({ commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1 });
      expect(reserve).toHaveBeenCalledExactlyOnceWith("rpc");
    }
    const input = await walletInput(), tx = await walletTransaction(reader(raw).rpc, signature(31));
    const result = await verifiedTrades(tx!, input.asset.address, input.asset.pool!);
    expect(result.trades).toHaveLength(1);
    expect(tx!.meta!.fee).toBe(5000); // Not replaced with config.priorityFee.
    expect(await hashJson(tx)).not.toBe(await hashJson(WalletTransactionSchema.parse(await trade())));
  });
  it("preserves the pinned historical wallet hash and does not invent a v1 config", async () => {
    const tx = WalletTransactionSchema.parse(recorded.transaction);
    expect(await hashJson(tx)).toBe(recorded.transaction_hash);
    expect(tx.transaction.message).not.toHaveProperty("transactionConfig");
    expect(TransactionSchema.parse(tx).version).toBe("legacy");
  });
  it("verifies a directly signed v1 funding transfer without treating a CPI or unsigned outflow as funding", async () => {
    const raw=await v1(), from=key(22), to=key(8), system="11111111111111111111111111111111";
    const bytes=new Uint8Array(12);new DataView(bytes.buffer).setUint32(0,2,true);new DataView(bytes.buffer).setBigUint64(4,1000000n,true);
    raw.transaction.message.accountKeys=[from,to,system];
    raw.transaction.message.instructions=[{programIdIndex:2,accounts:[0,1],data:toBase58(bytes)}];
    raw.meta={...raw.meta!,preBalances:[2000000,0,1],postBalances:[995000,1000000,1],preTokenBalances:[],postTokenBalances:[],innerInstructions:[]};
    const tx=(await walletTransaction(reader(raw).rpc,signature(31)))!;
    const anchors=[{wallet:to,signature:signature(32),slot:tx.slot+1,block_time:new Date((tx.blockTime!+10)*1000).toISOString(),kind:"signed_creation" as const}];
    expect(await fundingTransfers(tx,new Set([to]),[],anchors)).toEqual([expect.objectContaining({from,to,lamports_raw:"1000000",before_signed_creation:true,transaction_hash:await hashJson(tx)})]);
    const unsigned=structuredClone(tx);unsigned.transaction.message.instructions[0]!.accounts=[1,0];
    expect(await fundingTransfers(unsigned,new Set([from]),[],anchors)).toEqual([]);
    const inner=structuredClone(tx);inner.transaction.message.instructions=[{programIdIndex:2,accounts:[],data:"1"}];inner.meta!.innerInstructions=[{index:0,instructions:tx.transaction.message.instructions}];
    expect(await fundingTransfers(inner,new Set([to]),[],anchors)).toEqual([]);
  });
  it("accepts explicit null defaults but rejects missing, unknown and imprecise config fields", async () => {
    const raw = await v1();
    raw.transaction.message.transactionConfig.priorityFee = null as unknown as number;
    expect((await reader(raw).rpc.transaction(signature(31)))!.transaction.message.transactionConfig!.priorityFee).toBeNull();
    const invalid = [undefined, { ...raw.transaction.message.transactionConfig, futureLimit: 1 }, { ...raw.transaction.message.transactionConfig, priorityFee: Number.MAX_SAFE_INTEGER + 1 }, { ...raw.transaction.message.transactionConfig, heapSize: -1 }, { priorityFee: null }];
    for (const config of invalid) {
      const changed = structuredClone(raw) as any; changed.transaction.message.transactionConfig = config;
      await expect(reader(changed).rpc.transaction(signature(31))).rejects.toThrow("transaction_layout_unsupported");
      await expect(walletTransaction(reader(changed).rpc, signature(31))).rejects.toThrow("wallet_transaction_layout_unsupported");
    }
  });
  it("rejects v1 lookup addresses, lookup references and inconsistent signer headers before normalization", async () => {
    const base = await v1();
    const variants = [
      (tx: any) => { tx.meta.loadedAddresses.writable = [key(22)]; },
      (tx: any) => { tx.transaction.message.addressTableLookups = [{ accountKey: key(22), writableIndexes: [], readonlyIndexes: [] }]; },
      (tx: any) => { tx.transaction.message.header.numRequiredSignatures = 2; },
      (tx: any) => { tx.transaction.message.header.numReadonlySignedAccounts = 1; },
      (tx: any) => { tx.transaction.message.header.numReadonlyUnsignedAccounts = 255; },
      (tx: any) => { delete tx.transaction.message.header.numReadonlyUnsignedAccounts; },
      (tx: any) => { tx.version = 0; },
    ];
    for (const mutate of variants) {
      const raw = structuredClone(base); mutate(raw);
      await expect(reader(raw).rpc.transaction(signature(31))).rejects.toThrow("transaction_layout_unsupported");
      await expect(walletTransaction(reader(raw).rpc, signature(31))).rejects.toThrow("wallet_transaction_layout_unsupported");
    }
  });
  it("keeps null bodies, signature mismatches and future versions distinct", async () => {
    expect(await reader(null).rpc.transaction(signature(31))).toBeNull();
    expect(await walletTransaction(reader(null).rpc, signature(31))).toBeNull();
    const raw = await v1();
    await expect(reader(raw).rpc.transaction(signature(32))).rejects.toThrow("transaction_signature_mismatch");
    await expect(walletTransaction(reader(raw).rpc, signature(32))).rejects.toThrow("transaction_signature_mismatch");
    const future = { ...raw, version: 2 };
    await expect(reader(future).rpc.transaction(signature(31))).rejects.toThrow("unsupported_transaction_version");
    await expect(walletTransaction(reader(future).rpc, signature(31))).rejects.toThrow("unsupported_transaction_version");
  });
});
