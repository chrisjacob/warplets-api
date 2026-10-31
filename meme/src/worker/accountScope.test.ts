import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index";
import { principal } from "./auth";
import { sha, Problem } from "./db";
import { testDb } from "./testDb";
const origin = "http://localhost:8797";
test("displayed-account preconditions reject stale mutations before preferences, votes or wallet challenges can change", async () => {
  const t = testDb();
  try {
    const token = "scope-test";
    t.raw
      .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
      .run(await sha(token), origin, 43, null, Date.now() + 60000);
    const env = {
      MEME_DB: t.db,
      LOCAL_PREVIEW_ONLY: "true",
      LOCAL_PARTICIPATION_ENABLED: "true",
      LOCAL_OPERATIONS_ENABLED: "false",
    } as Env;
    const make = (path: string, expected: string, body: unknown) =>
      new Request(origin + path, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: "meme_session=" + token,
          "x-meme-viewer-fid": expected,
        },
        body: JSON.stringify(body),
      });
    for (const [path, body] of [
      [
        "/api/meme/notifications",
        { enabled: 0, voting: 0, launch: 1, rewards: 1, milestones: 0 },
      ],
      [
        "/api/meme/rounds/no-round/vote",
        { candidateId: "a", key: "stale-vote" },
      ],
      [
        "/api/auth/solana/challenge",
        { address: "1".repeat(32), role: "reward" },
      ],
    ] as const) {
      const response = await worker.fetch(make(path, "42", body), env);
      assert.equal(response.status, 409, path);
      assert.match(
        ((await response.json()) as { error: string }).error,
        /Account changed/,
      );
    }
    assert.equal(
      t.raw.prepare("SELECT count(*) n FROM meme_notification_settings").get()
        ?.n,
      0,
    );
    assert.equal(
      t.raw.prepare("SELECT count(*) n FROM meme_challenges").get()?.n,
      0,
    );
    assert.equal(
      t.raw.prepare("SELECT count(*) n FROM meme_votes").get()?.n,
      0,
    );
    const saved = await worker.fetch(
      make("/api/meme/notifications", "43", {
        enabled: 0,
        voting: 0,
        launch: 1,
        rewards: 1,
        milestones: 0,
      }),
      env,
    );
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as { viewerFid: number }).viewerFid, 43);
    // Existing callers without a precondition retain cookie-based authentication.
    assert.equal(
      (
        await principal(
          t.db,
          new Request(origin, { headers: { cookie: "meme_session=" + token } }),
        )
      ).fid,
      43,
    );
    for (const value of ["0", "-1", "42,43", "043", "NaN", "9007199254740992"])
      await assert.rejects(
        principal(t.db, make("/api/meme/notifications", value, {})),
        (error) => error instanceof Problem && error.status === 400,
      );
    await assert.rejects(
      principal(
        t.db,
        new Request(origin, { headers: { "x-meme-viewer-fid": "43" } }),
      ),
      (error) => error instanceof Problem && error.status === 401,
    );
  } finally {
    t.close();
  }
});
