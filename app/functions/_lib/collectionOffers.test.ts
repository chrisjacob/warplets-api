import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSeaportCriteriaRoot, computeSeaportOrderHash, openSeaPostHeaders, openSeaPostWithTransientRetry, withOriginalConsiderationCount } from "./collectionOffers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSeaportCriteriaRoot", () => {
  it("matches OpenSea's Token Level 10X criteria root", () => {
    expect(buildSeaportCriteriaRoot([5, 8, 20, 100, 158, 438, 891, 1351, 2539, 5178])).toBe(
      "28318632094992773987452582181483921138874647731135524244400965584800213343552",
    );
  });

  it("matches OpenSea's Volume Level 10X criteria root", () => {
    expect(buildSeaportCriteriaRoot([438, 779, 1180, 1688, 1917, 1962, 2009, 2539, 2900, 5620])).toBe(
      "31543439137372029629788762898279123583003892896341457774606321223654009495127",
    );
  });
});

describe("computeSeaportOrderHash", () => {
  it("matches the order hash returned by OpenSea for a submitted Holder offer", () => {
    expect(computeSeaportOrderHash({
      offerer: "0x4709a4b12daf0eedae0ef48a28a056640dee0846",
      zone: "0x000056f7000000ece9003ca63978907a00ffd100",
      offer: [{ itemType: 1, token: "0x4200000000000000000000000000000000000006", identifierOrCriteria: "0", startAmount: "100000000000000", endAmount: "100000000000000" }],
      consideration: [
        { itemType: 4, token: "0x780446dd12e080ae0db762fcd4daf313f3e359de", identifierOrCriteria: "49421166607748246915988052144035253257868050462626485102610654092815399320448", startAmount: "1", endAmount: "1", recipient: "0x4709a4b12daf0eedae0ef48a28a056640dee0846" },
        { itemType: 1, token: "0x4200000000000000000000000000000000000006", identifierOrCriteria: "0", startAmount: "1000000000000", endAmount: "1000000000000", recipient: "0x0000a26b00c1f0df003000390027140000faa719" },
        { itemType: 1, token: "0x4200000000000000000000000000000000000006", identifierOrCriteria: "0", startAmount: "10000000000000", endAmount: "10000000000000", recipient: "0x3d168abf83483ba7c050225ba736f52671e92299" },
      ],
      orderType: 2,
      startTime: "1786753179",
      endTime: "1802218779",
      zoneHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      salt: "5529487361764130486918694270579805024048185541512048528805334518355267294730",
      conduitKey: "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000",
      counter: "73218060338275530989026479141391850555",
    })).toBe("0x95b6de0c8f1cc347843c39b60b4f9b7592f4b80246e7052d946d1a70ef2141b1");
  });
});

describe("withOriginalConsiderationCount", () => {
  it("adds the consideration count required by OpenSea without changing the signed fields", () => {
    const parameters = {
      offerer: "0xofferer",
      consideration: [{ itemType: 4 }, { itemType: 1 }, { itemType: 1 }],
    };

    expect(withOriginalConsiderationCount(parameters)).toEqual({
      ...parameters,
      totalOriginalConsiderationItems: 3,
    });
    expect(parameters).not.toHaveProperty("totalOriginalConsiderationItems");
  });
});

describe("openSeaPostHeaders", () => {
  it("sends exactly one case-insensitive API key value", () => {
    const headers = new Headers(openSeaPostHeaders("test-key"));

    expect(headers.get("x-api-key")).toBe("test-key");
    expect([...headers.keys()].filter((name) => name === "x-api-key")).toHaveLength(1);
  });
});

describe("openSeaPostWithTransientRetry", () => {
  it("retries the same request after a transient OpenSea 500", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"errors":["Internal server error"]}', { status: 500 }))
      .mockResolvedValueOnce(Response.json({ order_hash: "0xorder" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openSeaPostWithTransientRetry("test-key", "/offers", { signed: true }, 2, 1))
      .resolves.toEqual({ order_hash: "0xorder" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: openSeaPostHeaders("test-key"),
      body: JSON.stringify({ signed: true }),
    });
  });
});
