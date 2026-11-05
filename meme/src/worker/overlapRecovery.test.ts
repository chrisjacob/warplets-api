import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { createRound, freezeOwnership, vote, outcome } from "./rounds";
import { recordCampaign, importLedger, campaigns } from "./holding";
import { settle, settlementView, ownEntitlements } from "./settlement";
import { ATTRIBUTES, DAY_MS } from "../shared/rules";
import { encode58 } from "../shared/base58";
const address = (n: number) => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, n);
  return encode58(bytes);
};

test("nineteen rounds settle ten overlapping simulated campaigns through all 100 unfunded releases, with restart and vote changes", async () => {
  const t = testDb(),
    realNow = Date.now,
    initial =
      Math.floor((realNow() - 21 * DAY_MS) / DAY_MS) * DAY_MS + 20 * 3600000;
  let clock = initial - 600000,
    maxOverlap = 0;
  Date.now = () => clock;
  try {
    const scope = Array.from({ length: 5 }, (_, i) => address(i + 1));
    for (let i = 1; i <= 5; i++)
      t.raw
        .prepare(
          "INSERT INTO meme_wallet_links VALUES(?,'solana',?,'reward',?,NULL,'simulated-proof')",
        )
        .run(i, address(i), initial - 60000);
    for (let day = 1; day <= 19; day++) {
      const id = "round-" + day,
        open = initial + (day - 1) * DAY_MS,
        close = initial + day * DAY_MS - 1800000;
      clock = open - 600000;
      await createRound(
        t.db,
        {
          id,
          opensAt: open,
          closesAt: close,
          attribute: ATTRIBUTES[(day - 1) % 10],
          simulated: true,
          candidates: [
            {
              id: "a",
              name: "Alpha",
              symbol: "A",
              ogMint: address(100),
              evidence: "SIMULATED ONLY",
            },
            {
              id: "b",
              name: "Beta",
              symbol: "B",
              ogMint: address(101),
              evidence: "SIMULATED ONLY",
            },
          ],
        },
        "operator",
      );
      await freezeOwnership(
        t.db,
        id,
        {
          source: "warplets",
          mode: "simulated",
          sourceAt: clock - 1000,
          checkpoint: "ownership-" + day,
          complete: true,
          ownership: [],
        },
        "operator",
      );
      clock = open + 1000;
      if (day <= 10)
        await recordCampaign(t.db, {
          id: "edition-" + day,
          mint: address(1000 + day),
          symbol: "ED" + day,
          launchedAt: open,
          totalSupply: "10000",
          decimals: 0,
          mode: "simulated",
          launchEvidence: "SIMULATED accounting fixture, no execution/funding",
        });
      clock = open + 60000;
      for (let fid = 1; fid <= 5; fid++)
        await vote(t.db, id, fid, "a", `vote-${day}-${fid}`);
      clock = open + 120000;
      await vote(t.db, id, 1, "b", `changed-${day}`);
      clock = close + 1000;
      const active = (await campaigns(t.db)).filter(
        (c) => c.launchedAt < close && c.endsAt >= close,
      );
      maxOverlap = Math.max(maxOverlap, active.length);
      for (const c of active)
        await importLedger(t.db, {
          campaignId: c.id,
          mode: "simulated",
          scopeWallets: scope,
          events: [],
          throughAt: close,
          throughSlot: day,
          source: "Explicit zero-inventory fixture",
          cursor: "day-" + day,
          complete: true,
          fromMint: true,
        });
      await outcome(
        t.db,
        id,
        {
          candidateId: "a",
          reason:
            "Simulated operator selection, independent of advisory vote changes",
        },
        "operator",
      );
      if (day === 7) {
        t.interruptNextBatch();
        await assert.rejects(settle(t.db, id, "operator", 2), /lost response/);
      }
      let finalized = false;
      for (let step = 0; step < 100; step++)
        if ((await settle(t.db, id, "operator", 2))?.state === "finalized") {
          finalized = true;
          break;
        }
      assert(finalized);
      const before = await settlementView(t.db, id);
      assert.equal(
        (await settle(t.db, id, "operator", 2))?.resultHash,
        before?.resultHash,
      );
    }
    assert.equal(maxOverlap, 10);
    const allocations = t.raw
      .prepare(
        "SELECT campaign_id,release_index,release_at,total,allocated,reserve FROM meme_allocations ORDER BY campaign_id,release_index",
      )
      .all();
    assert.equal(allocations.length, 100);
    for (let day = 1; day <= 10; day++) {
      const release = allocations.filter(
        (a) => a.campaign_id === "edition-" + day,
      );
      assert.equal(release.length, 10);
      assert.deepEqual(
        release.map((a) => Number(a.release_index)),
        Array.from({ length: 10 }, (_, i) => i + 1),
      );
      assert.equal(
        release.reduce((sum, a) => sum + BigInt(String(a.allocated)), 0n),
        1000n,
      );
      assert(release.every((a) => a.allocated === "100" && a.reserve === "0"));
      assert.equal(release[9].release_at, initial + (day - 1 + 10) * DAY_MS);
    }
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_entitlements").get()?.n,
      500,
    );
    clock = initial + 19 * DAY_MS + 1;
    const own = (await ownEntitlements(t.db, 1)) as { state: string }[];
    assert.equal(own.length, 100);
    assert(own.every((e) => e.state === "finalized_unfunded"));
    assert.deepEqual(t.raw.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    Date.now = realNow;
    t.close();
  }
});
