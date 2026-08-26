import { describe, expect, it } from "vitest";
import { applicationServerKeysMatch, isEmbeddedWebViewUserAgent, resolveEntryPoint } from "./pwa";

describe("resolveEntryPoint", () => {
  it("keeps source parameters attribution-only and deterministic", () => {
    expect(resolveEntryPoint({ search: "?source=10x-tabs" })).toBe("10x-tabs");
    expect(resolveEntryPoint({ search: "?source=x" })).toBe("x-webview");
    expect(resolveEntryPoint({ search: "?source=telegram" })).toBe("telegram");
  });

  it("recognizes installed display mode without inventing a trusted runtime", () => {
    expect(resolveEntryPoint({ search: "" }, { standalone: true })).toBe("pwa");
    expect(resolveEntryPoint({ search: "" }, { standalone: false })).toBe("browser");
  });

  it("uses X referrer and UA only for presentation analytics", () => {
    expect(resolveEntryPoint({ search: "" }, { referrer: "https://t.co/example" })).toBe("x-webview");
    expect(resolveEntryPoint({ search: "" }, { userAgent: "Twitter for iPhone" })).toBe("x-webview");
  });
});

describe("isEmbeddedWebViewUserAgent", () => {
  it("recognizes Farcaster hosts as embedded browsers", () => {
    expect(isEmbeddedWebViewUserAgent("Farcaster/1.0 iOS WebView")).toBe(true);
    expect(isEmbeddedWebViewUserAgent("Warpcast/2026.8 Mobile")).toBe(true);
  });

  it("treats Base App as embedded so PWA prompts stay disabled", () => {
    expect(isEmbeddedWebViewUserAgent("BaseApp/1.0 iPhone CoinbaseWallet")).toBe(true);
  });

  it("does not classify standalone Safari as embedded", () => {
    expect(isEmbeddedWebViewUserAgent("Mozilla/5.0 Mobile Safari/604.1")).toBe(false);
  });
});

describe("Web Push VAPID rotation", () => {
  it("keeps subscriptions created with the active application server key", () => {
    expect(applicationServerKeysMatch(new Uint8Array([1, 2, 3]).buffer, new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it("replaces subscriptions created with an older application server key", () => {
    expect(applicationServerKeysMatch(new Uint8Array([1, 2, 3]).buffer, new Uint8Array([4, 5, 6]))).toBe(false);
    expect(applicationServerKeysMatch(null, new Uint8Array([4, 5, 6]))).toBe(false);
  });
});
