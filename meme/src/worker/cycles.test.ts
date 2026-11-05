import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { sealCycle, cycleAttribute, cycleRequest } from "./cycles";
import { DAY_MS } from "../shared/rules";
import { ATTRIBUTES } from "../shared/rules";
test("cycles persist one immutable committed permutation and keep unrevealed order private", async () => {
  const t = testDb();
  try {
    const day = new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10),
      cycle = await sealCycle(t.db, "cycle", day);
    assert.equal(
      (await sealCycle(t.db, "cycle", day)).commitment,
      cycle.commitment,
    );
    const order = [];
    for (let i = 0; i < 10; i++)
      order.push(
        (
          await cycleAttribute(
            t.db,
            "cycle",
            Date.parse(day + "T19:30:00Z") + i * DAY_MS,
          )
        ).attribute,
      );
    assert.deepEqual(order.sort(), [...ATTRIBUTES].sort());
    const response = await cycleRequest(
      t.db,
      new Request("http://localhost/api/meme/cycles/cycle"),
    );
    const visible = (await response!.json()) as Record<string, unknown>;
    assert.equal(visible.commitment, cycle.commitment);
    assert.equal(visible.seed, undefined);
    assert.equal(visible.order, undefined);
    assert.throws(
      () =>
        t.raw.prepare("UPDATE meme_attribute_cycles SET seed='changed'").run(),
      /sealed/,
    );
    await assert.rejects(
      sealCycle(
        t.db,
        "overlap",
        new Date(Date.parse(day + "T00:00:00Z") + DAY_MS)
          .toISOString()
          .slice(0, 10),
      ),
      /overlap/,
    );
  } finally {
    t.close();
  }
});
