import { describe, expect, it } from "vitest";
import { STONKLETS_BY_ID, STONKLETS_CATALOG } from "./stonkletsCatalog";
import { stonkletTradeUrl } from "./stonkletsTrading";
import { VERIFIED_STOCK_CONTRACTS } from "./stonkletsStockContracts";

describe("Trade destinations", () => {
  it.each([
    ["direxion-soxl", "stonklet", "0x21d68a77b309a0835a2ee52378d2fd2e12e97777"],
    ["direxion-soxs", "stonklet", "0x10cdfce1effe43e912dace17fe925cf87e987777"],
    ["direxion-soxl", "stock", "0xd97d097a89113fa59b76c572e5b2eb647e8eefaf"],
    ["direxion-soxs", "stock", "0xe28cd11c99af2df76bb8ada4cd0ef3904378280f"],
    ["invesco-qqq", "stock", "0x205812cdbed920aff76c6580abd681a46d11efc7"],
    ["tether-gold", "stock", "0x21caef8a43163eea865baee23b9c2e327696a3bf"],
  ] as const)("routes %s %s to the correct venue and exact BNB contract", (id, asset, address) => {
    expect(stonkletTradeUrl(STONKLETS_BY_ID.get(id)!, asset)).toBe(asset === "stonklet" ? `https://flap.sh/bnb/${address}?lang=en` : `https://fomo.family/tokens/bnb/${address}?r=10XMemeX`);
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
