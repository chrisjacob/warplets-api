import { describe, expect, it } from "vitest";
import {
  findRarestOwnedWarpletTokenId,
  resolveEffectiveWarpletOwner,
  type WarpletOwner,
} from "./ownerResolution";

const cachedOwner: WarpletOwner = {
  wallet: "0xf7a59fefd59500c9dc66a851d7305eaa01b9cce1",
  fid: 789706,
  checkedAt: "2026-08-25T00:00:00.000Z",
  username: "vanan",
};

describe("Warplet owner resolution", () => {
  it("preserves cached ownership when a live lookup returns no wallet", () => {
    expect(resolveEffectiveWarpletOwner(
      { wallet: null, fid: null, checkedAt: "2026-08-25T01:00:00.000Z" },
      cachedOwner,
    )).toEqual(cachedOwner);
  });

  it("retains cached profile data when the live wallet matches", () => {
    expect(resolveEffectiveWarpletOwner(
      { wallet: cachedOwner.wallet?.toUpperCase() ?? null, fid: null, checkedAt: "2026-08-25T01:00:00.000Z" },
      cachedOwner,
    )).toMatchObject({
      wallet: cachedOwner.wallet?.toUpperCase(),
      fid: 789706,
      username: "vanan",
      checkedAt: "2026-08-25T01:00:00.000Z",
    });
  });

  it("accepts a genuinely changed live owner", () => {
    const changed = { wallet: "0x0000000000000000000000000000000000000001", fid: null, checkedAt: null };
    expect(resolveEffectiveWarpletOwner(changed, cachedOwner)).toEqual(changed);
  });
});

describe("personalized Warplet selection", () => {
  const owners = {
    "1589": { wallet: "0x1111111111111111111111111111111111111111", fid: null },
    "4321": { wallet: "0x1111111111111111111111111111111111111111", fid: 123 },
    "777": { wallet: "0x2222222222222222222222222222222222222222", fid: 123 },
  };

  it("selects the rarest token owned by the connected wallet", () => {
    expect(findRarestOwnedWarpletTokenId(owners, {
      wallet: "0x1111111111111111111111111111111111111111".toUpperCase(),
      fid: null,
    })).toBe(1589);
  });

  it("falls back to Farcaster ownership when no wallet is connected", () => {
    expect(findRarestOwnedWarpletTokenId(owners, { fid: 123 })).toBe(777);
  });

  it("treats the connected wallet as authoritative when both identities exist", () => {
    expect(findRarestOwnedWarpletTokenId(owners, {
      wallet: "0x1111111111111111111111111111111111111111",
      fid: 123,
    })).toBe(1589);
  });
});
