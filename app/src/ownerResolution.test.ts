import { describe, expect, it } from "vitest";
import { resolveEffectiveWarpletOwner, type WarpletOwner } from "./ownerResolution";

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
