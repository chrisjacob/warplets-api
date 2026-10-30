import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import {
  startVersion,
  appendVersion,
  sealVersion,
  chosenVersion,
} from "./evidenceVersions";
import { holdingForRound } from "./holding";
import { encode58 } from "../shared/base58";
const wallet = "1".repeat(32),
  mint = encode58(new Uint8Array(32).fill(3)),
  sig = encode58(new Uint8Array(64).fill(1));
test("correction versions replace future replay inputs explicitly and preserve frozen manifests", async () => {
  const t = testDb(),
    now = Date.now(),
    launch = now - 86400000,
    cutoff = now - 10000,
    effective = cutoff - 10000;
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('c',?,'C',?,?, '10000',0,'simulated','test')",
      )
      .run(mint, launch, launch + 864000000);
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(42,'solana',?,'reward',?,NULL,'proof')",
      )
      .run(wallet, launch);
    const event = {
      signature: sig,
      index: 0,
      slot: 400000000,
      at: launch,
      kind: "purchase" as const,
      quantity: "100",
      wallet,
      quote: {
        paidUnits: "100",
        paymentMint: "native:SOL",
        paymentDecimals: 0,
        usdPriceMicros: "1000000",
        at: launch,
        source: "simulated",
        evidenceHash: "fixture",
      },
    };
    await startVersion(t.db, {
      id: "v1",
      campaignId: "c",
      effectiveFrom: effective,
      throughAt: cutoff,
      scopeWallets: [wallet],
      mode: "simulated",
    });
    assert.equal(await chosenVersion(t.db, "c", cutoff), null);
    await appendVersion(t.db, "v1", [event]);
    await appendVersion(t.db, "v1", [event]);
    const sealed = await sealVersion(t.db, "v1");
    assert.equal(
      (await sealVersion(t.db, "v1")).manifestHash,
      sealed.manifestHash,
    );
    const held = await holdingForRound(t.db, "unvoted", cutoff, 42);
    assert(held.complete);
    assert(held.units.get(42)! > 0n);
    await assert.rejects(appendVersion(t.db, "v1", [event]), /Open/);
    assert.equal(await chosenVersion(t.db, "c", effective - 1), null);
    // A correction has a reviewed content hash before activation; the old version stays intact.
    t.raw
      .prepare(
        "INSERT INTO meme_source_corrections VALUES('fix',NULL,'c','Correct valuation',?,?,'proposed','op',?,NULL)",
      )
      .run("0".repeat(64), effective + 1, now);
    await startVersion(t.db, {
      id: "v2",
      parentId: "v1",
      correctionId: "fix",
      campaignId: "c",
      effectiveFrom: effective + 1,
      throughAt: cutoff,
      scopeWallets: [wallet],
      mode: "simulated",
    });
    await appendVersion(t.db, "v2", [
      { ...event, quote: { ...event.quote, paidUnits: "10" } },
    ]);
    const review = await sealVersion(t.db, "v2", true);
    assert(review.manifestHash);
    await assert.rejects(sealVersion(t.db, "v2"), /review manifest/);
    t.raw
      .prepare(
        "UPDATE meme_source_corrections SET manifest_hash=? WHERE id='fix'",
      )
      .run(review.manifestHash);
    await sealVersion(t.db, "v2");
    const corrected = await holdingForRound(t.db, "unvoted", cutoff, 42);
    assert(corrected.units.get(42)! < held.units.get(42)!);
    assert.equal((await chosenVersion(t.db, "c", effective))?.id, "v1");
    assert.equal((await chosenVersion(t.db, "c", cutoff, ["v1"]))?.id, "v1");
    assert.equal(
      t.raw
        .prepare("SELECT state FROM meme_source_corrections WHERE id='fix'")
        .get()?.state,
      "superseded",
    );
    assert.throws(
      () => t.raw.prepare("UPDATE meme_version_events SET payload='{}'").run(),
      /immutable/,
    );
  } finally {
    t.close();
  }
});
test("observed versions cannot be sealed from manual assertions or simulated evidence", async () => {
  const t = testDb(),
    now = Date.now(),
    launch = now - 86400000;
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('c',?,'C',?,?, '10000',0,'observed','test')",
      )
      .run(mint, launch, launch + 864000000);
    const p = {
      id: "v",
      campaignId: "c",
      effectiveFrom: now - 60000,
      throughAt: now - 1000,
      scopeWallets: [wallet],
      mode: "observed",
    };
    await assert.rejects(
      startVersion(t.db, { ...p, mode: "simulated" }),
      /source mode/,
    );
    await startVersion(t.db, p);
    await assert.rejects(sealVersion(t.db, "v"), /Complete source/);
    assert.equal(await chosenVersion(t.db, "c", now - 1000), null);
  } finally {
    t.close();
  }
});

test("observed history verification pages stay bounded and resume a committed checkpoint", async () => {
  const t = testDb(),
    now = Math.floor(Date.now() / 1000) * 1000,
    launch = now - 86400000;
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('c',?,'C',?,?, '10000',0,'observed','test')",
      )
      .run(mint, launch, launch + 864000000);
    t.raw
      .prepare(
        "INSERT INTO meme_source_runs(id,campaign_id,wallet,provider,from_at,through_at,cursor,state,pages,root_hash,last_slot,created_at) VALUES('source','c',?,'helius',?,?,NULL,'ready',5,'source-root',400000000,?)",
      )
      .run(wallet, launch, now - 1000, now);
    const statement = t.raw.prepare(
      "INSERT INTO meme_source_receipts VALUES('source',?,?,?,?,?)",
    );
    for (let i = 1; i <= 100; i++) {
      const signature = encode58(new Uint8Array(64).fill(i));
      const receipt = {
        slot: 400000000,
        blockTime: (launch + 1000) / 1000,
        meta: {
          err: null,
          fee: 5000,
          preBalances: [10000],
          postBalances: [5000],
          preTokenBalances: [],
          postTokenBalances: [],
        },
        transaction: { message: { accountKeys: [wallet] } },
      };
      statement.run(
        signature,
        receipt.slot,
        launch + 1000,
        JSON.stringify(receipt),
        "hash-" + i,
      );
    }
    await startVersion(t.db, {
      id: "v",
      campaignId: "c",
      effectiveFrom: now - 60000,
      throughAt: now - 1000,
      scopeWallets: [wallet],
      mode: "observed",
    });
    assert.equal((await sealVersion(t.db, "v")).state, "checking");
    t.interruptNextBatch();
    await assert.rejects(sealVersion(t.db, "v"), /lost response/);
    let ready = false;
    for (let n = 0; n < 10; n++) {
      t.queries.length = 0;
      const result = await sealVersion(t.db, "v");
      assert(t.queries.length < 35);
      if (result.state === "ready") {
        ready = true;
        break;
      }
    }
    assert(ready);
    assert.equal((await chosenVersion(t.db, "c", now - 1000))?.id, "v");
  } finally {
    t.close();
  }
});

test("a version staged before settlement cannot activate after its cutoff becomes frozen", async () => {
  const t = testDb(),
    now = Date.now(),
    launch = now - 86400000;
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('c',?,'C',?,?, '10000',0,'simulated','test')",
      )
      .run(mint, launch, launch + 864000000);
    await startVersion(t.db, {
      id: "v",
      campaignId: "c",
      effectiveFrom: now - 60000,
      throughAt: now - 1000,
      scopeWallets: [wallet],
      mode: "simulated",
    });
    t.raw
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,rules_version) VALUES('r',?,?,'cast','closed','local-v1')",
      )
      .run(now - 100000, now - 1000);
    t.raw
      .prepare(
        "INSERT INTO meme_settlements VALUES('r',?,'original-input','original-result','{}',0,0,0,'finalized','simulated',?,?)",
      )
      .run(now - 1000, now, now);
    await assert.rejects(sealVersion(t.db, "v"), /frozen settlement/);
    assert.equal(
      t.raw
        .prepare("SELECT result_hash FROM meme_settlements WHERE round_id='r'")
        .get()?.result_hash,
      "original-result",
    );
    assert.equal(await chosenVersion(t.db, "c", now - 1000), null);
  } finally {
    t.close();
  }
});
