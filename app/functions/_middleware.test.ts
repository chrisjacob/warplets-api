import { expect, it, vi } from "vitest";
import { onRequest } from "./_middleware";

async function request(path: string, flag?: string, method = "GET", host = "app.10x.meme") {
  const next = vi.fn(async () => new Response("existing handler"));
  const context = { request: new Request(`https://${host}${path}`, { method }), env: { TENX_APP_ENABLED: flag }, next };
  const response = await onRequest(context as unknown as Parameters<typeof onRequest>[0]);
  return { response, next };
}

it("redirects hidden page navigation home without forwarding or retaining query overrides", async () => {
  for (const path of ["/history?enabled=true", "/history/deeper", "/discover?enabled=true", "/wallets?returnTo=https://example.com", "/token/solana/mint", "/research/future", "/admin/10x", "/elections/saved", "/%64iscover"]) {
    for (const method of ["GET", "HEAD"]) {
      const { response, next } = await request(path, undefined, method);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://app.10x.meme/");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(next).not.toHaveBeenCalled();
    }
  }
});

it("rejects all gated API methods and page mutations before downstream IO on every shared host", async () => {
  for (const host of ["app.10x.meme", "10x.meme", "10x-app.pages.dev", "warplet.10x.meme", "stonklet.10x.meme"]) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
      const { response, next } = await request("/api/10x/admin/test?enabled=true", "false", method, host);
      expect(response.status).toBe(404);
      expect(response.headers.has("location")).toBe(false);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(next).not.toHaveBeenCalled();
    }
  }
  const { response, next } = await request("/submit", "false", "POST");
  expect(response.status).toBe(404); expect(next).not.toHaveBeenCalled();
});

it("permits deliberate opt-in and leaves established surfaces working with the gate closed", async () => {
  for (const path of ["/discover", "/api/10x/discovery"]) {
    const { response, next } = await request(path, "true");
    expect(response.status).toBe(200); expect(next).toHaveBeenCalledOnce();
  }
  for (const path of ["/", "/thesis", "/menu", "/privacy", "/terms", "/stop", "/unsubscribe", "/warplets", "/stonklets", "/api/email/subscribe", "/api/auth/session", "/api/notifications/open", "/assets/index.js"]) {
    const { response, next } = await request(path, "false");
    expect(await response.text()).toBe("existing handler"); expect(next).toHaveBeenCalledOnce();
  }
  const retired = await request("/social", "true");
  expect(retired.response.status).toBe(404); expect(retired.next).not.toHaveBeenCalled();
});
