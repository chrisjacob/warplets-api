import { describe, expect, it } from "vitest";
import { getAuthRequestUrl, isUsableStoredNonce } from "./authValidation";

describe("authentication nonce replay protection", () => {
  it("accepts only an unconsumed, unexpired nonce", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isUsableStoredNonce({ consumed_at: null, expires_at: future })).toBe(true);
    expect(isUsableStoredNonce({ consumed_at: new Date().toISOString(), expires_at: future })).toBe(false);
    expect(isUsableStoredNonce({ consumed_at: null, expires_at: new Date(Date.now() - 1).toISOString() })).toBe(false);
  });
});

describe("getAuthRequestUrl", () => {
  it("uses HTTPS for a canonical Warplets host behind the local tunnel", () => {
    const request = new Request("http://warplet-local.10x.meme/api/auth/wallet/challenge", {
      headers: {},
    });
    expect(getAuthRequestUrl(request).origin).toBe("https://warplet-local.10x.meme");
  });

  it("rejects a forwarded origin for a different host", () => {
    const request = new Request("http://localhost:8790/api/auth/wallet/challenge", {
      headers: { "x-10x-public-origin": "https://attacker.example" },
    });
    expect(getAuthRequestUrl(request).origin).toBe("http://localhost:8790");
  });

  it("does not replace a production HTTPS request URL", () => {
    const request = new Request("https://warplet.10x.meme/api/auth/wallet/challenge", {
      headers: { "x-10x-public-origin": "https://warplet-local.10x.meme" },
    });
    expect(getAuthRequestUrl(request).origin).toBe("https://warplet.10x.meme");
  });
});
