import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sdk from "@farcaster/miniapp-sdk";
import { loadAppSession, verifyFarcasterQuickAuth } from "./appSession";
import { authenticateStonkletsFarcaster } from "./stonkletsFarcasterAuth";

vi.mock("@farcaster/miniapp-sdk", () => ({ default: { quickAuth: { getToken: vi.fn() } } }));
vi.mock("./appSession", () => ({ loadAppSession: vi.fn(), verifyFarcasterQuickAuth: vi.fn() }));

describe("Stonklets Farcaster favourite authentication", () => {
  beforeEach(() => {
    vi.mocked(sdk.quickAuth.getToken).mockResolvedValue({ token: "verified-proof" });
    vi.mocked(verifyFarcasterQuickAuth).mockResolvedValue({ farcasterFid: 123 });
    vi.mocked(loadAppSession).mockResolvedValue({ authenticated: true, farcasterFid: 123, walletAddress: null, farcasterProfile: null, identitiesLinked: false, expiresAt: null, actionSessionToken: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  });
  afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

  it("shares startup and vote verification, syncing identity before loading the session without a connected wallet", async () => {
    const startup = authenticateStonkletsFarcaster();
    const vote = authenticateStonkletsFarcaster();
    expect(vote).toBe(startup);
    expect(await vote).toMatchObject({ authenticated: true, farcasterFid: 123, walletAddress: null });
    expect(sdk.quickAuth.getToken).toHaveBeenCalledTimes(1);
    expect(verifyFarcasterQuickAuth).toHaveBeenCalledWith("verified-proof");
    expect(fetch).toHaveBeenCalledWith("/api/warplet-status", expect.objectContaining({ credentials: "same-origin", body: JSON.stringify({ fid: 123, appSlug: "warplets" }) }));
    expect(vi.mocked(fetch).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(loadAppSession).mock.invocationCallOrder[0]);
  });

  it("allows retry after failed background verification", async () => {
    vi.mocked(verifyFarcasterQuickAuth).mockRejectedValueOnce(new Error("Temporary failure"));
    await expect(authenticateStonkletsFarcaster()).rejects.toThrow("Temporary failure");
    expect(fetch).not.toHaveBeenCalled();
    await expect(authenticateStonkletsFarcaster()).resolves.toMatchObject({ farcasterFid: 123 });
  });

  it("rejects a missing or mismatched verified session", async () => {
    vi.mocked(loadAppSession).mockResolvedValueOnce({ authenticated: false, farcasterFid: null, walletAddress: null, farcasterProfile: null, identitiesLinked: false, expiresAt: null, actionSessionToken: null });
    await expect(authenticateStonkletsFarcaster()).rejects.toThrow("Couldn't restore");
  });
});
