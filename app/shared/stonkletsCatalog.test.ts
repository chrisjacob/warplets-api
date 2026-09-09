import { describe, expect, it } from "vitest";
import { STONKLETS_CATALOG } from "./stonkletsCatalog";

describe("Stonklets catalog", () => {
  it("contains 44 unique pairs, with 20 active and 24 upcoming", () => {
    expect(STONKLETS_CATALOG).toHaveLength(44);
    expect(STONKLETS_CATALOG.filter((entry) => entry.pairingStatus === "available")).toHaveLength(20);
    expect(STONKLETS_CATALOG.filter((entry) => entry.pairingStatus === "upcoming")).toHaveLength(24);
    expect(new Set(STONKLETS_CATALOG.map((entry) => entry.id)).size).toBe(44);
    expect(new Set(STONKLETS_CATALOG.map((entry) => entry.stonklet.symbol)).size).toBe(44);
  });

  it.each(["SOXSB", "SOXLB", "MRNAB", "FLNCB"])("shows live stock %s in the active collection", (symbol) => {
    const entry = STONKLETS_CATALOG.find((candidate) => candidate.stock.symbol === symbol);
    expect(entry?.pairingStatus).toBe("available");
    expect(entry?.stonklet.image).not.toContain("undefined");
  });

  it.each(["AMATB", "PYPLB", "SQQQB"])("keeps exactly one %s entry in Upcoming Tokens", (symbol) => {
    const entries = STONKLETS_CATALOG.filter((entry) => entry.stock.symbol === symbol);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pairingStatus).toBe("upcoming");
    expect(entries[0]?.stonklet.image).not.toContain("undefined");
  });

  it("keeps prelaunch addresses nullable until official contracts are configured", () => {
    expect(STONKLETS_CATALOG.filter(entry => entry.launchStatus !== "launched").every((entry) => entry.stonklet.contractAddress === null)).toBe(true);
    expect(STONKLETS_CATALOG.filter((entry) => entry.launchStatus === "launched")).toHaveLength(20);
  });

  it("uses the supplied character images", () => {
    const images = Object.fromEntries(STONKLETS_CATALOG.map((entry) => [entry.stonklet.symbol, entry.stonklet.image]));
    expect(images.ORBIT10X).toBe("/stonklets/stonklets/SpaceX-Orbit.webp");
    expect(images.CHIP10X).toBe("/stonklets/stonklets/NVIDIA-Chip.webp");
    expect(images.CORE10X).toBe("/stonklets/stonklets/Apple-Core.webp");
    expect(images.VOLT10X).toBe("/stonklets/stonklets/Tesla-Volt.webp");
  });

  it("serves every stock image from a unique local image path", () => {
    const logos = STONKLETS_CATALOG.map((entry) => entry.stock.logo);
    expect(new Set(logos).size).toBe(44);
    expect(logos.every((logo) => /^\/stonklets\/stocks\/[a-z0-9-]+\.(png|svg)$/.test(logo))).toBe(true);
  });

  it("uses each launched contract for market data and trading, with no demo proxies", () => {
    for (const entry of STONKLETS_CATALOG) {
      if (entry.launchStatus === "launched") {
        expect(entry.stonklet.contractAddress).toMatch(/^0x[0-9a-f]{40}$/);
        expect(entry.demoToken).toMatchObject({ name: entry.stonklet.name, symbol: entry.stonklet.symbol, contractAddress: entry.stonklet.contractAddress });
        expect(entry.flapUrl).toBe(`https://flap.sh/bnb/${entry.stonklet.contractAddress}?lang=en`);
      } else {
        expect(entry.demoToken).toBeNull();
      }
    }
  });
});

it.each([
  ["BULL10X", "0x21d68a77b309a0835a2ee52378d2fd2e12e97777", "SOXLB"],
  ["BEAR10X", "0x10cdfce1effe43e912dace17fe925cf87e987777", "SOXSB"],
])("uses the launched %s contract for both market data and identity", (symbol, address, quote) => {
  const entry = STONKLETS_CATALOG.find(entry => entry.stonklet.symbol === symbol)!;
  expect(entry.stonklet.contractAddress).toBe(address);
  expect(entry.demoToken).toMatchObject({ symbol, contractAddress: address, quoteSymbol: quote, chartTokenSide: null });
  expect(entry.flapUrl).toBe(`https://flap.sh/bnb/${address}?lang=en`);
});
