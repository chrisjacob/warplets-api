import { describe, expect, it } from "vitest";
import {
  buildFarcasterReplyComposeUrl,
  buildHolderOutreachDeepLink,
  buildHolderOutreachMessage,
  normalizeOutreachTrackingCode,
  parseHolderOutreachFeedPage,
} from "./holderOutreach";

describe("holder outreach helpers", () => {
  it("keeps only allowed, valid Farcaster casts", () => {
    const result = parseHolderOutreachFeedPage({
      casts: [
        {
          hash: "0xabc",
          text: "hello",
          timestamp: "2026-08-30T00:00:00.000Z",
          parent_hash: null,
          author: {
            fid: 123,
            username: "holder",
            display_name: "Holder",
            pfp_url: "https://example.com/pfp.png",
            verified_accounts: [{ platform: "x", username: "holder_x" }],
          },
        },
        { hash: "0xdef", timestamp: "2026-08-30T00:00:00.000Z", author: { fid: 456, username: "other" } },
      ],
      next: { cursor: "next-page" },
    }, new Set([123]));

    expect(result).toEqual({
      casts: [{
        fid: 123,
        hash: "0xabc",
        username: "holder",
        displayName: "Holder",
        pfpUrl: "https://example.com/pfp.png",
        xUsername: "holder_x",
        text: "hello",
        timestamp: "2026-08-30T00:00:00.000Z",
        parentHash: null,
      }],
      nextCursor: "next-page",
    });
  });

  it("builds a tracked Warplet deep link and reply composer", () => {
    const deepLink = buildHolderOutreachDeepLink("https://warplet.10x.meme", 9339, "a".repeat(32));
    const message = buildHolderOutreachMessage("warplet-live", 9339, deepLink);
    const composeUrl = new URL(buildFarcasterReplyComposeUrl(message.text, deepLink, "0xabc"));

    expect(deepLink).toContain("search=9339");
    expect(deepLink).toContain("warplet=9339");
    expect(message.text).toContain("Warplet #9339");
    expect(composeUrl.searchParams.get("parentCastHash")).toBe("0xabc");
    expect(composeUrl.searchParams.getAll("embeds[]")).toEqual([deepLink]);
  });

  it("accepts only opaque 32-character tracking codes", () => {
    expect(normalizeOutreachTrackingCode("A".repeat(32))).toBe("a".repeat(32));
    expect(normalizeOutreachTrackingCode("short")).toBeNull();
  });
});
