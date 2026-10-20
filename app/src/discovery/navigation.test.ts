import { expect, it } from "vitest";
import { discoveryDestination, isDiscoveryPath } from "./navigation";
const current = "https://app-local.10x.meme/discover", normal = { button: 0 };
it("keeps navigation inside the local discovery router with exact queries", () => {
  expect(discoveryDestination("/backing", current, normal)?.pathname).toBe("/backing");
  expect(discoveryDestination("/token/solana/mint?mode=fixture", current, normal)?.search).toBe("?mode=fixture");
  expect(isDiscoveryPath("/rewards/")).toBe(true);
  expect(isDiscoveryPath("/launch-lab/")).toBe(true);
  expect(discoveryDestination("/submit?campaign=00000000-0000-4000-8000-000000000001", current, normal)?.search).toContain("campaign=");
  expect(isDiscoveryPath("/attention")).toBe(true);
  expect(isDiscoveryPath("/campaign/00000000-0000-4000-8000-000000000001")).toBe(true);
  expect(isDiscoveryPath("/elections/retained-id")).toBe(true);
});
it("leaves modified clicks, new tabs, downloads and prevented clicks to the browser", () => {
  for (const modifier of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { target: "_blank" }, { target: "named-window" }, { download: true }, { defaultPrevented: true }]) expect(discoveryDestination("/backing", current, { ...normal, ...modifier })).toBeNull();
});
it("preserves native evidence anchors and excludes other apps, API reads and external origins", () => {
  for (const href of ["#wallet-analysis", "/discover#coverage", "/token/solana/mint#wallet-analysis", "/api/10x/evidence/signature", "/network", "/thesis", "https://solscan.io/token/mint", "https://other.example/backing", "mailto:test@example.org"]) expect(discoveryDestination(href, current, normal)).toBeNull();
  expect(discoveryDestination("/discover", current, normal)).toBeNull();
});
