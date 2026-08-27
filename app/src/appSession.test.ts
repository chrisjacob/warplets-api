import { afterEach, describe, expect, it, vi } from "vitest";
import { stringToHex } from "viem";
import { authenticateBaseWallet, authenticateWallet } from "./appSession";
import { subscribeToWalletReviewRequests, type EthereumProvider } from "./walletTrade";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as const;

function json(payload: Record<string, unknown>): Response {
  return Response.json(payload);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticateBaseWallet", () => {
  it("uses wallet_connect SIWE and submits the wallet-provided signature", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ signInWithEthereum: { nonce: "12345678", chainId: "0x2105" } }))
      .mockResolvedValueOnce(json({ walletAddress: ADDRESS }));
    vi.stubGlobal("fetch", fetcher);
    const request = vi.fn(async ({ method }: { method: string }) => {
      expect(method).toBe("wallet_connect");
      return {
        accounts: [{
          address: ADDRESS.toUpperCase().replace("0X", "0x"),
          capabilities: { signInWithEthereum: { message: "signed SIWE", signature: "0x1234" } },
        }],
      };
    });
    const provider = { request } satisfies EthereumProvider;

    await expect(authenticateBaseWallet(provider, 8453)).resolves.toBe(ADDRESS);
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/auth/wallet/verify", expect.objectContaining({
      body: JSON.stringify({ message: "signed SIWE", signature: "0x1234" }),
    }));
  });

  it("falls back to account request and personal_sign only when wallet_connect is unsupported", async () => {
    const message = "app.10x.meme wants you to sign in";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ signInWithEthereum: { nonce: "12345678", chainId: "0x2105" } }))
      .mockResolvedValueOnce(json({ message }))
      .mockResolvedValueOnce(json({ walletAddress: ADDRESS }));
    vi.stubGlobal("fetch", fetcher);
    const unsupported = Object.assign(new Error("wallet_connect is not supported"), { code: 4200 });
    const request = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] | object }) => {
      if (method === "wallet_connect") throw unsupported;
      if (method === "eth_requestAccounts") return [ADDRESS];
      if (method === "personal_sign") {
        expect(params).toEqual([stringToHex(message), ADDRESS]);
        return "0xabcd";
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const provider = { request } satisfies EthereumProvider;

    await expect(authenticateBaseWallet(provider, 8453)).resolves.toBe(ADDRESS);
    expect(request.mock.calls.map(([call]) => call.method)).toEqual([
      "wallet_connect",
      "eth_requestAccounts",
      "personal_sign",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not turn a rejected login into a second wallet prompt", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      json({ signInWithEthereum: { nonce: "12345678", chainId: "0x2105" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const rejected = Object.assign(new Error("User rejected request"), { code: 4001 });
    const request = vi.fn(async () => { throw rejected; });
    const provider = { request } satisfies EthereumProvider;

    await expect(authenticateBaseWallet(provider, 8453)).rejects.toThrow("User rejected request");
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("authenticateWallet", () => {
  it("publishes the external-wallet signature lifecycle for SIWE", async () => {
    const message = "app.10x.meme wants you to sign in";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ message }))
      .mockResolvedValueOnce(json({ walletAddress: ADDRESS }));
    vi.stubGlobal("fetch", fetcher);
    const request = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] | object }) => {
      expect(method).toBe("personal_sign");
      expect(params).toEqual([stringToHex(message), ADDRESS]);
      return "0xabcd";
    });
    const provider = { request, connectorId: "trustconnect-walletconnect" } satisfies EthereumProvider;
    const phases: string[] = [];
    const unsubscribe = subscribeToWalletReviewRequests(({ phase }) => phases.push(phase));

    try {
      await authenticateWallet(provider, ADDRESS, 8453);
    } finally {
      unsubscribe();
    }

    expect(phases).toEqual(["started", "settled"]);
  });
});
