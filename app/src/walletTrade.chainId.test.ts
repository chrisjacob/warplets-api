import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildSeaportCancelTransaction,
  combinePreparedOpenSeaTransactions,
  ensureErc20Approval,
  ensureErc721ApprovalForAll,
  executeOpenSeaActions,
  extractFulfillmentTransaction,
  sendAttributedTransaction,
  sendPreparedTransaction,
  sendPreparedTransactionsAtomic,
  wrapEthToWeth,
  type EthereumProvider,
} from "./walletTrade";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const account = signer.address;
const target = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";
const transactionHash = `0x${"12".repeat(32)}`;
const transaction = { to: target, data: "0x1234", value: "0x0" };
const zeroAddress = `0x${"0".repeat(40)}`;
const zeroBytes = `0x${"0".repeat(64)}`;
const signatureAction = {
  type: "signature",
  typedData: {
    domain: { name: "Seaport", version: "1.6", chainId: 8453, verifyingContract: target },
    types: { Offer: [{ name: "offerer", type: "address" }] },
    primaryType: "Offer",
    message: { offerer: account },
  },
} as const;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body));
    if (method === "eth_call") return Response.json({ result: "0x0" });
    if (method === "eth_getTransactionReceipt") return Response.json({ result: { status: "0x1", transactionHash } });
    throw new Error(`Unexpected RPC method: ${method}`);
  }));
});

afterEach(() => vi.unstubAllGlobals());

function wallet() {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_sendTransaction") return transactionHash;
    if (method === "eth_signTypedData_v4") return signer.signTypedData(signatureAction.typedData);
    if (method === "wallet_sendCalls") return { id: "batch-1" };
    if (method === "wallet_getCallsStatus") {
      return { status: 200, atomic: true, receipts: [{ status: "0x1", transactionHash, logs: [] }] };
    }
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  return { request, connectorId: "farcaster" } satisfies EthereumProvider;
}

function expectTransaction(provider: ReturnType<typeof wallet>, chainId = "0x2105") {
  expect(provider.request.mock.calls.filter(([{ method }]: [{ method: string }]) => method === "eth_sendTransaction")).toHaveLength(1);
  expect(provider.request).toHaveBeenCalledWith({
    method: "eth_sendTransaction",
    params: [expect.objectContaining({ from: account, chainId })],
  });
}

describe("Warplets transaction chain IDs", () => {
  it.each(["farcaster", "base-account", "trustconnect-walletconnect", "legacy-injected"])(
    "includes Base for %s regardless of wallet network state",
    async (connectorId: string) => {
      const provider = { ...wallet(), connectorId };
      await sendAttributedTransaction(provider, { from: account, ...transaction });
      expectTransaction(provider);
    },
  );

  it.each(["purchase", "wrap", "erc20 approval", "nft approval", "cancellation", "OpenSea action"])(
    "includes Base for %s",
    async (flow: string) => {
      const provider = wallet();
      switch (flow) {
        case "purchase": await sendPreparedTransaction(provider, account, transaction); break;
        case "wrap": await wrapEthToWeth(provider, account, target, 1n); break;
        case "erc20 approval": await ensureErc20Approval(provider, account, { tokenAddress: target, spender, amount: "1" }); break;
        case "nft approval": await ensureErc721ApprovalForAll(provider, account, { tokenAddress: target, spender }); break;
        case "cancellation":
          await sendPreparedTransaction(provider, account, buildSeaportCancelTransaction(target, {
            offerer: account, zone: zeroAddress, offer: [], consideration: [], orderType: 0,
            startTime: "0", endTime: "1", zoneHash: zeroBytes, salt: "1", conduitKey: zeroBytes, counter: "0",
          }));
          break;
        case "OpenSea action": await executeOpenSeaActions(provider, account, { actions: [{ transactionAction: { transaction } }, signatureAction] }); break;
      }
      expectTransaction(provider);
    },
  );

  it.each([
    { fulfillment: { transaction: { ...transaction, chainId: 10 } } },
    { fulfillment: { transaction: { ...transaction, chainIdHex: "0x0a" } } },
    { chainIdHex: "0xa", fulfillment: { transaction } },
  ])("preserves the prepared network through extraction and sending: %j", async (payload: unknown) => {
    const provider = wallet();
    const prepared = extractFulfillmentTransaction(payload);
    expect(prepared?.chainIdHex).toBe("0xa");
    await sendPreparedTransaction(provider, account, prepared!);
    expectTransaction(provider, "0xa");
  });

  it("preserves an OpenSea action's explicit network", async () => {
    const provider = wallet();
    await executeOpenSeaActions(provider, account, {
      actions: [{ transactionAction: { transaction: { ...transaction, chainId: 10 } } }, signatureAction],
    });
    expectTransaction(provider, "0xa");
  });

  it.each([undefined, "0x2105", "0xa"])("includes the intended network on atomic batches: %s", async (chainIdHex: string | undefined) => {
    const provider = wallet();
    const transactions = [transaction, { ...transaction, chainIdHex }];
    await sendPreparedTransactionsAtomic(provider, account, transactions);
    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_sendCalls",
      params: [expect.objectContaining({ chainId: chainIdHex ?? "0x2105" })],
    });
  });

  it("uses the explicit batch network when transactions omit it", async () => {
    const provider = wallet();
    await sendPreparedTransactionsAtomic(provider, account, [transaction, transaction], "0x0a");
    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_sendCalls",
      params: [expect.objectContaining({ chainId: "0xa" })],
    });
  });

  it.each([undefined, "0x2105"])("rejects conflicting atomic batch networks before prompting: %s", async (chainIdHex: string | undefined) => {
    const provider = wallet();
    await expect(sendPreparedTransactionsAtomic(provider, account, [
      { ...transaction, chainIdHex: "0x2105" }, { ...transaction, chainIdHex: "0xa" },
    ], chainIdHex)).rejects.toThrow("same chain ID");
    expect(provider.request).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves the network on combined OpenSea transactions (advanced: %s)", (advanced: boolean) => {
    const inputData = advanced
      ? { advancedOrder: { parameters: { offer: [], consideration: [] } }, fulfillerConduitKey: zeroBytes }
      : { orders: [{}] };
    const combined = combinePreparedOpenSeaTransactions([
      { ...transaction, inputData, chainIdHex: "0x0a" }, { ...transaction, inputData, chainIdHex: "0xa" },
    ]);
    expect(combined.chainIdHex).toBe("0xa");
  });

  it("rejects conflicting networks when combining OpenSea transactions", () => {
    expect(() => combinePreparedOpenSeaTransactions([
      { ...transaction, chainIdHex: "0x2105" }, { ...transaction, chainIdHex: "0xa" },
    ])).toThrow("same chain ID");
  });
});
