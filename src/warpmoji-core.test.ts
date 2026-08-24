import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWarpmojiUrl,
  evaluateWarpmojiCaps,
  isExactEmojiAlias,
  stripMentionByRanges,
} from "./warpmoji-core";

test("recognizes exact multi-codepoint aliases and rejects extra text", () => {
  const aliases = new Set(["🤓", "👨‍👩‍👧‍👦", "👍🏽", "🇦🇺", "1️⃣"]);
  for (const emoji of aliases) assert.equal(isExactEmojiAlias(emoji, aliases), true);
  assert.equal(isExactEmojiAlias("🤓🤓", aliases), false);
  assert.equal(isExactEmojiAlias("hello 🤓", aliases), false);
});

test("keeps organic and mention caps separate and enforces the 900 hard ceiling", () => {
  const base = { organicUser: 1, organicDaily: 200, mentionUser: 10, mentionDaily: 300, combinedDaily: 5_000 };
  assert.equal(evaluateWarpmojiCaps({ ...base, classification: "organic", userCount: 1, categoryCount: 1, combinedCount: 1 }), "organic_user_cap");
  assert.equal(evaluateWarpmojiCaps({ ...base, classification: "mention", userCount: 1, categoryCount: 1, combinedCount: 1 }), null);
  assert.equal(evaluateWarpmojiCaps({ ...base, classification: "mention", userCount: 1, categoryCount: 1, combinedCount: 900 }), "combined_daily_cap");
});

test("removes Farcaster mentions by codepoint ranges", () => {
  assert.equal(stripMentionByRanges("@warpmoji.eth 🤓", [0], [14]), "🤓");
  assert.equal(stripMentionByRanges("🤓 @warpmoji.eth", [2], [14]), "🤓");
});

test("builds the documented attribution URL", () => {
  const url = new URL(buildWarpmojiUrl({ tokenId: 123, emoji: "🤓", channel: "farcaster", trigger: "mention" }));
  assert.equal(url.searchParams.get("emoji"), "🤓");
  assert.equal(url.searchParams.get("utm_source"), "farcaster");
  assert.equal(url.searchParams.get("utm_medium"), "social");
  assert.equal(url.searchParams.get("utm_campaign"), "warpmoji");
  assert.equal(url.searchParams.get("utm_content"), "mention");
});
