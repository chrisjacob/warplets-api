import { describe, expect, it } from "vitest";
import { isUsableStoredNonce } from "./authValidation";

describe("authentication nonce replay protection", () => {
  it("accepts only an unconsumed, unexpired nonce", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isUsableStoredNonce({ consumed_at: null, expires_at: future })).toBe(true);
    expect(isUsableStoredNonce({ consumed_at: new Date().toISOString(), expires_at: future })).toBe(false);
    expect(isUsableStoredNonce({ consumed_at: null, expires_at: new Date(Date.now() - 1).toISOString() })).toBe(false);
  });
});
