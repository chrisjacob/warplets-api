import { describe, expect, it } from "vitest";
import { resolveEntryPoint } from "./pwa";

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
