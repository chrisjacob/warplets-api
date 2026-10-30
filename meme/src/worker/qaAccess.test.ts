import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { qaOrigin, qaResponse, qaRequest } from "./qaAccess";
import { sha } from "./db";

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
