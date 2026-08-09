import { describe, expect, it } from "vitest";
import { sessionCookie } from "./appAuth";

describe("sessionCookie", () => {
  const expiresAt = "2026-09-08T00:00:00.000Z";

  it("uses an embedded-compatible secure cookie for a matching forwarded HTTPS origin", () => {
    const request = new Request("http://warplet-local.10x.meme/api/auth/session", {
      headers: { "x-10x-public-origin": "https://warplet-local.10x.meme" },
    });
    const cookie = sessionCookie(request, "token", expiresAt);
    expect(cookie).toContain("__Host-warplets_session=token");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
  });

  it("does not trust a forwarded origin for a different host", () => {
    const request = new Request("http://127.0.0.1:8790/api/auth/session", {
      headers: { "x-10x-public-origin": "https://warplet-local.10x.meme" },
    });
    const cookie = sessionCookie(request, "token", expiresAt);
    expect(cookie).toContain("warplets_session=token");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("; Secure");
  });
});
