import { describe, expect, it, vi } from "vitest";
import type { AppSession } from "../_lib/appAuth";
import { resolveSessionFavouriteWallet, resolveWarpletLocalRequestedWallet } from "./warplet-favourites";

const SESSION_WALLET = "0x1111111111111111111111111111111111111111" as const;
const PRIMARY_WALLET = "0x2222222222222222222222222222222222222222" as const;

function appSession(overrides: Partial<AppSession> = {}): AppSession {
  return {
    sessionHash: "session",
    farcasterFid: 1234,
    walletAddress: SESSION_WALLET,
    farcasterSignerUuid: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    lastSeenAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-09-30T00:00:00.000Z",
    absoluteExpiresAt: "2026-11-29T00:00:00.000Z",
    ...overrides,
  };
}

function mockDb(rows: Array<{ wallet: string | null } | null>): D1Database {
  const first = vi.fn(async () => rows.shift() ?? null);
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first })),
    })),
  } as unknown as D1Database;
}

describe("resolveSessionFavouriteWallet", () => {
  it("falls back to the verified session wallet when local Farcaster tables have no primary wallet", async () => {
    await expect(resolveSessionFavouriteWallet(mockDb([null, null]), appSession())).resolves.toBe(SESSION_WALLET);
  });

  it("prefers a Farcaster-linked primary wallet over the session wallet", async () => {
    await expect(resolveSessionFavouriteWallet(mockDb([{ wallet: PRIMARY_WALLET }]), appSession())).resolves.toBe(PRIMARY_WALLET);
  });

  it("uses the verified wallet directly for a wallet-only session", async () => {
    const prepare = vi.fn();
    const db = { prepare } as unknown as D1Database;
    await expect(resolveSessionFavouriteWallet(db, appSession({ farcasterFid: null }))).resolves.toBe(SESSION_WALLET);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("resolveWarpletLocalRequestedWallet", () => {
  it("allows an authenticated local Farcaster session to use its connected wallet", () => {
    expect(resolveWarpletLocalRequestedWallet(
      new Request("https://warplet-local.10x.meme/api/warplet-favourites"),
      appSession({ walletAddress: null }),
      SESSION_WALLET,
    )).toBe(SESSION_WALLET);
  });

  it("does not relax wallet resolution on production", () => {
    expect(resolveWarpletLocalRequestedWallet(
      new Request("https://warplet.10x.meme/api/warplet-favourites"),
      appSession({ walletAddress: null }),
      SESSION_WALLET,
    )).toBeNull();
  });
});
