import { describe, expect, it } from "vitest";
import { buildWarpmojiRegexShards } from "../shared/warpmojiRegex";

describe("Warpmoji regex shards", () => {
  it("matches all supplied Unicode aliases and rejects unsupported/text payloads", () => {
    const aliases = ["😀", "😁", "😂", "🤓", "👍🏽", "🇦🇺", "1️⃣", "👨‍👩‍👧‍👦"];
    const expressions = buildWarpmojiRegexShards(aliases, 3).map((pattern) => new RegExp(pattern, "u"));
    for (const alias of aliases) expect(expressions.some((expression) => expression.test(alias))).toBe(true);
    for (const invalid of ["hello", "🤓🤓", "hello 🤓", "!"]) expect(expressions.some((expression) => expression.test(invalid))).toBe(false);
  });

  it("never places more than 75 aliases in one shard", () => {
    const aliases = Array.from({ length: 151 }, (_, index) => String.fromCodePoint(0x1f600 + index));
    expect(buildWarpmojiRegexShards(aliases)).toHaveLength(3);
  });
});

