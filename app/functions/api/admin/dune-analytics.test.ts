import { describe, expect, it } from "vitest";
import { parseDuneQueryId } from "./dune-analytics";

describe("parseDuneQueryId", () => {
  it("allows an omitted selector", () => {
    expect(parseDuneQueryId(null)).toBeNull();
    expect(parseDuneQueryId("  ")).toBeNull();
  });

  it("parses a positive safe integer", () => {
    expect(parseDuneQueryId("8102887")).toBe(8102887);
  });

  it.each(["0", "-1", "1.5", "abc", "9007199254740992"])(
    "rejects invalid selector %s",
    (value) => {
      expect(() => parseDuneQueryId(value)).toThrow("queryId must be a positive integer.");
    },
  );
});
