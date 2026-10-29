import type { LedgerEvent, Campaign } from "../shared/holding";
import { one, requireThat, type Database } from "./db";
interface TokenBalance {
  owner?: string;
  mint: string;
  uiTokenAmount: { amount: string };
}
export interface Receipt {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    preBalances: number[];
    postBalances: number[];
  } | null;
  transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } };
}
function delta(receipt: Receipt, wallet: string, mint: string) {
  const meta = receipt.meta!;
  if (mint === "native:SOL") {
    const index = receipt.transaction.message.accountKeys.findIndex(
      (k) => (typeof k === "string" ? k : k.pubkey) === wallet,
    );
    if (index < 0) throw Error("Payment account missing");
    const before = meta.preBalances[index],
      after = meta.postBalances[index];
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after))
      throw Error("Native balance exceeds exact receipt support");
    return BigInt(after) - BigInt(before) + BigInt(index === 0 ? meta.fee : 0);
  }
  const sum = (items: TokenBalance[] | undefined) =>
    (items ?? [])
      .filter((b) => b.owner === wallet && b.mint === mint)
      .reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
}
export function verifyReceipt(
  event: LedgerEvent,
  campaign: Campaign,
  receipt: Receipt,
) {
  requireThat(
    receipt.meta &&
      receipt.meta.err == null &&
      receipt.slot === event.slot &&
      receipt.blockTime != null &&
      receipt.blockTime * 1000 === event.at,
    409,
    "Receipt is failed or does not match slot/time",
  );
  const q = BigInt(event.quantity);
  if (event.kind === "transfer") {
    requireThat(
      event.from &&
        event.to &&
        delta(receipt, event.from, campaign.mint) === -q &&
        delta(receipt, event.to, campaign.mint) === q,
      409,
      "Transfer receipt does not reconcile",
    );
  } else {
    requireThat(event.wallet, 400, "Wallet required");
    requireThat(
      delta(receipt, event.wallet, campaign.mint) ===
        (event.kind === "sell" ? -q : q),
      409,
      "Token receipt does not reconcile",
    );
    if (event.kind === "purchase") {
      requireThat(
        event.quote &&
          delta(receipt, event.wallet, event.quote.paymentMint) ===
            -BigInt(event.quote.paidUnits),
        409,
        "Acquisition payment does not reconcile",
      );
    }
  }
}
export async function fetchFinalizedReceipt(
  db: Database,
  signature: string,
): Promise<Receipt> {
  const minute = Math.floor(Date.now() / 60000);
  const reserved = await one<{ attempts: number }>(
    db,
    "INSERT INTO meme_auth_limits VALUES('solana-receipt',?,1) ON CONFLICT(bucket,window) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    minute,
  );
  requireThat(
    reserved && reserved.attempts <= 60,
    429,
    "Local public Solana RPC allowance reached",
  );
  const response = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          encoding: "jsonParsed",
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  requireThat(
    response.ok && response.body,
    502,
    "Finalized Solana receipt unavailable",
  );
  const reader = response.body.getReader();
  let size = 0,
    data = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) {
        await reader.cancel();
        throw Error("Receipt exceeds supported size");
      }
      data += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const result = JSON.parse(data) as { result?: Receipt; error?: unknown };
  requireThat(
    !result.error && result.result,
    409,
    "Transaction is not finalized or available",
  );
  return result.result;
}
