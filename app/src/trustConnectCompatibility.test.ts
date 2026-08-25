import { describe, expect, it } from "vitest";
import {
  isWalletConnectWallet,
  normalizeTrustConnectAccounts,
  normalizeTrustConnectChainReference,
  toEip1193ChainId,
} from "./trustConnectCompatibility";

describe("TrustConnect compatibility", () => {
  it("recognizes WalletConnect adapters across SDK descriptor variants", () => {
    expect(isWalletConnectWallet({ currentSession: { topic: "topic" } })).toBe(true);
    expect(isWalletConnectWallet({ type: "caip" })).toBe(true);
    expect(isWalletConnectWallet({ id: "wallet-connect", name: "Mobile" })).toBe(true);
    expect(isWalletConnectWallet({ id: "injected", name: "Browser wallet" })).toBe(false);
  });

  it("normalizes decimal, hexadecimal, CAIP-2, and object chain values", () => {
    expect(normalizeTrustConnectChainReference("8453")).toBe("8453");
    expect(normalizeTrustConnectChainReference("0x2105")).toBe("8453");
    expect(normalizeTrustConnectChainReference("eip155:8453")).toBe("8453");
    expect(normalizeTrustConnectChainReference({ reference: "8453" })).toBe("8453");
    expect(toEip1193ChainId("eip155:8453")).toBe("0x2105");
  });

  it("normalizes both single-address and EIP-1193 account arrays", () => {
    expect(normalizeTrustConnectAccounts("0xabc")).toEqual(["0xabc"]);
    expect(normalizeTrustConnectAccounts(["0xabc", null, 1])).toEqual(["0xabc"]);
    expect(normalizeTrustConnectAccounts(null)).toEqual([]);
  });
});
