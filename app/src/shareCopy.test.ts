import { describe, expect, it } from "vitest";
import { buildSharePostText, buildTwitterShareText } from "./shareCopy";

const APP_LINK = "https://warplet.10x.meme/stats/market/1y/volume";
const OPENSEA_LINK = "https://opensea.io/collection/10xwarplets";

function count(text: string, value: string): number {
  return text.split(value).length - 1;
}

describe("share post copy", () => {
  it("does not append a deep link already present in the body", () => {
    const post = buildSharePostText(`10X Warplets — Volume (1 Year)\n\n${APP_LINK}`, [APP_LINK]);

    expect(count(post, APP_LINK)).toBe(1);
  });

  it("deduplicates repeated link entries while preserving distinct links", () => {
    const post = buildSharePostText("Check out this Warplet", [APP_LINK, APP_LINK, OPENSEA_LINK]);

    expect(count(post, APP_LINK)).toBe(1);
    expect(count(post, OPENSEA_LINK)).toBe(1);
  });

  it("deduplicates links before adding the Twitter footer", () => {
    const post = buildTwitterShareText(`10X Warplets\n\n${APP_LINK}`, [APP_LINK]);

    expect(count(post, APP_LINK)).toBe(1);
    expect(post).toMatch(/#10XWarplets via @10XMemeX$/);
  });
});
