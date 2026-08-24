import { describe, expect, it } from "vitest";
import { appendBuilderCode, builderCodeSuffix } from "./builderCode";

describe("Base Builder Code attribution", () => {
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
