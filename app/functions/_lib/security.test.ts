import { describe, expect, it } from "vitest";
import { requireAdminScope } from "./security";

describe("supplemental admin API keys", () => {
  it("authorizes an active scoped supplemental key", async () => {
    const result = await requireAdminScope({
      env: {
        ADMIN_API_KEYS_JSON: JSON.stringify([
          { id: "primary", key: "primary-token", scopes: ["notifications:send"] },
        ]),
        ADMIN_API_KEYS_JSON_EXTRA: JSON.stringify([
          { id: "bootstrap", key: "bootstrap-token", scopes: ["market:refresh"] },
        ]),
      },
      request: new Request("https://app.10x.meme/api/admin/opensea-market-refresh", {
        headers: { "x-admin-token": "bootstrap-token" },
      }),
    }, { scope: "market:refresh", require2fa: false });

    expect(result).toEqual({ ok: true, keyId: "bootstrap" });
  });

  it("authorizes a scoped one-time release key without replacing existing sets", async () => {
    const result = await requireAdminScope({
      env: {
        ADMIN_API_KEYS_JSON: JSON.stringify([
          { id: "primary", key: "primary-token", scopes: ["notifications:send"] },
        ]),
        ADMIN_API_KEYS_JSON_EXTRA: JSON.stringify([
          { id: "automation", key: "automation-token", scopes: ["security:stats"] },
        ]),
        ADMIN_API_KEYS_JSON_RELEASE: JSON.stringify([
          { id: "release", key: "release-token", scopes: ["market:refresh", "stats:dune"] },
        ]),
      },
      request: new Request("https://app.10x.meme/api/admin/dune-analytics", {
        headers: { "x-admin-token": "release-token" },
      }),
    }, { scope: "stats:dune", require2fa: false });

    expect(result).toEqual({ ok: true, keyId: "release" });
  });

  it("does not authorize inactive supplemental keys", async () => {
    const result = await requireAdminScope({
      env: {
        ADMIN_API_KEYS_JSON_EXTRA: JSON.stringify([
          { id: "bootstrap", key: "bootstrap-token", scopes: ["market:refresh"], active: false },
        ]),
      },
      request: new Request("https://app.10x.meme/api/admin/opensea-market-refresh", {
        headers: { "x-admin-token": "bootstrap-token" },
      }),
    }, { scope: "market:refresh", require2fa: false });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
