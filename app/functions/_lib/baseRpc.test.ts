import { describe, expect, it, vi } from "vitest";
import { fetchBaseRpc, getBaseRpcUrls } from "./baseRpc";

describe("Base RPC failover", () => {
  it("prefers the configured provider and falls back after a rate limit", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      if (requested.length === 1) return new Response("rate limited", { status: 429 });
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1234" });
    }) as typeof fetch;

    await expect(fetchBaseRpc(
      { BASE_RPC_URL: "https://base-mainnet.g.alchemy.com/v2/test-key" },
      "eth_call",
      [],
      { fetcher },
    )).resolves.toBe("0x1234");

    expect(requested).toEqual([
      "https://base-mainnet.g.alchemy.com/v2/test-key",
      "https://base-rpc.publicnode.com",
    ]);
  });

  it("does not expose a configured provider key in terminal errors", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 })) as typeof fetch;

    const failure = fetchBaseRpc(
      { BASE_RPC_URL: "https://base-mainnet.g.alchemy.com/v2/super-secret-key" },
      "eth_call",
      [],
      { fetcher },
    );
    await expect(failure).rejects.toThrow("base-mainnet.g.alchemy.com: HTTP 503");
    await failure.catch((error) => {
      expect(error instanceof Error ? error.message : String(error)).not.toContain("super-secret-key");
    });
  });

  it("ignores invalid or insecure configured URLs", () => {
    expect(getBaseRpcUrls({ BASE_RPC_URL: "http://localhost:8545" })).toEqual([
      "https://base-rpc.publicnode.com",
      "https://mainnet.base.org",
    ]);
  });
});
