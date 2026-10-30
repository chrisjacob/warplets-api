import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { startVersion, appendVersion, sealVersion } from "./evidenceVersions";
import { encode58 } from "../shared/base58";
import { replayVersionPage } from "./pagedEvidence";
import {
  replayHolding,
  type Campaign,
  type LedgerEvent,
} from "../shared/holding";

test("6001-event manifests and participant replay resume bounded pages without truncation or changing accepted hashes", async () => {
  const t = testDb(),
    now = Date.now(),
    wallet = encode58(new Uint8Array(32).fill(7));
  const c: Campaign = {
    id: "c",
    mint: encode58(new Uint8Array(32).fill(8)),
    symbol: "C",
    launchedAt: now - 86400000,
    endsAt: now + 864000000,
    totalSupply: "100000000",
    decimals: 0,
    mode: "simulated",
  };
  try {
    t.raw
      .prepare("INSERT INTO meme_campaigns VALUES(?,?,?,?,?,?,?,?,'fixture')")
      .run(
        c.id,
        c.mint,
        c.symbol,
        c.launchedAt,
        c.endsAt,
        c.totalSupply,
        c.decimals,
        c.mode,
      );
    await startVersion(t.db, {
      id: "v",
      campaignId: c.id,
      effectiveFrom: now - 1000,
      throughAt: now - 1,
      scopeWallets: [wallet],
      mode: "simulated",
    });
    const events: LedgerEvent[] = [];
    for (let i = 0; i < 6001; i++) {
      const bytes = new Uint8Array(64);
      new DataView(bytes.buffer).setUint32(0, i + 1);
      events.push({
        signature: encode58(bytes),
        index: 0,
        slot: 400000000 + i,
        at: c.launchedAt + i,
        kind: i === 0 ? "purchase" : "airdrop",
        wallet,
        quantity: "1",
        ...(i === 0
          ? {
              quote: {
                paidUnits: "100",
                paymentMint: "native:SOL",
                paymentDecimals: 0,
                usdPriceMicros: "1000000",
                at: c.launchedAt,
                source: "simulated",
                evidenceHash: "fixture",
              },
            }
          : {}),
      });
    }
    for (let i = 0; i < events.length; i += 1000)
      await appendVersion(t.db, "v", events.slice(i, i + 1000));
    let result = await sealVersion(t.db, "v");
    assert.equal(result.state, "checking");
    // A response lost after the manifest is closed cannot reopen event appends.
    t.interruptNextBatch();
    await assert.rejects(sealVersion(t.db, "v"), /lost response/);
    await assert.rejects(appendVersion(t.db, "v", [events[0]]), /Open/);
    for (let i = 0; i < 100 && result.state !== "ready"; i++)
      result = await sealVersion(t.db, "v");
    assert.equal(result.state, "ready");
    assert.match(result.manifestHash!, /^[0-9a-f]{64}$/);
    assert.equal(
      (await sealVersion(t.db, "v")).manifestHash,
      result.manifestHash,
    );
    assert.equal(
      t.raw
        .prepare(
          "SELECT event_count FROM meme_version_page_progress WHERE version_id='v'",
        )
        .get()!.event_count,
      6001,
    );
    // Isolated score replay transport; snapshot FK records have no public head or result.
    t.raw
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,rules_version) VALUES('r',?,?,'cast','prepared','local-v1')",
      )
      .run(now - 1000, now + 1000);
    t.raw
      .prepare(
        "INSERT INTO meme_score_snapshots VALUES('s','r',?,'{}','building',1,NULL,?)",
      )
      .run(now - 1, now);
    let replay = await replayVersionPage(
      t.db,
      "s",
      42,
      c,
      "v",
      new Set([wallet]),
      now - 1,
    );
    assert.equal(replay.complete, false);
    for (let i = 0; i < 100 && !replay.complete; i++)
      replay = await replayVersionPage(
        t.db,
        "s",
        42,
        c,
        "v",
        new Set([wallet]),
        now - 1,
      );
    assert.equal(replay.complete, true);
    const expected = replayHolding(c, events, new Set([wallet]), now - 1);
    assert.equal(replay.pointMs, expected.pointMs);
    assert.equal(replay.quantity, expected.quantity);
    assert.deepEqual(
      replay.eligibleCredit.toJSON(),
      expected.eligibleCredit.toJSON(),
    );
    assert(
      t.queries.filter(
        (q) =>
          q.includes("meme_version_events") &&
          q.includes("ORDER BY") &&
          q.includes("LIMIT 200"),
      ).length > 60,
    );
  } finally {
    t.close();
  }
});
