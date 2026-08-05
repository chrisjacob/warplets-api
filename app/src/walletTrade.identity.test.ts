import { describe, expect, it, vi } from "vitest";
import { getWalletAccounts, type EthereumProvider } from "./walletTrade";

describe("wallet signer identity", () => {
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
});
