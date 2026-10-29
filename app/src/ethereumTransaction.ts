export const BASE_CHAIN_ID_HEX = "0x2105";

export function normalizeTransactionChainId(value: unknown = BASE_CHAIN_ID_HEX): string {
  const chainId = value ?? BASE_CHAIN_ID_HEX;
  if (
    (typeof chainId === "number" && !Number.isSafeInteger(chainId))
    || (typeof chainId === "string" && !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(chainId))
    || !["string", "number", "bigint"].includes(typeof chainId)
  ) throw new Error("Invalid transaction chain ID");
  const numericChainId = BigInt(chainId as string | number | bigint);
  if (numericChainId <= 0n) throw new Error("Invalid transaction chain ID");
  return `0x${numericChainId.toString(16)}`;
}

export function sendEthereumTransaction(
  provider: { request(args: { method: string; params: unknown[] }): Promise<unknown> },
  transaction: Record<string, unknown>,
): Promise<unknown> {
  const { chainIdHex, ...rpcTransaction } = transaction;
  // Wallet previews need the intended network on each request, even after a switch.
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ ...rpcTransaction, chainId: normalizeTransactionChainId(transaction.chainId ?? chainIdHex) }],
  });
}
