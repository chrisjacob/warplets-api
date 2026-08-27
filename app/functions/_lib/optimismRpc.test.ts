import { describe, expect, it } from "vitest";
import { getOptimismRpcUrls } from "./optimismRpc";

describe("Optimism RPC configuration", () => {
  it("prefers a dedicated Optimism provider", () => {
    expect(getOptimismRpcUrls({
      OPTIMISM_RPC_URL: "https://opt-mainnet.g.alchemy.com/v2/optimism-key",
      BASE_RPC_URL: "https://base-mainnet.g.alchemy.com/v2/base-key",
    })).toEqual([
      "https://opt-mainnet.g.alchemy.com/v2/optimism-key",
      "https://opt-mainnet.g.alchemy.com/v2/base-key",
      "https://optimism-rpc.publicnode.com",
      "https://mainnet.optimism.io",
    ]);
  });

  it("reuses an existing Base Alchemy key for Optimism", () => {
    expect(getOptimismRpcUrls({
      BASE_RPC_URL: "https://base-mainnet.g.alchemy.com/v2/shared-key",
    })[0]).toBe("https://opt-mainnet.g.alchemy.com/v2/shared-key");
  });

  it("ignores insecure and unrelated configured provider URLs", () => {
    expect(getOptimismRpcUrls({
      OPTIMISM_RPC_URL: "http://localhost:8545",
      BASE_RPC_URL: "https://mainnet.base.org",
    })).toEqual([
      "https://optimism-rpc.publicnode.com",
      "https://mainnet.optimism.io",
    ]);
  });
});
