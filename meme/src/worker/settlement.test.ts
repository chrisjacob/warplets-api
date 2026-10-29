import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { recordCampaign, importLedger } from "./holding";
import {
  settle,
  settlementView,
  ownEntitlements,
  reserveUnoffered,
} from "./settlement";
import { encode58 } from "../shared/base58";
import { DAY_MS } from "../shared/rules";
const address = (i: number) => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, i + 1);
  return encode58(bytes);
};
async function setup(n = 3, coverage = true) {
  const t = testDb(),
    close = Date.now() - 10000,
    launch = close - DAY_MS + 1800000;
  await recordCampaign(t.db, {
    id: "edition",
    mint: address(9999),
    symbol: "ED",
    launchedAt: launch,
    totalSupply: "10000",
    decimals: 0,
    mode: "simulated",
    launchEvidence: "Simulated local launch evidence",
  });
  t.raw
    .prepare(
      "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version) VALUES('r',?,?,'cast','skipped','snapshot','local-v1')",
    )
    .run(close - DAY_MS, close);
  t.raw
    .prepare(
      "INSERT INTO meme_ownership_snapshots VALUES('snapshot','r','warplets','simulated',?,?,0,'ready','{}')",
    )
    .run(close - DAY_MS - 1, close - DAY_MS);
  t.raw
    .prepare(
      "INSERT INTO meme_candidates VALUES('r','a','Alpha','A',?,'Reviewed local shortlist')",
    )
    .run(address(9998));
  for (let i = 1; i <= n; i++) {
    t.raw
      .prepare("INSERT INTO meme_votes VALUES('r',?,'a',?,?,?,'scope')")
      .run(i, close - 1000, close - 1000, address(i));
    t.raw
      .prepare("INSERT INTO meme_vote_wallets VALUES('r',?,?)")
      .run(i, address(i));
  }
  if (coverage && n)
    await importLedger(t.db, {
      campaignId: "edition",
      mode: "simulated",
      scopeWallets: Array.from({ length: n }, (_, i) => address(i + 1)),
      events: [],
      throughAt: close,
      throughSlot: 1,
      source: "Explicit zero-activity fixture history",
      cursor: "final",
      complete: true,
      fromMint: true,
    });
  return { ...t, cutoff: close, launch };
}
async function finish(t: ReturnType<typeof testDb>, size = 40) {
  for (let i = 0; i < 100; i++) {
    const s = await settle(t.db, "r", "local-operator", size);
    if (s?.state === "finalized") return s;
  }
  throw Error("Settlement failed to finish");
}
test("closed/skip round settles existing campaigns; fewer than 100 share the full release and payout stays frozen", async () => {
  const t = await setup();
  try {
    const first = await settle(t.db, "r", "op", 1);
    assert.equal(first?.progress.frozen, 1);
    assert.equal(first?.state, "freezing");
    assert.deepEqual(await ownEntitlements(t.db, 1), []);
    // Re-linking after the vote cannot redirect a historical entitlement.
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(1,'solana',?,'reward',?,NULL,'later-proof')",
      )
      .run(address(800), Date.now());
    const done = await finish(t, 1);
    assert.equal(done.progress.frozen, 3);
    assert.equal(done.claimable, false);
    const mine = (await ownEntitlements(t.db, 1)) as {
      amount: string;
      reward_wallet: string;
      release_at: number;
      state: string;
    }[];
    assert.equal(mine[0].amount, "34");
    assert.equal(mine[0].reward_wallet, address(1));
    assert.equal(mine[0].release_at, t.launch + DAY_MS);
    assert.equal(mine[0].state, "finalized_unfunded");
    const proof = await settlementView(t.db, "r");
    assert(
      !JSON.stringify(proof).includes(address(1)),
      "Public proof omits payout wallets",
    );
    assert.equal(
      (await settle(t.db, "r", "other"))?.resultHash,
      done.resultHash,
    );
    assert.equal(
      t.raw
        .prepare("SELECT SUM(CAST(amount AS INTEGER)) n FROM meme_entitlements")
        .get()?.n,
      100,
    );
    assert.equal(
      t.raw
        .prepare("SELECT COUNT(*) n FROM meme_audit WHERE action='settle'")
        .get()?.n,
      1,
    );
    assert.throws(
      () => t.raw.prepare("UPDATE meme_entitlements SET amount='999'").run(),
      /immutable/,
    );
    assert.throws(
      () =>
        t.raw.prepare("UPDATE meme_votes SET reward_wallet='changed'").run(),
      /immutable/,
    );
    await assert.rejects(
      recordCampaign(t.db, {
        id: "backdated",
        mint: address(9000),
        symbol: "LATE",
        launchedAt: t.launch,
        totalSupply: "10000",
        decimals: 0,
        mode: "simulated",
        launchEvidence: "Late record",
      }),
      /Register launches/,
    );
  } finally {
    t.close();
  }
});
test("top 100 tie order is first valid vote then FID; interrupted pages resume with identical hashes and no duplicates", async () => {
  const t = await setup(101);
  try {
    t.raw
      .prepare(
        "UPDATE meme_votes SET first_valid_at=first_valid_at-1 WHERE fid=101",
      )
      .run();
    const first = await settle(t.db, "r", "op", 40);
    assert.equal(first?.progress.frozen, 40);
    assert(
      String(
        t.raw
          .prepare("SELECT payload FROM meme_settlement_inputs LIMIT 1")
          .get()?.payload,
      ).length < 3000,
      "Coverage manifests must not be copied into every voter row",
    );
    t.interruptNextBatch();
    await assert.rejects(
      settle(t.db, "r", "op", 40),
      /Simulated lost response/,
    );
    const after = await settlementView(t.db, "r");
    assert.equal(after?.progress.frozen, 80);
    const done = await finish(t);
    assert.equal(done.inputHash, first?.inputHash);
    assert.equal(done.resultHash, first?.resultHash);
    assert.equal(done.leaderboard.length, 100);
    assert.equal(done.leaderboard[0].fid, 101);
    assert.equal(done.leaderboard[1].fid, 1);
    assert.deepEqual(await ownEntitlements(t.db, 100), []);
    assert.equal((await ownEntitlements(t.db, 101)).length, 1);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_entitlements").get()?.n,
      100,
    );
  } finally {
    t.close();
  }
});
test("missing coverage and unfinished ownership block settlement; simulated evidence cannot become observed", async () => {
  const t = await setup(1, false);
  try {
    await assert.rejects(settle(t.db, "r", "op"), /pending/);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_settlements").get()?.n,
      0,
    );
    t.raw
      .prepare("UPDATE meme_ownership_snapshots SET state='importing'")
      .run();
    await assert.rejects(settle(t.db, "r", "op"), /completed ownership/);
    t.raw
      .prepare(
        "UPDATE meme_ownership_snapshots SET state='ready',mode='observed'",
      )
      .run();
    await assert.rejects(settle(t.db, "r", "op"), /committed attribute cycle/);
  } finally {
    t.close();
  }
});
test("zero qualifiers produce an immutable reserve; unoffered releases require an explicit audited reason", async () => {
  const t = await setup(0);
  try {
    const done = await finish(t);
    assert.equal(done.state, "finalized");
    assert.equal(
      t.raw.prepare("SELECT reserve FROM meme_allocations").get()?.reserve,
      "100",
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_entitlements").get()?.n,
      0,
    );
    await assert.rejects(
      reserveUnoffered(
        t.db,
        { campaignId: "edition", releaseIndex: 2, reason: "No round" },
        "op",
      ),
      /future/,
    );
  } finally {
    t.close();
  }
  const u = testDb();
  try {
    await recordCampaign(u.db, {
      id: "old",
      mint: address(9997),
      symbol: "OLD",
      launchedAt: Date.now() - 3 * DAY_MS,
      totalSupply: "10000",
      decimals: 0,
      mode: "simulated",
      launchEvidence: "Simulated launch",
    });
    const a = await reserveUnoffered(
      u.db,
      { campaignId: "old", releaseIndex: 1, reason: "No round was offered" },
      "op",
    );
    assert.equal(a.reserve, "100");
    assert.equal(
      (
        await reserveUnoffered(
          u.db,
          {
            campaignId: "old",
            releaseIndex: 1,
            reason: "No round was offered",
          },
          "op",
        )
      ).inputHash,
      a.inputHash,
    );
    await assert.rejects(
      reserveUnoffered(
        u.db,
        { campaignId: "old", releaseIndex: 1, reason: "Changed" },
        "op",
      ),
      /changed/,
    );
  } finally {
    u.close();
  }
});
test("concurrent retries settle overlapping campaigns once and conserve each release independently", async () => {
  const t = await setup(3);
  try {
    await recordCampaign(t.db, {
      id: "older",
      mint: address(9996),
      symbol: "OLD",
      launchedAt: t.launch - DAY_MS,
      totalSupply: "20000",
      decimals: 0,
      mode: "simulated",
      launchEvidence: "Second overlapping simulated edition",
    });
    await importLedger(t.db, {
      campaignId: "older",
      mode: "simulated",
      scopeWallets: [1, 2, 3].map(address),
      events: [],
      throughAt: t.cutoff,
      throughSlot: 1,
      source: "Simulated complete history",
      cursor: "final",
      complete: true,
      fromMint: true,
    });
    const begin = await Promise.all([
      settle(t.db, "r", "op"),
      settle(t.db, "r", "op"),
    ]);
    assert.equal(begin[0]?.inputHash, begin[1]?.inputHash);
    await Promise.all([settle(t.db, "r", "op"), settle(t.db, "r", "op")]);
    const done = await finish(t);
    assert.equal(done.allocations.length, 2);
    const sums = t.raw
      .prepare(
        "SELECT allocation_id,SUM(CAST(amount AS INTEGER)) amount FROM meme_entitlements GROUP BY allocation_id ORDER BY allocation_id",
      )
      .all();
    assert.deepEqual(
      sums.map((v) => v.amount),
      [100, 200],
    );
    assert.equal((await ownEntitlements(t.db, 1)).length, 2);
    assert.equal(
      t.raw
        .prepare("SELECT COUNT(*) n FROM meme_audit WHERE action='settle'")
        .get()?.n,
      1,
    );
  } finally {
    t.close();
  }
});
