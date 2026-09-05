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
    expect(STONKLETS_CATALOG.every((entry) => entry.stonklet.contractAddress === null)).toBe(true);
    expect(STONKLETS_CATALOG.filter((entry) => entry.launchStatus === "launched").map((entry) => entry.stonklet.symbol).sort()).toEqual(["BEAR", "BULL"]);
  });

  it("uses the supplied character images", () => {
    const images = Object.fromEntries(STONKLETS_CATALOG.map((entry) => [entry.stonklet.symbol, entry.stonklet.image]));
    expect(images.ORBIT).toBe("/stonklets/stonklets/SpaceX-Orbit.webp");
    expect(images.CHIP).toBe("/stonklets/stonklets/NVIDIA-Chip.webp");
    expect(images.CORE).toBe("/stonklets/stonklets/Apple-Core.webp");
    expect(images.VOLT).toBe("/stonklets/stonklets/Tesla-Volt.webp");
  });

  it("serves every stock image from a unique local image path", () => {
    const logos = STONKLETS_CATALOG.map((entry) => entry.stock.logo);
    expect(new Set(logos).size).toBe(44);
    expect(logos.every((logo) => /^\/stonklets\/stocks\/[a-z0-9-]+\.(png|svg)$/.test(logo))).toBe(true);
  });

  it("keeps the original four demo proxies separate from official Stonklet contracts", () => {
    const mapped = STONKLETS_CATALOG.filter((entry) => entry.demoToken && entry.launchStatus !== "launched");
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
