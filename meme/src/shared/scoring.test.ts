import test from "node:test";
import assert from "node:assert/strict";
import { attributeOrder, boost, streakLength, rankScores } from "./scoring";
import { ATTRIBUTES, dailyTimes } from "./rules";
test("deterministic attribute cycle is a permutation and the UTC timetable is stable across DST", async () => {
  const seed = "11".repeat(32),
    a = await attributeOrder(seed);
  assert.deepEqual(a, await attributeOrder(seed));
  assert.deepEqual([...a].sort(), [...ATTRIBUTES].sort());
  const t = dailyTimes("2026-11-01");
  assert.equal(new Date(t.opensAt).toISOString(), "2026-10-31T20:00:00.000Z");
  assert.equal(t.closesAt - t.opensAt, 84600000);
});
test("additive boosts apply once and reward points are capped at 100 with exact arithmetic", () => {
  const max = boost({
    level: 10,
    holdingUnits: 50000n,
    streak: 100,
    voted: true,
  });
  assert.equal(max.total, "10");
  assert.equal(max.points, "100");
  const example = boost({
    level: 8,
    holdingUnits: 18000n,
    streak: 6,
    voted: true,
  });
  assert.equal(example.total, "5.8");
  assert.equal(example.points, "58");
  assert.equal(
    boost({ level: 8, holdingUnits: 0n, streak: 0, voted: false }).points,
    "0",
  );
  assert.throws(() =>
    boost({ level: 11, holdingUnits: 0n, streak: 0, voted: true }),
  );
  assert.throws(() =>
    boost({ level: 0, holdingUnits: 50001n, streak: 0, voted: true }),
  );
});
test("offered-round streaks include current vote, reset on a miss and stop at ten", () => {
  assert.equal(streakLength([true, true, false, true], true), 3);
  assert.equal(streakLength([], false), 0);
  assert.equal(streakLength(Array(20).fill(true), true), 10);
});
test("equal reward scores use first valid vote and then FID, never candidate choice", () => {
  const score = boost({ level: 0, holdingUnits: 0n, streak: 1, voted: true });
  const ranked = rankScores([
    { fid: 5, firstValidAt: 100, candidateId: "a", rewardWallet: "x", score },
    { fid: 2, firstValidAt: 100, candidateId: "b", rewardWallet: "y", score },
    { fid: 9, firstValidAt: 99, candidateId: "b", rewardWallet: "z", score },
  ]);
  assert.deepEqual(
    ranked.map((x) => x.fid),
    [9, 2, 5],
  );
});
