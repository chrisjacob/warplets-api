import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import {
  createRound,
  freezeOwnership,
  vote,
  state,
  type OwnershipEvidence,
} from "./rounds";
import { startSnapshot, stepSnapshot, snapshotView } from "./snapshots";
import { enqueue, claimJob, runJob, tick } from "./operations";
import { scoreRound } from "./scoring";
import { ATTRIBUTES } from "../shared/rules";

async function setup(cohort = 2) {
  const t = testDb(),
    now = Date.now();
  await createRound(
    t.db,
    {
      id: "r",
      opensAt: now + 60000,
      closesAt: now + 3600000,
      attribute: "cast",
      simulated: true,
      candidates: [
        {
          id: "a",
          name: "A",
          symbol: "A",
          ogMint: "1".repeat(32),
          evidence: "simulated",
        },
      ],
    },
    "op",
  );
  const ownership = [];
  for (let i = 1; i <= cohort; i++) {
    const wallet = "0x" + i.toString(16).padStart(40, "0");
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(?,'base',?,'boost',?,NULL,'proof')",
      )
      .run(i, wallet, now - 1000);
    ownership.push({
      tokenId: i,
      wallet,
      levels: Object.fromEntries(ATTRIBUTES.map((a) => [a, (i % 10) + 1])),
    });
  }
  await freezeOwnership(
    t.db,
    "r",
    {
      source: "warplets",
      mode: "simulated",
      sourceAt: now - 1000,
      checkpoint: "fixture",
      complete: true,
      ownership,
    } as OwnershipEvidence,
    "op",
  );
  t.raw
    .prepare("UPDATE meme_rounds SET opens_at=?,state='open' WHERE id='r'")
    .run(now - 100);
  return { ...t, now };
}
async function finish(t: ReturnType<typeof testDb>, id: string, max = 100) {
  for (let i = 0; i < max; i++)
    if ((await stepSnapshot(t.db, id)).state === "ready") return;
  throw Error("Snapshot did not finish");
}

test("snapshot roster and source watermarks survive concurrent changes, retries and out-of-order publication", async () => {
  const t = await setup();
  try {
    await startSnapshot(t.db, "old", "r");
    // Change eligibility after capture. The old result must continue to use frozen inputs.
    t.raw
      .prepare("UPDATE meme_round_eligibility SET level=10 WHERE fid=1")
      .run();
    await stepSnapshot(t.db, "old");
    t.interruptNextBatch();
    await assert.rejects(stepSnapshot(t.db, "old"), /lost response/);
    await finish(t, "old");
    const hash = t.raw
      .prepare("SELECT result_hash FROM meme_score_snapshots WHERE id='old'")
      .get()?.result_hash;
    assert.equal(
      JSON.parse(
        String(
          t.raw
            .prepare(
              "SELECT payload FROM meme_score_results WHERE snapshot_id='old' AND fid=1",
            )
            .get()?.payload,
        ),
      ).boost.warplet,
      "0.6",
    );
    assert.equal((await stepSnapshot(t.db, "old")).resultHash, hash);
    const oldTime = Number(
      t.raw
        .prepare("SELECT as_of FROM meme_score_snapshots WHERE id='old'")
        .get()?.as_of,
    );
    await startSnapshot(t.db, "new", "r", Math.max(Date.now(), oldTime + 1));
    await finish(t, "new");
    // Replaying old cannot replace a newer published head.
    await stepSnapshot(t.db, "old");
    assert.equal(
      t.raw
        .prepare("SELECT snapshot_id FROM meme_score_heads WHERE round_id='r'")
        .get()?.snapshot_id,
      "new",
    );
    assert.throws(
      () => t.raw.prepare("UPDATE meme_score_results SET payload='{}'").run(),
      /immutable/,
    );
  } finally {
    t.close();
  }
});

test("public reads use snapshots and never advance rounds, replay holdings, collect or enqueue jobs", async () => {
  const t = await setup(1200);
  try {
    await startSnapshot(t.db, "many", "r");
    // Capture once, simulate a reader before materialization.
    t.queries.length = 0;
    const pending = await state(
      t.db,
      new Request("http://localhost/api/meme/state"),
    );
    assert.equal(
      (pending as { scoreSnapshot?: { state: string } }).scoreSnapshot?.state,
      "pending",
    );
    assert(
      !t.queries.some((q) =>
        /UPDATE|INSERT|meme_ledger_|meme_round_eligibility/.test(q),
      ),
    );
    // Publishing 1200 participants is resumable; every public read remains bounded.
    await finish(t, "many", 1210);
    t.queries.length = 0;
    const view = await snapshotView(t.db, "r", 1);
    assert.equal(view.boost?.warplet, "0.6");
    assert(t.queries.length <= 4);
    assert(
      !t.queries.some((q) => /meme_ledger_|meme_round_eligibility/.test(q)),
    );
  } finally {
    t.close();
  }
});

test("snapshot scores match local-v1 scoring and a missing campaign checkpoint stays pending", async () => {
  const t = await setup();
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(1,'solana',?,'reward',?,NULL,'proof')",
      )
      .run("1".repeat(32), t.now - 1000);
    await vote(t.db, "r", 1, "a", "vote-0001");
    await startSnapshot(t.db, "match", "r");
    await finish(t, "match");
    const r = t.raw.prepare("SELECT * FROM meme_rounds WHERE id='r'").get();
    const live = await scoreRound(t.db, r as never, 1),
      stored = await snapshotView(t.db, "r", 1);
    assert.deepEqual(stored.boost, live.view.boost);
    assert.deepEqual(stored.leaderboard, live.view.leaderboard);
    assert.deepEqual(stored.weightedVotes, live.view.weightedVotes);
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('c',?,'C',?,?, '10000',0,'simulated','test')",
      )
      .run("2".repeat(32), t.now - 10000, t.now + 864000000);
    await startSnapshot(t.db, "gap", "r");
    await finish(t, "gap");
    const gap = await snapshotView(t.db, "r", 1);
    assert.equal(gap.holdingComplete, false);
    assert.equal(gap.boost?.holding, "pending");
  } finally {
    t.close();
  }
});

test("job leases fence stale workers; interrupted commits resume; payloads cannot change", async () => {
  const t = await setup();
  try {
    await enqueue(
      t.db,
      "job",
      "score",
      "r",
      { asOf: Date.now() },
      t.now,
      t.now,
    );
    await assert.rejects(
      enqueue(t.db, "job", "score", "other", {}, t.now),
      /identity/,
    );
    const a = await claimJob(t.db, t.now);
    assert(a);
    assert.equal(await claimJob(t.db, t.now + 1), null);
    const b = await claimJob(t.db, t.now + 60001);
    assert(b);
    assert.equal((await runJob(t.db, a, t.now + 60001)).state, "stale");
    assert.equal((await runJob(t.db, b, t.now + 60002)).state, "queued");
    // A completed minute coalesces safely rather than creating different payloads for one ID.
    for (let n = 0; n < 6; n++) await tick(t.db, t.now + 60003);
  } finally {
    t.close();
  }
});

test("prepared rounds resume a lost creation response and never adopt an unrelated operator round", async () => {
  const t = testDb(),
    now = Date.now();
  const plan = (id: string, name: string) => ({
    id,
    opensAt: now + (id==='manual'?86400000:0) + 3600000,
    closesAt: now + (id==='manual'?86400000:0) + 7200000,
    attribute: "cast",
    simulated: true,
    candidates: [
      {
        id: "a",
        name,
        symbol: "A",
        ogMint: "1".repeat(32),
        evidence: "simulated",
      },
    ],
  });
  try {
    await enqueue(
      t.db,
      "prepare:r",
      "prepare",
      "r",
      plan("r", "Scheduled"),
      now,
    );
    const first = await claimJob(t.db, now);
    assert(first);
    t.interruptNextBatch();
    assert.equal((await runJob(t.db, first, now)).state, "retry");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_round_preparations").get()?.n,
      1,
    );
    const next = await claimJob(t.db, now + 10000);
    assert(next);
    assert.equal((await runJob(t.db, next, now + 10000)).state, "done");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_candidates").get()?.n,
      1,
    );
    await createRound(t.db, plan("manual", "Operator choice"), "operator");
    await enqueue(
      t.db,
      "prepare:manual",
      "prepare",
      "manual",
      plan("manual", "Different plan"),
      now,
    );
    const conflicting = await claimJob(t.db, now + 10000);
    assert(conflicting);
    assert.equal(
      (await runJob(t.db, conflicting, now + 10000)).state,
      "blocked",
    );
    assert.equal(
      t.raw
        .prepare("SELECT name FROM meme_candidates WHERE round_id='manual'")
        .get()?.name,
      "Operator choice",
    );
  } finally {
    t.close();
  }
});
