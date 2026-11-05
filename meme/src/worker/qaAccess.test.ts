import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import {
  qaOrigin,
  qaResponse,
  qaRequest,
  qaTransportRequest,
  qaRoute,
} from "./qaAccess";
test("paged QA reads are allowlisted without permitting writes or arbitrary paths", () => {
  for (const path of [
    "/api/meme/operator/operations/health",
    "/api/meme/operator/operations/controls",
  ]) {
    assert.equal(qaRoute(path, "GET"), false);
    assert.equal(qaRoute(path, "POST"), false);
  }
  for (const path of ["/api/meme/history", "/api/meme/rewards"]) {
    assert.equal(qaRoute(path, "GET"), true);
    assert.equal(qaRoute(path, "POST"), false);
    assert.equal(qaRoute(path + "/private", "GET"), false);
  }
});
import { sha } from "./db";
test("QA transport pins HTTPS only with the private gateway token, preserving the browser Origin", () => {
  const origin = "https://private-qa.trycloudflare.com",
    secret = "t".repeat(43);
  assert.throws(
    () =>
      qaTransportRequest(
        new Request("http://127.0.0.1/api/auth/session", {
          headers: { "x-meme-qa-gateway": "bad" },
        }),
        origin,
        secret,
      ),
    /authentication/,
  );
  const request = qaTransportRequest(
    new Request("http://127.0.0.1/api/auth/session", {
      headers: { "x-meme-qa-gateway": secret, origin: "https://evil.test" },
    }),
    origin,
    secret,
  );
  assert.equal(request.url, origin + "/api/auth/session");
  assert.equal(request.headers.get("origin"), "https://evil.test");
});

test("QA checks server-verified FIDs, rejects malformed rosters and revokes an uninvited sign-in", async () => {
  const t = testDb(),
    origin = "https://private-qa.trycloudflare.com";
  try {
    for (const value of [
      "https://app-local.10x.meme",
      origin + "/",
      "http://private-qa.trycloudflare.com",
      origin + ":8443",
    ])
      assert.equal(qaOrigin(value), null);
    const request = new Request(origin + "/api/meme/state");
    await assert.rejects(qaRequest(t.db, request, ""), /not configured/);
    await assert.rejects(
      qaRequest(t.db, request, "1431382"),
      /invited Farcaster/,
    );
    await t.db
      .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
      .bind(await sha("other"), origin, 37, null, Date.now() + 60000)
      .run();
    const result = await qaResponse(
      t.db,
      request,
      Response.json(
        {},
        {
          headers: {
            "set-cookie": "__Host-meme_session=other; Path=/; Secure",
          },
        },
      ),
      "1431382",
    );
    assert.equal(result.status, 403);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_sessions").get()!.n,
      0,
    );
    await t.db
      .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
      .bind(await sha("invited"), origin, 1431382, null, Date.now() + 60000)
      .run();
    await qaRequest(
      t.db,
      new Request(request, {
        headers: { cookie: "__Host-meme_session=invited" },
      }),
      "1431382",
    );
  } finally {
    t.close();
  }
});
