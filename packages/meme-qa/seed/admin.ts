/** Synthetic operations only. This file is outside every production build graph. */
import type { ReturnTypeOf } from "./types";
import { address, hash, profile, receipt, price } from "./data";
import { canonical } from "../../../meme/src/shared/canonical";
import { attributeOrder } from "../../../meme/src/shared/scoring";
import {
  commsCommand,
  collectNoticeCandidates,
} from "../../../meme/src/worker/adminComms";
import { observeMilestone } from "../../../meme/src/worker/milestones";
import { setNotificationSettings } from "../../../meme/src/worker/notifications";
import { claimJob, runJob } from "../../../meme/src/worker/operations";
import { freezeOwnership } from "../../../meme/src/worker/rounds";
import { ATTRIBUTES } from "../../../meme/src/shared/rules";
import { sha } from "../../../meme/src/worker/db";
import {
  registerMarket,
  appendMarketEvidence,
  publishMarket,
} from "../../../meme/src/worker/markets";
import {
  importTrading,
  publishTrading,
} from "../../../meme/src/worker/trading";
export async function prepareDemoRounds(t: ReturnTypeOf, at: number) {
  if (
    t.raw
      .prepare(
        "SELECT paused FROM meme_safety_controls WHERE name='operations'",
      )
      .get()!.paused
  )
    return;
  const job = await claimJob(t.db, at);
  if (job) {
    if (job.kind === "prepare") await runJob(t.db, job, at);
    else throw Error("Unexpected demo job");
  }
  for (const row of t.raw
    .prepare(
      "SELECT id FROM meme_rounds WHERE state='prepared' AND opens_at>? LIMIT 10",
    )
    .all(at)) {
    await freezeOwnership(
      t.db,
      String(row.id),
      {
        source: "warplets",
        mode: "simulated",
        complete: true,
        checkpoint: "qa-freeze:" + row.id,
        sourceAt: at,
        ownership: Array.from({ length: 240 }, (_, i) => profile(i))
          .filter((p) => p.level > 0)
          .map((p, i) => ({
            tokenId: i + 1,
            wallet: p.base,
            levels: Object.fromEntries(ATTRIBUTES.map((a) => [a, p.level])),
          })),
      },
      "qa-seed",
    );
  }
}
export async function seedAdmin(t: ReturnTypeOf, at: number) {
  t.raw.exec(
    "CREATE TABLE IF NOT EXISTS qa_launch_reviews(round_id TEXT PRIMARY KEY,state TEXT NOT NULL,payload TEXT NOT NULL)",
  );
  const date = new Date(at).toISOString().slice(0, 10),
    seed = hash("qa-cycle:" + date),
    cycleId = "qa-cycle:" + date;
  t.raw
    .prepare("INSERT OR IGNORE INTO meme_attribute_cycles VALUES(?,?,?,?,?,?)")
    .run(
      cycleId,
      date,
      seed,
      await sha(`10x-cycle-v1:${cycleId}:${date}:${seed}`),
      canonical(await attributeOrder(seed)),
      Date.parse(date + "T00:00:00Z") - 86400000,
    );
  for (const window of ["1h", "24h"])
    await mockTrending(t, window, "seed:" + window, at);
  if (!t.raw.prepare("SELECT id FROM meme_campaigns LIMIT 1").get()) return;
  await commsCommand(
    t.db,
    "social.save",
    {
      title: "Today’s vote",
      body: "Three OGs. One daily selection. Make your pick.",
      targetPath: "/",
    },
    "qa-seed",
    "qa-social-vote",
    at,
  );
  await commsCommand(
    t.db,
    "social.save",
    {
      title: "Launch update",
      body: "Our simulated daily ATTN edition is live. Compare it with its OG.",
      targetPath: "/?view=History",
    },
    "qa-seed",
    "qa-social-launch",
    at,
  );
  for (let i = 0; i < 20; i++)
    await setNotificationSettings(
      t.db,
      profile(i).fid,
      {
        enabled: 1,
        voting: 1,
        launch: 1,
        rewards: 1,
        milestones: i % 2 === 0 ? 1 : 0,
      },
      at,
    );
  const edition = t.raw
    .prepare("SELECT * FROM meme_campaigns ORDER BY launched_at DESC LIMIT 1")
    .get()!;
  const rule = (await commsCommand(
    t.db,
    "milestone.save",
    {
      editionId: edition.id,
      thresholdUsd: "1000000",
      enabled: true,
      ruleVersion: 0,
    },
    "qa-seed",
    "qa-milestone",
    at,
  )) as { id: string };
  for (const [offset, usd] of [
    [-120000, "0.0009"],
    [-60000, "0.0011"],
    [0, "0.0012"],
  ] as const)
    await observeMilestone(
      t.db,
      rule.id,
      {
        editionId: String(edition.id),
        mint: String(edition.mint),
        supplyRaw: String(edition.total_supply),
        decimals: 6,
        mintAuthority: null,
        priceUsd: usd,
        at: at + offset,
        verifiedAt: at + offset,
        supplyHash: hash("qa-supply"),
        priceHash: hash("qa-price:" + offset),
        mode: "simulated",
      },
      at,
    );
  await collectNoticeCandidates(t.db, at);
}
export async function mockTrending(
  t: ReturnTypeOf,
  window: string,
  id: string,
  at: number,
) {
  if (!["1h", "24h"].includes(window)) throw Error("Choose 1h or 24h");
  const snapshotId = "qa-gmgn:" + hash(id),
    items = Array.from({ length: 8 }, (_, i) => ({
      rank: i + 1,
      name: "Demo OG " + (i + 1),
      symbol: "OG" + (i + 1),
      ogMint: address("qa-feed-og:" + i),
      changePercent: (i % 2 ? -1 : 1) * (8 + i * 3),
      volumeUsd: 100000 + i * 15000,
      liquidityUsd: 200000 + i * 9000,
      marketCapUsd: 1000000 + i * 110000,
    }));
  t.raw
    .prepare("INSERT OR IGNORE INTO meme_gmgn_snapshots VALUES(?,?,?,?)")
    .run(
      snapshotId,
      window,
      at,
      canonical({ mode: "simulated", source: "offline-fixture", items }),
    );
  t.raw
    .prepare(
      "INSERT INTO meme_gmgn_heads VALUES(?,?) ON CONFLICT(window) DO UPDATE SET snapshot_id=excluded.snapshot_id",
    )
    .run(window, snapshotId);
  return { id: snapshotId, items, mode: "simulated" };
}
export async function simulateAdmin(
  t: ReturnTypeOf,
  action: string,
  p: Record<string, unknown>,
  id: string,
  at: number,
) {
  if (action === "gmgn.refresh")
    return mockTrending(t, String(p.window), id, at);
  const rid = String(p.roundId),
    round = t.raw.prepare("SELECT * FROM meme_rounds WHERE id=?").get(rid);
  if (!round || round.state !== "selected")
    throw Error("Select a closed demo round first");
  let row = t.raw
    .prepare("SELECT * FROM qa_launch_reviews WHERE round_id=?")
    .get(rid);
  if (action === "launch.prepare") {
    const candidate = t.raw
      .prepare("SELECT * FROM meme_candidates WHERE round_id=? AND id=?")
      .get(rid, round.selected_candidate)!;
    const packet = {
      mode: "simulated",
      roundId: rid,
      ogMint: candidate.og_mint,
      minimumOgRawUnits: "1",
      supplyRaw: "1000000000000000",
      decimals: 6,
      liquidityPercent: 90,
      rewardsPercent: 10,
      network: "offline-ui",
      signingAvailable: false,
      chainExecution: false,
      feeEstimate: null,
      rentEstimate: null,
      budgetEvidence: "UI simulation only; no executable transaction",
    };
    if (!row) {
      t.raw
        .prepare("INSERT INTO qa_launch_reviews VALUES(?,'prepared',?)")
        .run(rid, canonical(packet));
      row = t.raw
        .prepare("SELECT * FROM qa_launch_reviews WHERE round_id=?")
        .get(rid);
    }
    return { state: row!.state, packet: JSON.parse(String(row!.payload)) };
  }
  if (!row) throw Error("Prepare the demo launch review first");
  if (action === "launch.simulate") {
    if (row.state === "prepared")
      t.raw
        .prepare(
          "UPDATE qa_launch_reviews SET state='simulated' WHERE round_id=?",
        )
        .run(rid);
    return {
      state: row.state === "prepared" ? "simulated" : row.state,
      checks: [
        "90 / 10 supply split",
        "one raw OG unit budgeted",
        "financial signing disabled",
      ],
      mode: "simulated",
    };
  }
  if (action === "launch.handoff") {
    if (row.state === "confirmed")
      return { state: "confirmed", mode: "simulated", replayed: true };
    if (!["simulated", "launching"].includes(String(row.state)))
      throw Error("Simulate and review before confirming a demo launch");
    if (at < Number(round.closes_at) + 1800000)
      throw Error("Advance the demo clock to the launch target first");
    const packet = JSON.parse(String(row.payload));
    if (!packet.launchedAt) {
      let ogIndex =
        Array.from({ length: 12 }, (_, i) => i).find(
          (i) => address("og:" + i) === packet.ogMint,
        ) ?? 0;
      const highest = t.raw
        .prepare(
          "SELECT MAX(CAST(substr(id,12) AS INTEGER)) n FROM meme_campaigns WHERE id LIKE 'qa-edition-%'",
        )
        .get()!.n as number;
      const index = (Math.floor(highest / 12) + 1) * 12 + ogIndex;
      packet.editionId = "qa-edition-" + index;
      packet.launchedAt = at;
      t.raw
        .prepare(
          "UPDATE qa_launch_reviews SET state='launching',payload=? WHERE round_id=?",
        )
        .run(canonical(packet), rid);
    }
    const index = Number(packet.editionId.split("-").at(-1)),
      launchedAt = Number(packet.launchedAt),
      mint = address("attn:" + index),
      symbol = "ATTNDEMO" + index;
    t.raw
      .prepare(
        "INSERT OR IGNORE INTO meme_campaigns VALUES(?,?,?,?,?,?,6,'simulated',?)",
      )
      .run(
        packet.editionId,
        mint,
        symbol,
        launchedAt,
        launchedAt + 10 * 86400000,
        packet.supplyRaw,
        "Offline QA UI simulation",
      );
    receipt(t, "launch", packet.editionId, launchedAt);
    await registerMarket(t.db, {
      id: packet.editionId,
      symbol,
      ogSymbol: "OG",
      ogMint: packet.ogMint,
      attnMint: mint,
      pool: null,
      launchedAt,
      mode: "simulated",
    });
    if (
      !t.raw
        .prepare(
          "SELECT id FROM meme_market_observations WHERE market_id=? LIMIT 1",
        )
        .get(packet.editionId)
    ) {
      const p = price(index, launchedAt, launchedAt);
      await appendMarketEvidence(
        t.db,
        packet.editionId,
        "qa-admin-price:" + rid,
        [
          {
            at: launchedAt,
            observedAt: at,
            ogUsd: p.og.toFixed(12),
            attnOg: p.pair.toFixed(12),
            intervalMs: 7200000,
            source: "tenx-ui-seed-v1:synthetic",
            evidenceHash: hash("launch-price:" + rid),
          },
        ],
        at,
      );
    }
    for (const window of ["24h", "30d", "all"] as const)
      await publishMarket(t.db, packet.editionId, window, at);
    for (const row of t.raw
      .prepare("SELECT fid,payload FROM qa_trades")
      .all()) {
      const input = JSON.parse(String(row.payload));
      if (input.markets.some((m: { id: string }) => m.id === packet.editionId))
        continue;
      input.markets.push({
        id: packet.editionId,
        attnMint: mint,
        ogMint: packet.ogMint,
      });
      input.throughAt = at;
      input.sourceHash = hash(input.sourceHash + packet.editionId);
      const parent = t.raw
        .prepare("SELECT source_id FROM meme_trading_source_heads WHERE fid=?")
        .get(row.fid)!.source_id as string;
      await importTrading(
        t.db,
        input,
        parent,
        "Synthetic launch added to demo market scope",
        at,
      );
      t.raw
        .prepare("UPDATE qa_trades SET payload=? WHERE fid=?")
        .run(JSON.stringify(input), row.fid);
    }
    await publishTrading(t.db, at, at);
    t.raw
      .prepare("INSERT OR IGNORE INTO qa_editions VALUES(?,?)")
      .run(rid, packet.editionId);
    t.raw
      .prepare(
        "UPDATE qa_launch_reviews SET state='confirmed' WHERE round_id=?",
      )
      .run(rid);
    return {
      state: "confirmed",
      editionId: packet.editionId,
      mode: "simulated",
      chainExecution: false,
      financialEffects: "synthetic database only",
    };
  }
  return {
    state: row.state,
    packet: JSON.parse(String(row.payload)),
    mode: "simulated",
    chainExecution: false,
  };
}
