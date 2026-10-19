import { describe, expect, it } from "vitest";
import { syntheticBundle } from "./fixtures";
import { AMM, canonicalPool, creationProof, graduationProof, migrations, PUMP, verifyState } from "./pump";
import { base64, findPda, fromBase58, publicKey, seed, toBase58 } from "./solana";

describe("Solana encoding and canonical addresses", () => {
  it("round-trips leading zeroes and rejects invalid/oversized keys", () => {
    for (const bytes of [new Uint8Array(32), new Uint8Array([0, 0, 1, 255]), new Uint8Array(64).fill(255)]) expect(fromBase58(toBase58(bytes))).toEqual(bytes);
    expect(() => publicKey("111")).toThrow(); expect(() => fromBase58("0OIl")).toThrow();
    expect(() => publicKey("z".repeat(100))).toThrow();
  });
  it("matches the independently published Pump global PDA", async () => {
    expect(await findPda(PUMP, [seed("global")])).toBe("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
  });
});
describe("Pump proof verification against pinned instruction layouts", () => {
  it("verifies separate creation, migration CPI and initialized canonical state", async () => {
    const b = await syntheticBundle();
    const origin = await creationProof(b.creation, b.mint, new Date().toISOString());
    const migration = (await migrations(b.graduation))[0]!;
    expect(origin?.proof.kind).toBe("creation"); expect(origin?.proof.program).toBe(PUMP);
    expect((await graduationProof(b.graduation, migration, new Date().toISOString())).kind).toBe("graduation");
    expect(await verifyState(migration, b.accounts, new Date().toISOString(), b.graduation.slot)).toMatchObject({ mint_authority: "revoked", freeze_authority: "revoked", pool_reserves_verified: true });
    expect(origin?.proof.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("resolves v0 loaded addresses", async () => {
    const b = await syntheticBundle();
    b.creation.meta!.loadedAddresses!.writable = b.creation.transaction.message.accountKeys.splice(2);
    expect(await creationProof(b.creation, b.mint, new Date().toISOString())).not.toBeNull();
  });
  it("supports legacy transactions too", async () => {
    const b = await syntheticBundle(); b.creation.version = "legacy";
    expect(await creationProof(b.creation, b.mint, new Date().toISOString())).not.toBeNull();
  });
  it("does not trust a spoofing program with real discriminators", async () => {
    const b = await syntheticBundle(); b.creation.transaction.message.accountKeys[0] = AMM;
    expect(await creationProof(b.creation, b.mint, new Date().toISOString())).toBeNull();
    b.graduation.transaction.message.accountKeys[0] = AMM;
    expect(await migrations(b.graduation)).toEqual([]);
  });
  it("rejects failed transactions and unknown chain time", async () => {
    const b = await syntheticBundle(); b.creation.meta!.err = { InstructionError: [0, "failed"] };
    await expect(creationProof(b.creation, b.mint, new Date().toISOString())).rejects.toThrow();
    b.graduation.blockTime = null; await expect(migrations(b.graduation)).rejects.toThrow();
  });
  it("cannot infer migration from a completed curve or another create_pool", async () => {
    const b = await syntheticBundle(); b.graduation.meta!.innerInstructions = [];
    await expect(migrations(b.graduation)).rejects.toThrow("migration_pool_creation_unproven");
    const c = await syntheticBundle(); c.graduation.transaction.message.instructions[0]!.data = c.creation.transaction.message.instructions[0]!.data;
    expect(await migrations(c.graduation)).toEqual([]);
  });
  it("rejects wrong canonical pool and wrong curve addresses", async () => {
    const b = await syntheticBundle(); b.graduation.transaction.message.accountKeys[10] = PUMP;
    await expect(migrations(b.graduation)).rejects.toThrow("noncanonical_migration");
    const c = await syntheticBundle(); c.creation.transaction.message.accountKeys[3] = PUMP;
    await expect(creationProof(c.creation, c.mint, new Date().toISOString())).rejects.toThrow();
  });
  it("rejects stale state, wrong account owners and discriminator spoofing", async () => {
    const b = await syntheticBundle(), m = (await migrations(b.graduation))[0]!;
    await expect(verifyState(m, { ...b.accounts, context: { slot: 1 } }, "2026-10-20T00:00:00Z", b.graduation.slot)).rejects.toThrow("stale_account_context");
    b.accounts.value[1]!.owner = PUMP;
    await expect(verifyState(m, b.accounts, "2026-10-20T00:00:00Z", b.graduation.slot)).rejects.toThrow();
    const c = await syntheticBundle(); c.accounts.value[1]!.data[0] = btoa("bad");
    await expect(verifyState((await migrations(c.graduation))[0]!, c.accounts, "2026-10-20T00:00:00Z", c.graduation.slot)).rejects.toThrow();
  });
  it("rejects empty or frozen vaults and a curve without completion", async () => {
    for (const offset of [64, 108]) {
      const b = await syntheticBundle(); const data = base64(b.accounts.value[2]!.data[0]);
      if (offset === 64) data.fill(0, 64, 72); else data[108] = 2;
      b.accounts.value[2]!.data[0] = btoa(String.fromCharCode(...data));
      await expect(verifyState((await migrations(b.graduation))[0]!, b.accounts, "2026-10-20T00:00:00Z", b.graduation.slot)).rejects.toThrow();
    }
    const b = await syntheticBundle(), data = base64(b.accounts.value[4]!.data[0]); data[48] = 0;
    b.accounts.value[4]!.data[0] = btoa(String.fromCharCode(...data));
    await expect(verifyState((await migrations(b.graduation))[0]!, b.accounts, "2026-10-20T00:00:00Z", b.graduation.slot)).rejects.toThrow("curve_not_complete");
  });
  it("identifies mint/freeze authority risk separately from origin proof", async () => {
    const b = await syntheticBundle(), data = base64(b.accounts.value[0]!.data[0]); data[0] = 1; data[46] = 1;
    b.accounts.value[0]!.data[0] = btoa(String.fromCharCode(...data));
    expect(await verifyState((await migrations(b.graduation))[0]!, b.accounts, "2026-10-20T00:00:00Z", b.graduation.slot)).toMatchObject({ mint_authority: "active", freeze_authority: "active" });
  });
  it("produces different canonical pools for different mints", async () => {
    const a = await syntheticBundle(), b = await syntheticBundle(undefined, 42);
    expect(await canonicalPool(a.mint)).not.toEqual(await canonicalPool(b.mint));
  });
});
