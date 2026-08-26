import { describe, expect, it } from "vitest";
import { getActivityDedupeIdentity } from "./stats";

describe("Stats activity deduplication", () => {
  it("collapses OpenSea and app-ingest copies of the same offer order", () => {
    const shared = {
      eventType: "offer",
      tokenId: 4110,
      orderHash: "0xABC",
    };

    expect(getActivityDedupeIdentity({ ...shared, canonicalKey: "opensea:offer:event-id" }))
      .toBe(getActivityDedupeIdentity({ ...shared, canonicalKey: "activity:warplets:offered:4110:0xabc" }));
  });

  it("collapses Dune and OpenSea copies of the same token transfer", () => {
    const shared = {
      eventType: "transfer",
      tokenId: 9874,
      transactionHash: "0xDEF",
    };

    expect(getActivityDedupeIdentity({ ...shared, canonicalKey: "transfer:8453:0xdef:155:9874" }))
      .toBe(getActivityDedupeIdentity({ ...shared, canonicalKey: "opensea:transfer:event-id" }));
  });

  it("keeps distinct orders and token transfers separate", () => {
    expect(getActivityDedupeIdentity({
      eventType: "offer",
      tokenId: 4110,
      orderHash: "0xaaa",
      canonicalKey: "offer-a",
    })).not.toBe(getActivityDedupeIdentity({
      eventType: "offer",
      tokenId: 4110,
      orderHash: "0xbbb",
      canonicalKey: "offer-b",
    }));

    expect(getActivityDedupeIdentity({
      eventType: "transfer",
      tokenId: 9874,
      transactionHash: "0xccc",
      canonicalKey: "send-a",
    })).not.toBe(getActivityDedupeIdentity({
      eventType: "transfer",
      tokenId: 5230,
      transactionHash: "0xccc",
      canonicalKey: "send-b",
    }));
  });
});
