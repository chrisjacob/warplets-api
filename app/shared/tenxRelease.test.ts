import { expect, it } from "vitest";
import { isTenxAppPath, tenxAppEnabled, tenxPage, tenxReleaseSurface } from "./tenxRelease";

const pages = ["/trending", "/history", "/discover", "/attention", "/submit", "/backing", "/rewards", "/launch-lab", "/launch-recovery", "/wallets", "/research", "/transparency", "/status", "/admin/10x", "/campaign/00000000-0000-4000-8000-000000000001", "/elections", "/elections/saved", "/token/solana/mint"];

it("requires an explicit server opt-in and recovers the root and hidden pages at the thesis", () => {
  for (const value of [undefined, null, false, true, "false", "TRUE", "1", "", " true "]) expect(tenxAppEnabled(value)).toBe(false);
  expect(tenxAppEnabled("true")).toBe(true);
  for (const path of ["/", "/thesis", "/thesis/", ...pages, "/unknown"]) expect(tenxPage(path, false)).toBe("thesis");
  expect(tenxPage("/thesis/", true)).toBe("thesis");
  expect(tenxPage("/", true)).toBe("home");
});

it("gates every current product route and whole namespaces while keeping enabled navigation unchanged", () => {
  for (const path of pages) {
    expect(isTenxAppPath(path)).toBe(true);
    expect(tenxPage(path, true)).toBe("discovery");
    expect(tenxReleaseSurface(`${path}/`)).toBe("page");
  }
  for (const path of ["/research/future", "/token/other/mint", "/campaign/invalid", "/%64iscover", "/ADMIN//10X/anything"]) expect(tenxReleaseSurface(path)).toBe("page");
  for (const path of ["/api/10x", "/api/10x/discovery", "/api/%31%30x/identity", "/API//10X/admin"]) expect(tenxReleaseSurface(path)).toBe("api");
});

it("does not gate existing products, thesis assets, legal, email, account or notification APIs", () => {
  for (const path of ["/", "/thesis", "/menu", "/privacy", "/terms", "/warplets", "/stonklets", "/network", "/stop", "/unsubscribe", "/api/email/subscribe", "/api/auth/session", "/api/notifications/open", "/api/stonklets", "/api/10xyz", "/status-icon.png", "/assets/DiscoveryPage-old.js", "/manifest-10x.webmanifest"]) expect(tenxReleaseSurface(path)).toBeNull();
});
