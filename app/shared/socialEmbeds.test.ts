import { describe, it, expect } from "vitest";
import { mediaKind, socialMediaUrls } from "./socialEmbeds";

describe("Social attachment classification", () => {
  it("accepts tweet URLs and excludes lookalike domains and profile links", () => {
    expect(mediaKind("https://x.com/alice/status/12345?s=20")).toEqual({
      kind: "tweet",
      id: "12345",
    });
    expect(mediaKind("https://twitter.com/i/web/status/12345").kind).toBe(
      "tweet",
    );
    expect(mediaKind("https://x.com.evil.test/alice/status/12345").kind).toBe(
      "link",
    );
    expect(mediaKind("https://x.com/alice").kind).toBe("link");
  });
  it("embeds YouTube watch, short and share URLs but leaves channel links alone", () => {
    for (const url of [
      "https://youtu.be/abcdefghijk?t=10",
      "https://youtube.com/watch?v=abcdefghijk",
      "https://youtube.com/shorts/abcdefghijk",
    ])
      expect(mediaKind(url)).toEqual({ kind: "youtube", id: "abcdefghijk" });
    expect(mediaKind("https://youtube.com/channel/abc").kind).toBe("link");
  });
  it("recognizes short and full cast links without treating profiles as casts", () => {
    for (const url of [
      "https://farcaster.xyz/alice/0x12345678",
      "https://warpcast.com/~/conversations/0x" + "a".repeat(40),
      "https://social.10x.meme/post/local-id",
    ])
      expect(mediaKind(url).kind).toBe("cast");
    expect(mediaKind("https://farcaster.xyz/alice").kind).toBe("link");
  });
  it("handles signed media URLs and bounds/deduplicates embedded attachments", () => {
    expect(
      mediaKind("https://stream.farcaster.xyz/video.M3U8?token=abc").kind,
    ).toBe("video");
    const url = "https://x.com/alice/status/12345";
    expect(
      socialMediaUrls(`Look ${url}.`, [url, "javascript:alert(1)"]),
    ).toEqual([url]);
    expect(
      socialMediaUrls(
        "",
        Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.jpg`),
      ),
    ).toHaveLength(4);
  });
});
