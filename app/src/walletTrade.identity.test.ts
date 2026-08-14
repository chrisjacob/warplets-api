import { describe, expect, it, vi } from "vitest";
import { hashTypedData } from "viem";
import {
  ensureBaseChain,
  getWalletAccounts,
  normalizeBaseAccountTypedData,
  preferBaseChainBeforeConnect,
  signTypedData,
  type EthereumProvider,
} from "./walletTrade";

const typedData = {
  domain: {
    name: "Seaport",
    version: "1.6",
    chainId: 8453,
    verifyingContract: "0x0000000000000068f116a894984e2db1123eb395",
  },
  types: {
    Offer: [{ name: "offerer", type: "address" }],
  },
  primaryType: "Offer",
  message: { offerer: "0x1111111111111111111111111111111111111111" },
};

const traitTypedData = {
  domain: typedData.domain,
  types: {
    OrderComponents: [
      { name: "salt", type: "uint256" },
      { name: "consideration", type: "ConsiderationItem[]" },
    ],
    ConsiderationItem: [
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "startAmount", type: "uint256" },
    ],
  },
  primaryType: "OrderComponents",
  message: {
    salt: "40061009433611222298775254086144492995086119637550127849041123047889349475674",
    consideration: [{
      identifierOrCriteria: "73996057079109433463218079021272771131855039873928381673080831441901168460159",
      startAmount: "1",
    }],
  },
};

describe("wallet signer identity", () => {
  it("preserves Base Account uint256 trait criteria as exact hex quantities", () => {
    const normalized = normalizeBaseAccountTypedData(traitTypedData) as typeof traitTypedData;

    expect(normalized.message.salt).toMatch(/^0x[0-9a-f]+$/);
    expect(normalized.message.consideration[0].identifierOrCriteria).toMatch(/^0x[0-9a-f]+$/);
    expect(normalized.message.consideration[0].startAmount).toBe("0x1");
    expect(BigInt(normalized.message.consideration[0].identifierOrCriteria)).toBe(
      BigInt(traitTypedData.message.consideration[0].identifierOrCriteria),
    );
    expect(hashTypedData(traitTypedData as Parameters<typeof hashTypedData>[0])).toBe(
      hashTypedData(normalized as Parameters<typeof hashTypedData>[0]),
    );
  });

  it("waits for an injected provider to report Base after switching", async () => {
    let chainReads = 0;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") {
        chainReads += 1;
        return chainReads === 1 ? "0x1" : "0x2105";
      }
      return null;
    });

    await ensureBaseChain({ request } as EthereumProvider);

    expect(request.mock.calls.map(([call]) => call.method)).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_chainId",
    ]);
  });

  it("selects Base before an injected wallet requests account access", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x1";
      return null;
    });

    await preferBaseChainBeforeConnect({ request } as EthereumProvider);

    expect(request.mock.calls.map(([call]) => call.method)).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
    ]);
    expect(request).toHaveBeenLastCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    });
  });

  it("lets account connection continue when a wallet requires authorization before switching", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x1";
      throw Object.assign(new Error("Unauthorized before account connection"), { code: 4100 });
    });

    await expect(preferBaseChainBeforeConnect({ request } as EthereumProvider)).resolves.toBeUndefined();
  });

  it("does not ignore a rejected preliminary Base network request", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x1";
      throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    });

    await expect(preferBaseChainBeforeConnect({ request } as EthereumProvider)).rejects.toThrow("User rejected");
  });

  it("never substitutes an unconnected profile address for a signer", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === "eth_accounts"
      ? []
      : ["0x2222222222222222222222222222222222222222"]);
    const accounts = await getWalletAccounts(
      { request } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
    );
    expect(accounts[0].toLowerCase()).toBe("0x2222222222222222222222222222222222222222");
    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("sends structured typed data first for standard EIP-1193 wallets", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const request = vi.fn(async (request: { method: string; params?: unknown[] }) => {
      calls.push(request);
      return `0x${"11".repeat(65)}`;
    });

    await signTypedData(
      { request } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      typedData,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({
      method: "eth_signTypedData_v4",
      params: ["0x1111111111111111111111111111111111111111", expect.objectContaining({ primaryType: "Offer" })],
    });
    const signRequest = calls[0]?.params?.[0] as { request?: { data?: { types?: Record<string, unknown> } } };
    expect(signRequest.request?.data?.types?.EIP712Domain).toBeUndefined();
  });

  it("uses Base Account's documented structured EIP-712 request", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const request = vi.fn(async (request: { method: string; params?: unknown[] }) => {
      calls.push(request);
      return `0x${"33".repeat(65)}`;
    });

    await signTypedData(
      { request, isBaseAccount: true } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      typedData,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({
      method: "eth_signTypedData_v4",
      params: [
        "0x1111111111111111111111111111111111111111",
        expect.objectContaining({ primaryType: "Offer" }),
      ],
    });
  });

  it("keeps Base Account typed-data integer strings in OpenSea's decimal representation", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const request = vi.fn(async (request: { method: string; params?: unknown[] }) => {
      calls.push(request);
      return `0x${"44".repeat(65)}`;
    });

    await signTypedData(
      { request, isBaseAccount: true } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      traitTypedData,
    );

    const sent = calls[0]?.params?.[1] as typeof traitTypedData;
    expect(sent.message.salt).toBe(traitTypedData.message.salt);
    expect(sent.message.consideration[0].identifierOrCriteria).toBe(
      traitTypedData.message.consideration[0].identifierOrCriteria,
    );
    expect(sent.message.consideration[0].startAmount).toBe("1");
  });

  it("does not retry a rejected Base Account signature", async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    });

    await expect(signTypedData(
      { request, isBaseAccount: true } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      typedData,
    )).rejects.toThrow("User rejected");

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not open a second Base prompt for a non-format signing failure", async () => {
    const request = vi.fn(async () => {
      throw new Error("Error Generating message. Please make sure you have enough funds.");
    });

    await expect(signTypedData(
      { request, isBaseAccount: true } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      typedData,
    )).rejects.toThrow("Error Generating message");

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls back to serialized EIP-712 for Base Account invalid params", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const request = vi.fn(async (request: { method: string; params?: unknown[] }) => {
      calls.push(request);
      if (calls.length === 1) throw Object.assign(new Error("Invalid params"), { code: -32602 });
      return `0x${"44".repeat(65)}`;
    });

    await signTypedData(
      { request, isBaseAccount: true } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      typedData,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(calls[0]?.method).toBe("eth_signTypedData_v4");
    expect(calls[1]?.method).toBe("eth_signTypedData_v4");
    expect(typeof calls[0]?.params?.[1]).toBe("object");
    expect(typeof calls[1]?.params?.[1]).toBe("string");
  });

  it("does not retry a Base Account internal signing error", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const request = vi.fn(async (request: { method: string; params?: unknown[] }) => {
      calls.push(request);
      throw Object.assign(new Error("Internal error"), { code: -32603 });
    });

    await expect(signTypedData(
      { request, isBaseAccount: true } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      typedData,
    )).rejects.toThrow("Internal error");

    expect(request).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.method)).toEqual(["eth_signTypedData_v4"]);
  });

  it("falls back to serialized typed data for older wallets", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const request = vi.fn(async (request: { method: string; params?: unknown[] }) => {
      calls.push(request);
      if (calls.length === 1) throw Object.assign(new Error("Invalid params"), { code: -32602 });
      return `0x${"22".repeat(65)}`;
    });

    await signTypedData(
      { request } as EthereumProvider,
      "0x1111111111111111111111111111111111111111",
      typedData,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(typeof calls[1]?.params?.[1]).toBe("string");
  });
});
