import { describe, expect, it } from "vitest";
import { STONKLETS_CATALOG } from "./stonkletsCatalog";

describe("Stonklets catalog", () => {
  it("contains the authoritative 40 unique pairs", () => {
    expect(STONKLETS_CATALOG).toHaveLength(40);
    expect(STONKLETS_CATALOG.filter((entry) => entry.pairingStatus === "available")).toHaveLength(16);
    expect(STONKLETS_CATALOG.filter((entry) => entry.pairingStatus === "upcoming")).toHaveLength(24);
    expect(new Set(STONKLETS_CATALOG.map((entry) => entry.id)).size).toBe(40);
    expect(new Set(STONKLETS_CATALOG.map((entry) => entry.stonklet.symbol)).size).toBe(40);
  });

  it("keeps prelaunch addresses nullable until official contracts are configured", () => {
    expect(STONKLETS_CATALOG.every((entry) => entry.stonklet.contractAddress === null)).toBe(true);
    expect(STONKLETS_CATALOG.every((entry) => entry.launchStatus === "prelaunch")).toBe(true);
  });

  it("retains the four supplied provisional character assignments", () => {
    const images = Object.fromEntries(STONKLETS_CATALOG.map((entry) => [entry.stonklet.symbol, entry.stonklet.image]));
    expect(images.ORBIT).toBe("/stonklets/orbit.png");
    expect(images.CHIP).toBe("/stonklets/chip.png");
    expect(images.CORE).toBe("/stonklets/core.png");
    expect(images.VOLT).toBe("/stonklets/volt.png");
  });

  it("serves every stock image from a unique local PNG path", () => {
    const logos = STONKLETS_CATALOG.map((entry) => entry.stock.logo);
    expect(new Set(logos).size).toBe(40);
    expect(logos.every((logo) => /^\/stonklets\/stocks\/[a-z0-9-]+\.png$/.test(logo))).toBe(true);
  });

  it("keeps four real Flap demo proxies separate from official Stonklet contracts", () => {
    const mapped = STONKLETS_CATALOG.filter((entry) => entry.demoToken);
    expect(mapped).toHaveLength(4);
    expect(new Set(mapped.map((entry) => entry.demoToken?.contractAddress.toLowerCase())).size).toBe(4);
    expect(mapped.filter((entry) => entry.demoToken?.expectedLifecycle === "migrated")).toHaveLength(2);
    expect(mapped.filter((entry) => entry.demoToken?.expectedLifecycle === "bonding")).toHaveLength(2);
    expect(Object.fromEntries(mapped.map((entry) => [entry.stonklet.symbol, entry.demoToken?.name]))).toEqual({
      ORBIT: "MarsCoin",
      CHIP: "RWA",
      CORE: "Bear On Moon",
      VOLT: "FLAPGOTCHI",
    });
    expect(mapped.every((entry) => entry.stonklet.contractAddress === null)).toBe(true);
  });
});
