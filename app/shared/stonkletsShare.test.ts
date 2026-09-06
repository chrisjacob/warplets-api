import { describe, expect, it } from "vitest";
import { STONKLETS_CATALOG } from "./stonkletsCatalog";
import { stonkletFromSharePath, stonkletShare } from "./stonkletsShare";

describe("Stonklet sharing", () => {
  it("resolves every token symbol to exactly its paired Stonklet", () => {
    const paths = STONKLETS_CATALOG.map((entry) => new URL(stonkletShare(entry, "stonklet.10x.meme").url).pathname);
    expect(new Set(paths).size).toBe(STONKLETS_CATALOG.length);
    STONKLETS_CATALOG.forEach((entry, index) => expect(stonkletFromSharePath(paths[index]!)).toBe(entry));
    expect(stonkletFromSharePath("/%bad")).toBeUndefined();
    expect(stonkletFromSharePath("/not-a-token")).toBeUndefined();
  });
  it("uses Stonklet-specific post, original artwork, and safe referral destination", () => {
    const bull = STONKLETS_CATALOG.find((entry) => entry.id === "direxion-soxl")!;
    const share = stonkletShare(bull, "stonklet-local.10x.meme", "1h");
    expect(share.title).toContain("BULL 牛 ( $BULL10X )");
    expect(share.description).toContain(bull.stock.name);
    expect(share.url).toBe("https://stonklet-local.10x.meme/bull10x?change=1h");
    expect(share.text).toContain("0x21d68a77b309a0835a2ee52378d2fd2e12e97777?r=10XMemeX");
    expect(share.image).toContain("range=1h");
    expect(share.ogImage).toBe(`${share.image}&variant=og`);
    expect(decodeURI(share.artwork)).toContain("Bull.webp");
  });
  it("asks for votes and omits trading links for an unlaunched Stonklet", () => {
    const entry = STONKLETS_CATALOG.find((item) => item.stonklet.symbol === "ARROW")!;
    const share = stonkletShare(entry, "stonklet-local.10x.meme");
    expect(share.text).toBe("✅ Vote for Stonklet: Arrow ( $ARROW ).\n\nMemecoin paired with Stock: Robinhood ( $HOODB ).\n\nhttps://stonklet-local.10x.meme/arrow");
    expect(share.text).not.toContain("fomo.family");
  });
});

it.each(["BULL10X", "BEAR10X"])("keeps the page URL first in %s share text", (symbol) => {
 const entry = STONKLETS_CATALOG.find(item => item.stonklet.symbol === symbol)!;
 const share = stonkletShare(entry, "stonklet.10x.meme");
 expect(share.title.toLowerCase()).not.toContain("10x.meme");
 expect(entry.stonklet.name).toContain("10X.MEME");
 expect(share.text.match(/https?:\/\/\S+/)?.[0]).toBe(share.url);
});
