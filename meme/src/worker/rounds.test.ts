import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import {
  createRound,
  freezeOwnership,
  vote,
  outcome,
  round,
  type OwnershipEvidence,
} from "./rounds";
import { encode58 } from "../shared/base58";
import { ATTRIBUTES } from "../shared/rules";
const wallet = "0x" + "11".repeat(20),
  reward = "1".repeat(32);
async function setup() {
  const t = testDb(),
    now = Date.now();
  t.raw
    .prepare(
      "INSERT INTO meme_wallet_links VALUES(?,'base',?,'boost',?,NULL,'proof')",
    )
    .run(42, wallet, now - 1000);
  t.raw
    .prepare(
      "INSERT INTO meme_wallet_links VALUES(?,'solana',?,'reward',?,NULL,'proof')",
    )
    .run(42, reward, now - 1000);
  await createRound(
    t.db,
    {
      id: "r",
      opensAt: now + 60000,
      closesAt: now + 3600000,
      attribute: "cast",
      candidates: [
        {
          id: "a",
          name: "A",
          symbol: "A",
          ogMint: reward,
          evidence: "Reviewed",
        },
        {
          id: "b",
          name: "B",
          symbol: "B",
          ogMint: encode58(new Uint8Array(32).fill(2)),
          evidence: "Reviewed",
        },
      ],
    },
    "operator",
  );
  const evidence: OwnershipEvidence = {
    source: "warplets",
    mode: "simulated",
    sourceAt: now - 100,
    checkpoint: "fixture-checkpoint",
    complete: true,
    ownership: [
      {
        tokenId: 1,
        wallet,
        levels: Object.fromEntries(ATTRIBUTES.map((a) => [a, 8])) as Record<
          (typeof ATTRIBUTES)[number],
          number
        >,
      },
    ],
  };
  return { ...t, now, evidence };
}
test("freeze is immutable, hides ambiguity and rejects stale/incomplete observed ownership", async () => {
  const t = await setup();
  try {
    await assert.rejects(
      freezeOwnership(t.db, "r", { ...t.evidence, mode: "observed" }, "op"),
      /10K/,
    );
    await assert.rejects(
      freezeOwnership(
        t.db,
        "r",
        { ...t.evidence, sourceAt: t.now - 90000000 },
        "op",
      ),
      /stale/,
    );
    const frozen = await freezeOwnership(t.db, "r", t.evidence, "op");
    assert(frozen.snapshotId);
    assert.equal(
      t.raw.prepare("SELECT level FROM meme_round_eligibility").get()?.level,
      8,
    );
    assert.equal(
      (await freezeOwnership(t.db, "r", t.evidence, "op")).replayed,
      true,
    );
    await assert.rejects(
      freezeOwnership(
        t.db,
        "r",
        { ...t.evidence, checkpoint: "changed" },
        "op",
      ),
      /different freeze/,
    );
  } finally {
    t.close();
  }
});
test("changeable vote preserves earliest timestamp and payout, rejects replay changes, duplicate wallets and closing races", async () => {
  const t = await setup();
  try {
    await freezeOwnership(t.db, "r", t.evidence, "op");
    t.raw
      .prepare("UPDATE meme_rounds SET opens_at=?,state='open' WHERE id='r'")
      .run(t.now - 100);
    await vote(t.db, "r", 42, "a", "request-0001", t.now + 100);
    await vote(t.db, "r", 42, "b", "request-0002", t.now + 200);
    const saved = t.raw.prepare("SELECT * FROM meme_votes").get();
    assert.equal(saved?.candidate_id, "b");
    assert.equal(saved?.first_valid_at, t.now + 100);
    assert.equal(
      (await vote(t.db, "r", 42, "b", "request-0002", t.now + 300)).replayed,
      true,
    );
    await assert.rejects(
      vote(t.db, "r", 42, "a", "request-0002"),
      /payload changed/,
    );
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(?,'solana',?,'reward',?,NULL,'proof')",
      )
      .run(43, reward, t.now);
    await assert.rejects(
      vote(t.db, "r", 43, "a", "request-0003"),
      /conflicted/,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_votes").get()?.n,
      1,
    );
    t.raw
      .prepare("UPDATE meme_rounds SET closes_at=? WHERE id='r'")
      .run(t.now - 1);
    await assert.rejects(vote(t.db, "r", 42, "a", "request-0004"), /closed/);
    await outcome(
      t.db,
      "r",
      { skip: true, reason: "No qualified launch" },
      "op",
    );
    assert.equal((await round(t.db, "r")).state, "skipped");
    await assert.rejects(
      outcome(t.db, "r", { skip: true, reason: "Again" }, "op"),
      /Close voting/,
    );
  } finally {
    t.close();
  }
});
test("ambiguous Base links receive no NFT attribution and late links do not alter a freeze", async () => {
  const t = await setup();
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(?,'base',?,'boost',?,NULL,'proof')",
      )
      .run(43, wallet, t.now - 500);
    await freezeOwnership(t.db, "r", t.evidence, "op");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_round_eligibility").get()?.n,
      0,
    );
    t.raw.prepare("DELETE FROM meme_wallet_links WHERE fid=43").run();
    await freezeOwnership(t.db, "r", t.evidence, "op");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_round_eligibility").get()?.n,
      0,
    );
  } finally {
    t.close();
  }
});
