import { describe, expect, it, vi } from "vitest";
import { connectSolana, signOwnership, supportedWallet, type SolanaAccount, type SolanaWallet } from "./walletIdentityClient";

function mockWallet() {
  const account = { address: "7aQnQwuzWNTxDb3ysMjvNZmPEU9NSiEvRCfAFLppump", publicKey: new Uint8Array(32).fill(7), chains: ["solana:mainnet"], features: ["solana:signMessage"] } as SolanaAccount;
  const sign = vi.fn(async ({ message }: { message: Uint8Array }) => [{ signedMessage: message, signature: new Uint8Array(64).fill(2), signatureType: "ed25519" as const }]);
  const connect = vi.fn(async () => ({ accounts: [account] }));
  const wallet = { name: "Test wallet", version: "1.0.0", icon: "data:image/png;base64,", chains: ["solana:mainnet"], accounts: [account], features: { "standard:connect": { version: "1.0.0", connect }, "standard:events": { version: "1.0.0", on: () => () => {} }, "solana:signMessage": { version: "1.0.0", signMessage: sign } } } as SolanaWallet;
  return { wallet, account, sign, connect };
}
describe("Solana ownership message adapter", () => {
  it("connects only on request and signs the exact reviewed bytes with no transaction API", async () => {
    const m = mockWallet(); expect(supportedWallet(m.wallet)).toBe(true); expect(m.connect).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
    expect(await connectSolana(m.wallet)).toEqual([m.account]);
    const proof = await signOwnership(m, "domain-bound local proof", () => true);
    expect(m.sign).toHaveBeenCalledWith({ account: m.account, message: new TextEncoder().encode("domain-bound local proof") });
    expect(atob(proof)).toHaveLength(64);
  });
  it("rejects modified signed message bytes", async () => {
    const m = mockWallet(); m.sign.mockImplementation(async () => [{ signedMessage: new TextEncoder().encode("modified"), signature: new Uint8Array(64), signatureType: "ed25519" }]);
    await expect(signOwnership(m, "expected", () => true)).rejects.toThrow("modified or unsupported");
  });
  it("rejects cancellation or account switches before submitting the signed output", async () => {
    const m = mockWallet(); let current = true;
    m.sign.mockImplementation(async ({ message }) => { current = false; return [{ signedMessage: message, signature: new Uint8Array(64), signatureType: "ed25519" }]; });
    await expect(signOwnership(m, "expected", () => current)).rejects.toThrow("Wallet changed during signing");
    m.sign.mockClear(); await expect(signOwnership(m, "expected", () => false)).rejects.toThrow("Wallet changed"); expect(m.sign).not.toHaveBeenCalled();
  });
  it("rejects wallet removal, unsupported chain/account and malformed output", async () => {
    const m = mockWallet(); const removed = { ...m.wallet, accounts: [] };
    await expect(signOwnership({ wallet: removed, account: m.account }, "expected", () => true)).rejects.toThrow("Wallet changed");
    expect(supportedWallet({ ...m.wallet, chains: ["solana:devnet"] })).toBe(false);
    m.sign.mockImplementation(async ({ message }) => [{ signedMessage: message, signature: new Uint8Array(63), signatureType: "ed25519" }]);
    await expect(signOwnership(m, "expected", () => true)).rejects.toThrow("modified or unsupported");
    m.connect.mockResolvedValue({ accounts: [{ ...m.account, features: [] }] }); expect(await connectSolana(m.wallet)).toEqual([]);
  });
  it("propagates wallet rejection without making a verify request", async () => {
    const m = mockWallet(); m.sign.mockRejectedValue(new Error("User rejected request"));
    await expect(signOwnership(m, "expected", () => true)).rejects.toThrow("User rejected request");
  });
});
