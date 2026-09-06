import { afterEach, expect, it, vi } from "vitest";
import { allowedRenderAvatar, fetchRenderAvatar } from "./stonkletAbuse";
afterEach(() => vi.unstubAllGlobals());
it("rejects private addresses, credentials, ports, lookalike hosts and non-HTTPS URLs", () => {
  for (const url of ["http://imagedelivery.net/a", "https://127.0.0.1/a", "https://[::1]/a", "https://imagedelivery.net.evil.test/a", "https://user@imagedelivery.net/a", "https://imagedelivery.net:8080/a", "file:///etc/passwd"]) expect(allowedRenderAvatar(url)).toBe(false);
  expect(allowedRenderAvatar("https://imagedelivery.net/avatar")).toBe(true);
});
it("never fetches untrusted destinations", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await fetchRenderAvatar("https://internal.example/a")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
it("bounds streamed images even without content-length", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(512 * 1024 + 1), { headers: { "content-type": "image/png" } })));
  expect(await fetchRenderAvatar("https://imagedelivery.net/a")).toBeNull();
});
it("blocks SVG and disables redirects while accepting small raster images", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })).mockResolvedValueOnce(new Response(new Uint8Array([1,2]), { headers: { "content-type": "image/png" } }));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchRenderAvatar("https://imagedelivery.net/a")).toBeNull();
  expect(await fetchRenderAvatar("https://imagedelivery.net/b")).toEqual({ body: new Uint8Array([1,2]), contentType: "image/png" });
  expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }));
});

it("rejects redirect responses without following them", async () => {
 const fetch = vi.fn(async () => new Response(null, {status:302,headers:{location:"http://127.0.0.1/private"}}));
 vi.stubGlobal("fetch",fetch);
 expect(await fetchRenderAvatar("https://imagedelivery.net/avatar")).toBeNull();
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(fetch).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({redirect:"manual"}));
});
