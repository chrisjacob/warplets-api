import { describe, expect, it } from "vitest";
import { STONKLETS_BY_ID, STONKLETS_CATALOG } from "./stonkletsCatalog";
import { stonkletTradeUrl } from "./stonkletsTrading";
import { VERIFIED_STOCK_CONTRACTS } from "./stonkletsStockContracts";

describe("FOMO trade destinations", () => {
  it.each([
    ["direxion-soxl", "stonklet", "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777"],
    ["direxion-soxs", "stonklet", "0x90f62f81307ebf4ccd0a0510e3391c67b1d17777"],
    ["direxion-soxl", "stock", "0xd97d097a89113fa59b76c572e5b2eb647e8eefaf"],
    ["direxion-soxs", "stock", "0xe28cd11c99af2df76bb8ada4cd0ef3904378280f"],
    ["invesco-qqq", "stock", "0x205812cdbed920aff76c6580abd681a46d11efc7"],
    ["tether-gold", "stock", "0x21caef8a43163eea865baee23b9c2e327696a3bf"],
  ] as const)("routes %s %s to the exact BNB contract with referral", (id, asset, address) => {
    expect(stonkletTradeUrl(STONKLETS_BY_ID.get(id)!, asset)).toBe(`https://fomo.family/tokens/bnb/${address}?r=10XMemeX`);
  });
  it("does not trade unlaunched Stonklets, even when demo data exists", () => {
    expect(stonkletTradeUrl(STONKLETS_BY_ID.get("spacex")!, "stonklet")).toBeNull();
  });
  it("ignores unverified provider contracts and fails closed for unknown stock symbols", () => {
    const entry = STONKLETS_BY_ID.get("invesco-qqq")!;
    const poisoned = { ...entry, stock: { ...entry.stock, contractAddress: `0x${"f".repeat(40)}` } };
    expect(stonkletTradeUrl(poisoned, "stock")).toBe(stonkletTradeUrl(entry, "stock"));
    expect(stonkletTradeUrl({ ...poisoned, stock: { ...poisoned.stock, symbol: "UNKNOWN" } }, "stock")).toBeNull();
  });
  it("covers every catalog stock with a distinct reviewed BNB contract and source", () => {
    const addresses = STONKLETS_CATALOG.map(entry => VERIFIED_STOCK_CONTRACTS[entry.stock.symbol]);
    expect(addresses).toHaveLength(44);
    expect(new Set(addresses.map(record => record.address)).size).toBe(44);
    expect(addresses.every(record => /^0x[0-9a-f]{40}$/.test(record.address) && record.source.startsWith("https://"))).toBe(true);
  });
});
