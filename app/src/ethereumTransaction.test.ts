import { describe, expect, it, vi } from "vitest";
import { sendEthereumTransaction } from "./ethereumTransaction";

const transaction = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0x1234",
  value: "0x0",
};

describe("Ethereum transaction network", () => {
  it("includes Base on the wallet request without relying on the wallet's selected network", async () => {
    const request = vi.fn().mockResolvedValue("0xhash");
    await expect(sendEthereumTransaction({ request }, transaction)).resolves.toBe("0xhash");
    expect(request).toHaveBeenCalledExactlyOnceWith({
      method: "eth_sendTransaction",
      params: [{ ...transaction, chainId: "0x2105" }],
    });
    expect(transaction).not.toHaveProperty("chainId");
  });

  it.each([8453, 8453n, "8453", "0x002105", "0X2105"])("normalizes explicit chain ID %s", async (chainId: unknown) => {
    const request = vi.fn().mockResolvedValue("0xhash");
    await sendEthereumTransaction({ request }, { ...transaction, chainId });
    expect(request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [{ ...transaction, chainId: "0x2105" }],
    });
  });

  it("preserves an explicitly supplied network and strips internal chainIdHex metadata", async () => {
    const request = vi.fn().mockResolvedValue("0xhash");
    await sendEthereumTransaction({ request }, { ...transaction, chainIdHex: "0x0a" });
    expect(request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [{ ...transaction, chainId: "0xa" }],
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "", "0x", "base", "eip155:8453", true])(
    "rejects invalid chain ID %s before requesting a transaction",
    (chainId: unknown) => {
      const request = vi.fn();
      expect(() => sendEthereumTransaction({ request }, { ...transaction, chainId })).toThrow("Invalid transaction chain ID");
      expect(request).not.toHaveBeenCalled();
    },
  );
});
