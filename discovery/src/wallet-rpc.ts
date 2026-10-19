import { z } from "zod";
import { Address, Signature } from "./model";
import { RpcClient, SourceError, TransactionSchema } from "./rpc";

const TokenBalance = z.object({
  accountIndex: z.number().int().min(0).max(255), mint: Address, owner: Address.optional(), programId: Address.optional(),
  uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/).max(20), decimals: z.number().int().min(0).max(255) }),
});
// Keep this parser separate: enriching historical proof normalization would
// change existing creation/graduation hashes.
export const WalletTransactionSchema = TransactionSchema.extend({
  transaction: TransactionSchema.shape.transaction.extend({ message: TransactionSchema.shape.transaction.shape.message.extend({
    header: z.object({ numRequiredSignatures: z.number().int().min(1).max(64) }),
  }) }),
  meta: z.object({
    err: z.unknown(), innerInstructions: TransactionSchema.shape.meta.unwrap().shape.innerInstructions,
    loadedAddresses: TransactionSchema.shape.meta.unwrap().shape.loadedAddresses,
    preTokenBalances: z.array(TokenBalance).max(256), postTokenBalances: z.array(TokenBalance).max(256),
    preBalances: z.array(z.number().int().safe().nonnegative()).max(256), postBalances: z.array(z.number().int().safe().nonnegative()).max(256),
    fee: z.number().int().safe().nonnegative(),
  }).nullable(),
});
export type WalletTransaction = z.infer<typeof WalletTransactionSchema>;
export async function walletTransaction(rpc: RpcClient, signature: string): Promise<WalletTransaction | null> {
  Signature.parse(signature);
  const raw = await rpc.call("getTransaction", [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
  if (raw === null) return null;
  const parsed = WalletTransactionSchema.safeParse(raw);
  if (!parsed.success) throw new SourceError("wallet_transaction_layout_unsupported");
  if (parsed.data.transaction.signatures[0] !== signature) throw new SourceError("transaction_signature_mismatch");
  return parsed.data;
}
export function keys(tx: WalletTransaction): string[] {
  return [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
}
export function signer(tx: WalletTransaction, wallet: string): boolean {
  const n = tx.transaction.message.header.numRequiredSignatures;
  return n === tx.transaction.signatures.length && n <= tx.transaction.message.accountKeys.length && tx.transaction.message.accountKeys.slice(0, n).includes(wallet);
}
