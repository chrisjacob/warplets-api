import { describe, it, expect } from "vitest";
import { onRequest } from "../api/admin/meme/[[path]]";
import { memeAdminPage } from "./memeAdminPage";
import { createAdminSessionToken, requireAdminScope } from "./security";
const secret = "test-admin-session-secret-at-least-thirty-two-characters";
const keys = [
  {
    id: "reader",
    key: "reader-test-key",
    scopes: ["admin:session", "meme:read"],
  },
  {
    id: "operator",
    key: "operator-test-key",
    scopes: ["admin:session", "meme:read", "meme:rounds"],
  },
];
async function call(
  path: string,
  key = "reader",
  body?: unknown,
  extra: HeadersInit = {},
) {
  const session = await createAdminSessionToken(secret, key, 600),
    request = new Request("https://app.10x.meme/api/admin/meme/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "x-admin-token": keys.find((k) => k.id === key)!.key,
        "x-admin-session": session!,
        "content-type": "application/json",
        origin: "https://app.10x.meme",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return (await onRequest({
    request,
    env: {
      ADMIN_API_KEYS_JSON: JSON.stringify(keys),
      ACTION_SESSION_SECRET: secret,
      MEME_ADMIN: {
        read: async (_q: unknown, actor: unknown) => ({
          ok: true,
          data: { actor },
        }),
        command: async (_c: unknown, actor: unknown) => ({
          ok: true,
          data: { actor },
        }),
      },
    },
  } as never)) as Response;
}
describe("private launchpad admin boundary", () => {
  it("binds a valid 2FA session to its scoped key and derives the actor server-side", async () => {
    const response = await call("overview");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: { id: "reader", scopes: ["meme:read"] },
    });
    expect(
      (
        await call("overview", "reader", undefined, {
          "x-admin-session": (await createAdminSessionToken(
            secret,
            "operator",
            600,
          ))!,
        })
      ).status,
    ).toBe(401);
    expect(
      (await call("overview", "reader", undefined, { "x-admin-session": "" }))
        .status,
    ).toBe(401);
  });
  it("rejects scope escalation, origin mismatches, unknown actions and actor injection", async () => {
    const command = {
      id: "test",
      action: "round.publish",
      reason: "Reviewed",
      expectedVersion: 0,
      payload: {},
    };
    expect((await call("commands", "reader", command)).status).toBe(401);
    expect(
      (
        await call("commands", "operator", command, {
          origin: "https://other.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("commands", "operator", { ...command, actor: "superuser" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("commands", "operator", {
          ...command,
          action: "wallet.sign",
        })
      ).status,
    ).toBe(400);
    expect((await call("commands", "operator", command)).status).toBe(200);
  });
  it("permits session bootstrap without granting notification operations", async () => {
    const env = { ADMIN_API_KEYS_JSON: JSON.stringify(keys) },
      request = new Request("https://app.10x.meme/api/admin/2fa/request", {
        headers: { "x-admin-token": keys[0].key },
      });
    expect(
      await requireAdminScope(
        { env, request },
        {
          scope: "admin:session",
          anyOfScopes: ["notify:inspect"],
          require2fa: false,
        },
      ),
    ).toEqual({ ok: true, keyId: "reader" });
    expect(
      (
        await requireAdminScope(
          { env, request },
          { scope: "notifications:send", require2fa: false },
        )
      ).ok,
    ).toBe(false);
  });
  it("always disables the local QA flag in the deployed shell and never embeds credentials", async () => {
    const page = memeAdminPage(false),
      html = await page.text();
    expect(html).toContain("window.__MEME_LOCAL_QA__=false");
    expect(html).not.toContain("reader-test-key");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });
});
