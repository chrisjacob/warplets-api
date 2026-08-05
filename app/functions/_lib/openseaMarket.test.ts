import { describe, expect, it } from "vitest";
import { getTokenIdFromOpenSeaRow } from "./openseaMarket";

describe("OpenSea token attribution", () => {
  it("prefers the NFT identifier over an unrelated root identifier", () => {
    expect(
      getTokenIdFromOpenSeaRow({
        identifier: "1358",
        nft: { identifier: "1589" },
      }),
    ).toBe(1589);
  });

  it("uses the root identifier when no structured NFT identifier exists", () => {
    expect(getTokenIdFromOpenSeaRow({ identifier: "1358" })).toBe(1358);
  });
});
