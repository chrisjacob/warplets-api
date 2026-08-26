import { describe, expect, it } from "vitest";
import { appendBuilderCode, builderCodeSuffix, resolveBuilderCodeForHostname } from "./builderCode";

describe("Base Builder Code attribution", () => {
  it("keeps app and Warplets Builder Codes scoped to their own hostnames", () => {
    expect(resolveBuilderCodeForHostname("app.10x.meme", "app-code", "warplets-code")).toBe("app-code");
    expect(resolveBuilderCodeForHostname("10x.meme", "app-code", "warplets-code")).toBe("app-code");
    expect(resolveBuilderCodeForHostname("warplet.10x.meme", "app-code", "warplets-code")).toBe("warplets-code");
  });

  it("creates and appends an ERC-8021 suffix", () => {
    const suffix = builderCodeSuffix("10x-warplets");
    expect(suffix).toMatch(/^0x[0-9a-f]+$/);
    expect(appendBuilderCode("0x1234", "10x-warplets")).toBe(`0x1234${suffix?.slice(2)}`);
  });

  it("does not duplicate an existing suffix", () => {
    const once = appendBuilderCode("0xabcdef", "10x-warplets");
    expect(appendBuilderCode(once, "10x-warplets")).toBe(once);
  });

  it("leaves calldata unchanged when no code is configured", () => {
    expect(appendBuilderCode("0x1234", "")).toBe("0x1234");
  });
});
