import { afterEach, describe, expect, it, vi } from "vitest";
import { linkCurrentWalletAndIdentity } from "./appSession";

const WALLET = "0x436cd187fbe2102e3e2f842574301e951489c281";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wallet and social linking", () => {
  it("links immediately for the manual Connect-modal action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ linked: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(linkCurrentWalletAndIdentity(WALLET)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/link", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ confirm: true, automatic: false }),
    }));
  });

  it("labels the default post-authentication link as automatic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ linked: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(linkCurrentWalletAndIdentity(WALLET, { automatic: true })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/link", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ confirm: true, automatic: true }),
    }));
  });
});

