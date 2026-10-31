/** Local UI simulation only. No real identities, wallets, prices or chain attestations. */
import { createHash } from "node:crypto";
import type { ReturnTypeOf } from "./types";
import { encode58 } from "../../../meme/src/shared/base58";
import {
  boost,
  rankScores,
  streakLength,
} from "../../../meme/src/shared/scoring";
import {
  allocate,
  releaseAt,
  releasesFor,
} from "../../../meme/src/shared/settlement";
import { dailyTimes, ATTRIBUTES, DAY_MS } from "../../../meme/src/shared/rules";
import {
  normalizedHolding,
  type Campaign,
  type LedgerEvent,
} from "../../../meme/src/shared/holding";
import { canonical } from "../../../meme/src/shared/canonical";
import {
  registerMarket,
  appendMarketEvidence,
  publishMarket,
} from "../../../meme/src/worker/markets";
import {
  importTrading,
  publishTrading,
} from "../../../meme/src/worker/trading";
import type {
  TraderEvidence,
  TradeEvent,
} from "../../../meme/src/shared/trading";
export const VERSION = "tenx-ui-seed-v1";
export const hash = (v: string) =>
  createHash("sha256")
    .update(VERSION + ":" + v)
    .digest("hex");
export const address = (v: string) =>
  encode58(new Uint8Array(Buffer.from(hash(v), "hex")));
export const fid = (i: number) => 2000000001 + i;
const names = [
  "Nova",
  "Cedar",
  "Luna",
  "Amber",
  "Pixel",
  "Orbit",
  "Mint",
  "Indigo",
  "Moss",
  "Solar",
  "Echo",
  "Sage",
];
const animals = [
  "Fox",
  "Owl",
  "Otter",
  "Panda",
  "Lynx",
  "Finch",
  "Koala",
  "Moth",
  "Gecko",
  "Raven",
  "Whale",
  "Robin",
  "Tiger",
  "Bear",
  "Wolf",
  "Deer",
  "Crane",
  "Swan",
  "Hare",
  "Dove",
];
export const profile = (i: number) => ({
  fid: fid(i),
  name: names[i % 12] + " " + animals[Math.floor(i / 12) % 20],
  initials: names[i % 12][0] + animals[Math.floor(i / 12) % 20][0],
  wallet: address("wallet:" + i),
  base: "0x" + hash("base:" + i).slice(0, 40),
  level: i === 3 ? 0 : i === 0 ? 8 : 1 + (i % 10),
});
export type Scenario = "active" | "release" | "recovery" | "empty";
export function price(m: number, at: number, launch: number) {
  const hours = Math.max(0, (at - launch) / 3600000),
    og =
      0.08 * (1 + (m % 12)) * (1 + 0.15 * Math.sin(at / DAY_MS / 3 + (m % 12))),
    trend = m % 5 === 0 ? -0.38 : m % 5 === 1 ? 0.5 : 0.12;
  const attn =
    0.0006 *
    (1 + (m % 4)) *
    Math.exp((trend * hours) / 24 / 5 + 0.2 * Math.sin(hours / 9 + m));
  return { og, attn, pair: attn / og };
}
export function receipt(
  t: ReturnTypeOf,
  operation: string,
  subject: string,
  at: number,
) {
  const key = `solana-local:${operation}:${subject}`;
  if (
    t.raw
      .prepare("SELECT 1 FROM meme_financial_receipts WHERE business_key=?")
      .get(key)
  )
    return;
  const id = "qa:" + hash(key),
    sig = encode58(
      new Uint8Array(Buffer.from(hash(key) + hash("sig:" + key), "hex")),
    );
  t.raw
    .prepare(
      "INSERT INTO meme_transaction_intents(id,business_key,network,operation,subject,plan,plan_hash,state,signature,created_at,updated_at,chain_status) VALUES(?,?,'solana-local',?,?,?,?,'confirmed',?,?,?,'finalized')",
    )
    .run(
      id,
      key,
      operation,
      subject,
      canonical({ mode: "simulated", source: VERSION }),
      hash(key),
      sig,
      at,
      at,
    );
  t.raw
    .prepare("INSERT INTO meme_financial_receipts VALUES(?,?,?,?,?,?,?)")
    .run(key, id, operation, subject, sig, hash("receipt:" + key), at);
}
export function claimCredits(t: ReturnTypeOf, input: TraderEvidence) {
  const known = new Set(input.events.map((e) => e.id));
  let added = 0;
  const credits = t.raw
    .prepare(
      "SELECT a.campaign_id,e.amount,f.confirmed_at,f.signature,f.business_key FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id JOIN meme_financial_receipts f ON f.business_key='solana-local:claim:'||a.id||':'||e.fid WHERE e.fid=? AND f.confirmed_at<=? ORDER BY f.confirmed_at,f.business_key",
    )
    .all(input.fid, input.throughAt);
  for (const row of credits) {
    const id = "qa-reward:" + row.business_key;
    if (known.has(id)) continue;
    const raw = String(row.amount).padStart(7, "0"),
      quantity = (raw.slice(0, -6) + "." + raw.slice(-6)).replace(/\.?0+$/, "");
    input.events.push({
      id,
      at: Number(row.confirmed_at),
      slot: Math.floor(Number(row.confirmed_at) / 1000),
      index: 0,
      wallet: input.wallets[0],
      marketId: String(row.campaign_id),
      kind: "external-in",
      quantity,
      signature: String(row.signature),
      evidenceHash: hash(id),
      finalized: true,
    });
    added++;
  }
  return added;
}
export async function syncClaimCredits(
  t: ReturnTypeOf,
  at: number,
  onlyFid?: number,
) {
  let changed = false;
  const list = t.raw
    .prepare(
      "SELECT fid,payload FROM qa_trades" + (onlyFid ? " WHERE fid=?" : ""),
    )
    .all(...(onlyFid ? [onlyFid] : []));
  for (const row of list) {
    const input = JSON.parse(String(row.payload)) as TraderEvidence;
    input.throughAt = at;
    if (!claimCredits(t, input)) continue;
    input.sourceHash = hash(canonical(input.events));
    const parent = t.raw
      .prepare("SELECT source_id FROM meme_trading_source_heads WHERE fid=?")
      .get(row.fid)!.source_id as string;
    await importTrading(
      t.db,
      input,
      parent,
      "Simulated claim inventory; excluded from purchase credit",
      at,
    );
    t.raw
      .prepare("UPDATE qa_trades SET payload=? WHERE fid=?")
      .run(JSON.stringify(input), row.fid);
    changed = true;
  }
  if (changed) await publishTrading(t.db, at, at);
  return changed;
}
function holdings(evidence: TraderEvidence) {
  const out = new Map<string, LedgerEvent[]>();
  for (const e of evidence.events) {
    if (e.kind !== "buy" && e.kind !== "sell" && e.kind !== "external-in")
      continue;
    const list = out.get(e.marketId) ?? [];
    list.push({
      signature: e.signature,
      index: e.index,
      slot: e.slot,
      at: e.at,
      kind:
        e.kind === "buy"
          ? "purchase"
          : e.kind === "external-in"
            ? "airdrop"
            : "sell",
      wallet: e.wallet,
      quantity: String(
        BigInt(e.quantity.split(".")[0]) * 1000000n +
          BigInt((e.quantity.split(".")[1] ?? "").padEnd(6, "0")),
      ),
      ...(e.kind === "buy"
        ? {
            quote: {
              paidUnits: String(Math.round(Number(e.usd) * 1e6)),
              paymentMint: address("usd-fixture"),
              paymentDecimals: 6,
              usdPriceMicros: "1000000",
              at: e.at,
              source: "simulated",
              evidenceHash: e.evidenceHash,
            },
          }
        : {}),
    });
    out.set(e.marketId, list);
  }
  return out;
}
export async function seedData(
  t: ReturnTypeOf,
  asOf: number,
  scenario: Scenario,
) {
  const today = new Date(asOf).toISOString().slice(0, 10),
    times = dailyTimes(today),
    start = Date.parse(today + "T00:00:00Z");
  t.raw.exec(
    "CREATE TABLE IF NOT EXISTS qa_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS qa_people(fid INTEGER PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS qa_trades(fid INTEGER PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS qa_commands(id TEXT PRIMARY KEY,hash TEXT NOT NULL,result TEXT NOT NULL);CREATE TABLE IF NOT EXISTS qa_editions(round_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL)",
  );
  t.raw.prepare("INSERT INTO qa_meta VALUES('version',?)").run(VERSION);
  t.raw.prepare("INSERT INTO qa_meta VALUES('clock',?)").run(String(asOf));
  t.raw.prepare("INSERT INTO qa_meta VALUES('scenario',?)").run(scenario);
  for (let i = 0; i < 240; i++)
    t.raw
      .prepare("INSERT INTO qa_people VALUES(?,?)")
      .run(fid(i), JSON.stringify(profile(i)));
  if (scenario === "empty") {
    t.raw.prepare("INSERT INTO qa_meta VALUES('ready','true')").run();
    return { roundId: null, markets: 0, users: 240 };
  }
  const campaigns: Campaign[] = Array.from({ length: 30 }, (_, m) => {
    const launch = start - (30 - m) * DAY_MS + 20 * 3600000;
    return {
      id: "qa-edition-" + m,
      mint: address("attn:" + m),
      symbol: "ATTN" + names[m % 12].toUpperCase() + (m + 1),
      launchedAt: launch,
      endsAt: launch + 10 * DAY_MS,
      totalSupply: "1000000000000000",
      decimals: 6,
      mode: "simulated",
    };
  }).filter((_, m) => scenario !== "recovery" || ![18, 24].includes(m));
  for (const c of campaigns) {
    const m = Number(c.id.split("-").at(-1));
    t.raw
      .prepare("INSERT INTO meme_campaigns VALUES(?,?,?,?,?,?,?,'simulated',?)")
      .run(
        c.id,
        c.mint,
        c.symbol,
        c.launchedAt,
        c.endsAt,
        c.totalSupply,
        c.decimals,
        "QA fictional launch · " + VERSION,
      );
    receipt(t, "launch", c.id, c.launchedAt);
    await registerMarket(t.db, {
      id: c.id,
      symbol: c.symbol,
      ogSymbol: names[m % 12].toUpperCase(),
      ogMint: address("og:" + (m % 12)),
      attnMint: c.mint,
      pool: null,
      launchedAt: c.launchedAt,
      mode: "simulated",
    });
    const points = [];
    for (let at = c.launchedAt; at < asOf; at += 7200000) {
      const p = price(m, at, c.launchedAt);
      points.push({
        at,
        observedAt: asOf,
        ogUsd: p.og.toFixed(12),
        attnOg: p.pair.toFixed(12),
        intervalMs: 7200000,
        source: VERSION + ":synthetic",
        evidenceHash: hash(c.id + at),
      });
    }
    const p = price(m, asOf, c.launchedAt);
    points.push({
      at: asOf,
      observedAt: asOf,
      ogUsd: p.og.toFixed(12),
      attnOg: p.pair.toFixed(12),
      intervalMs: 7200000,
      source: VERSION + ":synthetic",
      evidenceHash: hash(c.id + asOf),
    });
    for (let offset = 0; offset < points.length; offset += 20)
      await appendMarketEvidence(
        t.db,
        c.id,
        "qa-prices:" + m + ":" + offset,
        points.slice(offset, offset + 20),
        asOf,
      );
    for (const window of ["24h", "30d", "all"] as const)
      await publishMarket(t.db, c.id, window, asOf);
  }
  const evidence: TraderEvidence[] = [];
  for (let i = 0; i < 240; i++) {
    const person = profile(i);
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(?,'solana',?,'reward',?,NULL,?)",
      )
      .run(person.fid, person.wallet, start - 40 * DAY_MS, hash("proof:" + i));
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(?,'base',?,'boost',?,NULL,?)",
      )
      .run(
        person.fid,
        person.base,
        start - 40 * DAY_MS,
        hash("base-proof:" + i),
      );
    const events: TradeEvent[] = [];
    for (const c of campaigns) {
      const m = Number(c.id.split("-").at(-1));
      if ((i + m) % 7 === 0) continue;
      const buyAt = c.launchedAt + 3600000,
        sellAt = c.launchedAt + (6 + (i % 8)) * 3600000;
      const quantity = 10000 + ((i * 71 + m * 173) % 90000);
      for (const [kind, at, q] of [
        ["buy", buyAt, quantity],
        ["sell", sellAt, Math.floor(quantity * (0.2 + (i % 5) / 10))],
      ] as const) {
        if (at > asOf) continue;
        const p = price(m, at, c.launchedAt),
          usd = q * p.attn,
          og = usd / p.og;
        const key = `${i}:${m}:${kind}`;
        events.push({
          id: "qa-trade:" + key,
          at,
          slot: Math.floor(at / 1000),
          index: kind === "buy" ? 0 : 1,
          wallet: person.wallet,
          marketId: c.id,
          kind,
          quantity: String(q),
          usd: usd.toFixed(8),
          og: og.toFixed(8),
          feeUsd: (usd * 0.003 + 0.01).toFixed(8),
          feeOg: ((usd * 0.003 + 0.01) / p.og).toFixed(8),
          signature: encode58(
            new Uint8Array(Buffer.from(hash(key) + hash("s:" + key), "hex")),
          ),
          evidenceHash: hash("e:" + key),
          finalized: true,
        });
      }
    }
    const item: TraderEvidence = {
      version: 1,
      fid: person.fid,
      wallets: [person.wallet],
      verifiedAt: start - 40 * DAY_MS,
      throughAt: asOf,
      complete: true,
      gaps: [],
      sourceHash: hash("trades:" + i + ":" + asOf),
      mode: "simulated",
      markets: campaigns.map((c) => ({
        id: c.id,
        attnMint: c.mint,
        ogMint: address("og:" + (Number(c.id.split("-").at(-1)) % 12)),
      })),
      events,
    };
    evidence.push(item);
    t.raw
      .prepare("INSERT INTO qa_trades VALUES(?,?)")
      .run(person.fid, JSON.stringify(item));
    await importTrading(t.db, item, null, "Synthetic QA event history", asOf);
  }
  await publishTrading(t.db, asOf, asOf);
  // Register all campaigns before settlements: no backdating around immutable commitments.
  for (let d = -30; d <= 0; d++) {
    const day = new Date(start + d * DAY_MS).toISOString().slice(0, 10),
      schedule = dailyTimes(day),
      rid = "qa-round:" + day,
      snapshot = "qa-ownership:" + day,
      selected = (d + 30) % 3,
      closed = d < 0 || scenario === "release",
      skipped = scenario === "recovery" && [-12, -6].includes(d);
    t.raw
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version,selected_candidate,outcome_reason) VALUES(?,?,?,?,?,?, 'local-v1',?,?)",
      )
      .run(
        rid,
        schedule.opensAt,
        schedule.closesAt,
        ATTRIBUTES[(d + 30) % 10],
        skipped ? "skipped" : closed ? "selected" : "open",
        snapshot,
        closed && !skipped ? "c" + selected : null,
        closed ? "Simulated operator selection" : null,
      );
    t.raw
      .prepare(
        "INSERT INTO meme_ownership_snapshots VALUES(?,?,'warplets','simulated',?,?,240,'ready',?)",
      )
      .run(
        snapshot,
        rid,
        schedule.opensAt - 300000,
        schedule.opensAt - 300000,
        JSON.stringify({ source: VERSION, mode: "simulated" }),
      );
    for (let k = 0; k < 3; k++)
      t.raw
        .prepare("INSERT INTO meme_candidates VALUES(?,?,?,?,?,?)")
        .run(
          rid,
          "c" + k,
          names[(d + 42 - selected + k) % 12],
          names[(d + 42 - selected + k) % 12].toUpperCase(),
          address("og:" + ((d + 42 - selected + k) % 12)),
          "Synthetic candidate · no live screening claim",
        );
    const scores = [];
    for (let i = 0; i < 240; i++) {
      const person = profile(i),
        voted = !(d === 0 && i === 0) && (i + d + 30) % 17 !== 0,
        at = schedule.opensAt + 300000 + i * 1000,
        candidate = "c" + ((i + d + 30) % 3);
      t.raw
        .prepare("INSERT INTO meme_round_eligibility VALUES(?,?,?,?,?)")
        .run(
          rid,
          person.fid,
          JSON.stringify([person.base]),
          JSON.stringify(
            person.level ? [{ tokenId: i + 1, level: person.level }] : [],
          ),
          person.level,
        );
      if (voted) {
        t.raw
          .prepare("INSERT INTO meme_votes VALUES(?,?,?,?,?,?,?)")
          .run(
            rid,
            person.fid,
            candidate,
            at,
            at,
            person.wallet,
            hash("scope:" + i),
          );
        t.raw
          .prepare("INSERT INTO meme_vote_wallets VALUES(?,?,?)")
          .run(rid, person.fid, person.wallet);
      }
      const cutoff = closed ? schedule.closesAt : asOf;
      claimCredits(t, evidence[i]);
      const holding = normalizedHolding(
        campaigns,
        holdings(evidence[i]),
        new Set([person.wallet]),
        cutoff,
      );
      const value = boost({
        level: person.level,
        holdingUnits: holding.units,
        streak: streakLength(
          t.raw
            .prepare(
              "SELECT EXISTS(SELECT 1 FROM meme_votes v WHERE v.round_id=r.id AND v.fid=?) voted FROM meme_rounds r WHERE r.closes_at<=? ORDER BY r.closes_at DESC LIMIT 9",
            )
            .all(person.fid, schedule.opensAt)
            .map((r) => Boolean(r.voted)),
          voted,
        ),
        voted,
      });
      scores.push({
        fid: person.fid,
        firstValidAt: at,
        candidateId: candidate,
        rewardWallet: person.wallet,
        score: value,
        boost: {
          base: value.base,
          total: value.total,
          warplet: value.warplet,
          holding: value.holding,
          streak: value.streak,
          points: value.points,
          finality: closed ? "final" : "provisional",
          holdingStatus: "ready",
        },
        voted,
      });
    }
    if (closed) {
      if (!skipped && d < 0)
        t.raw
          .prepare("INSERT INTO qa_editions VALUES(?,?)")
          .run(rid, "qa-edition-" + (d + 30));
      const top = rankScores(scores.filter((s) => s.voted)).slice(0, 100),
        plans = campaigns
          .flatMap((c) =>
            releasesFor(c.launchedAt, schedule.closesAt).map((k) => ({
              c,
              k,
              parts: allocate(
                BigInt(c.totalSupply) / 100n,
                top.map((s, rank) => ({
                  fid: s.fid,
                  rank: rank + 1,
                  pointUnits: String(s.score.pointUnits),
                  rewardWallet: s.rewardWallet,
                })),
              ),
            })),
          )
          .filter((p) => p.c.launchedAt < schedule.closesAt);
      const result = hash(
        canonical({
          rid,
          top: top.map((s) => [s.fid, s.score.points]),
          plans: plans.map((p) => [p.c.id, p.k, p.parts]),
        }),
      );
      t.raw
        .prepare(
          "INSERT INTO meme_settlements VALUES(?,?,?,?,?,?,?,?,'finalized','simulated',?,?)",
        )
        .run(
          rid,
          schedule.closesAt,
          hash("inputs:" + rid),
          result,
          '{"fixture":true}',
          scores.filter((s) => s.voted).length,
          plans.length,
          plans.length * top.length,
          schedule.closesAt + 1,
          schedule.closesAt + 2,
        );
      top.forEach((s, rank) => {
        const input = {
          fid: s.fid,
          rank: rank + 1,
          firstValidAt: s.firstValidAt,
          candidateId: s.candidateId,
          rewardWallet: s.rewardWallet,
          pointUnits: String(s.score.pointUnits),
          boost: s.boost,
          wallets: [s.rewardWallet],
          holding: { source: VERSION },
        };
        t.raw
          .prepare("INSERT INTO meme_settlement_inputs VALUES(?,?,?,?,?)")
          .run(rid, s.fid, rank + 1, canonical(input), hash(canonical(input)));
      });
      for (const { c, k, parts } of plans) {
        const allocation = c.id + ":" + k,
          release = releaseAt(c.launchedAt, k);
        t.raw
          .prepare(
            "INSERT INTO meme_allocations VALUES(?,?,?,?,?,?,?,?,?,?, 'simulated',NULL)",
          )
          .run(
            allocation,
            c.id,
            k,
            release,
            rid,
            String(BigInt(c.totalSupply) / 100n),
            parts.allocated,
            parts.reserve,
            hash("inputs:" + rid),
            result,
          );
        for (const recipient of parts.recipients)
          t.raw
            .prepare(
              "INSERT INTO meme_entitlements VALUES(?,?,?,?,?,'finalized_unfunded')",
            )
            .run(
              allocation,
              recipient.fid,
              recipient.rank,
              recipient.rewardWallet,
              recipient.amount,
            );
        if (!(scenario === "recovery" && k % 4 === 0))
          receipt(t, "fund", allocation, schedule.closesAt + 100);
        if (release + 2000 <= asOf && k % 3 === 0)
          for (const s of top.slice(0, 15))
            receipt(t, "claim", allocation + ":" + s.fid, release + 2000);
      }
    } else await publishScores(t, rid, scores, asOf);
  }
  await syncClaimCredits(t, asOf);
  t.raw.prepare("INSERT INTO qa_meta VALUES('ready','true')").run();
  return {
    roundId: "qa-round:" + today,
    markets: campaigns.length,
    users: 240,
  };
}
export function currentScores(t: ReturnTypeOf, rid: string, at: number) {
  const r = t.raw.prepare("SELECT * FROM meme_rounds WHERE id=?").get(rid)!;
  const campaigns = t.raw
    .prepare(
      "SELECT id,mint,symbol,launched_at launchedAt,ends_at endsAt,total_supply totalSupply,decimals,mode FROM meme_campaigns",
    )
    .all() as unknown as Campaign[];
  return t.raw
    .prepare("SELECT p.fid,p.payload FROM qa_people p")
    .all()
    .map((p) => {
      const person = JSON.parse(p.payload as string),
        vote = t.raw
          .prepare(
            "SELECT candidate_id,first_valid_at FROM meme_votes WHERE round_id=? AND fid=?",
          )
          .get(rid, p.fid),
        input = JSON.parse(
          t.raw.prepare("SELECT payload FROM qa_trades WHERE fid=?").get(p.fid)!
            .payload as string,
        ) as TraderEvidence;
      const holding = normalizedHolding(
          campaigns,
          holdings(input),
          new Set([person.wallet]),
          at,
        ),
        previous = t.raw
          .prepare(
            "SELECT EXISTS(SELECT 1 FROM meme_votes v WHERE v.round_id=r.id AND v.fid=?) voted FROM meme_rounds r WHERE r.closes_at<=? ORDER BY r.closes_at DESC LIMIT 9",
          )
          .all(p.fid, r.opens_at)
          .map((row) => Boolean(row.voted));
      const score = boost({
        level: person.level,
        holdingUnits: holding.units,
        streak: streakLength(previous, !!vote),
        voted: !!vote,
      });
      return {
        fid: person.fid,
        voted: !!vote,
        candidateId: vote?.candidate_id ?? "c0",
        firstValidAt: vote?.first_valid_at ?? at,
        rewardWallet: person.wallet,
        score,
        boost: {
          base: score.base,
          total: score.total,
          warplet: score.warplet,
          holding: score.holding,
          streak: score.streak,
          points: score.points,
          finality: "provisional",
          holdingStatus: "ready",
        },
      };
    });
}
/** Boundary settlement for the interactive demo, using the same ranking/allocation math. */
export function finalizeDemoRounds(t: ReturnTypeOf, at: number) {
  for (const r of t.raw
    .prepare(
      "SELECT id,closes_at FROM meme_rounds WHERE closes_at<=? AND state IN('closed','selected','skipped') AND NOT EXISTS(SELECT 1 FROM meme_settlements s WHERE s.round_id=meme_rounds.id)",
    )
    .all(at)) {
    const rid = String(r.id),
      cutoff = Number(r.closes_at),
      scores = currentScores(t, rid, cutoff),
      top = rankScores(scores.filter((s) => s.voted)).slice(0, 100),
      recipients = top.map((s, i) => ({
        fid: s.fid,
        rank: i + 1,
        pointUnits: String(s.score.pointUnits),
        rewardWallet: s.rewardWallet,
      }));
    const plans = t.raw
      .prepare(
        "SELECT id,launched_at,total_supply FROM meme_campaigns WHERE launched_at<?",
      )
      .all(cutoff)
      .flatMap((c) =>
        releasesFor(Number(c.launched_at), cutoff).map((k) => ({
          id: String(c.id),
          k,
          release: releaseAt(Number(c.launched_at), k),
          total: BigInt(String(c.total_supply)) / 100n,
          parts: allocate(BigInt(String(c.total_supply)) / 100n, recipients),
        })),
      );
    const inputHash = hash(
        canonical({
          rid,
          cutoff,
          inputs: top.map((s) => ({
            fid: s.fid,
            points: String(s.score.pointUnits),
          })),
        }),
      ),
      resultHash = hash(
        canonical(plans.map((p) => ({ ...p, total: String(p.total) }))),
      );
    t.raw.exec("BEGIN IMMEDIATE");
    try {
      t.raw
        .prepare(
          "INSERT INTO meme_settlements VALUES(?,?,?,?,?,?,?,?,'finalized','simulated',?,?)",
        )
        .run(
          rid,
          cutoff,
          inputHash,
          resultHash,
          canonical({ fixture: true, version: VERSION }),
          scores.filter((s) => s.voted).length,
          plans.length,
          plans.length * top.length,
          at,
          at,
        );
      for (const [i, s] of top.entries()) {
        const input = {
          ...recipients[i],
          firstValidAt: s.firstValidAt,
          candidateId: s.candidateId,
          boost: { ...s.boost, finality: "final" },
          wallets: [s.rewardWallet],
          holding: { source: VERSION },
        };
        t.raw
          .prepare("INSERT INTO meme_settlement_inputs VALUES(?,?,?,?,?)")
          .run(rid, s.fid, i + 1, canonical(input), hash(canonical(input)));
      }
      for (const p of plans) {
        const id = p.id + ":" + p.k;
        t.raw
          .prepare(
            "INSERT INTO meme_allocations VALUES(?,?,?,?,?,?,?,?,?,?,'simulated',NULL)",
          )
          .run(
            id,
            p.id,
            p.k,
            p.release,
            rid,
            String(p.total),
            p.parts.allocated,
            p.parts.reserve,
            inputHash,
            resultHash,
          );
        for (const e of p.parts.recipients)
          t.raw
            .prepare(
              "INSERT INTO meme_entitlements VALUES(?,?,?,?,?,'finalized_unfunded')",
            )
            .run(id, e.fid, e.rank, e.rewardWallet, e.amount);
        receipt(t, "fund", id, at);
      }
      t.raw.exec("COMMIT");
    } catch (error) {
      t.raw.exec("ROLLBACK");
      throw error;
    }
  }
}
export async function publishScores(
  t: ReturnTypeOf,
  rid: string,
  scores: unknown[],
  at: number,
) {
  const bytes = JSON.stringify(scores, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    ),
    id = "qa-score:" + hash(rid + ":" + at + ":" + bytes);
  if (t.raw.prepare("SELECT 1 FROM meme_score_snapshots WHERE id=?").get(id))
    return;
  t.raw
    .prepare(
      "INSERT INTO meme_score_snapshots VALUES(?,?,?,?,'building',?,?,?)",
    )
    .run(
      id,
      rid,
      at,
      JSON.stringify({ rules: "local-v1", source: VERSION }),
      scores.length,
      hash(bytes),
      at,
    );
  for (const s of scores as {
    fid: number;
    voted: boolean;
    candidateId: string;
    firstValidAt: number;
    score: { pointUnits: bigint };
    boost: unknown;
  }[]) {
    t.raw
      .prepare("INSERT INTO meme_score_inputs VALUES(?,?,?)")
      .run(id, s.fid, "{}");
    const payload = canonical({
      boost: s.boost,
      coverage: [],
      inputHash: hash(rid + ":" + s.fid),
    });
    t.raw
      .prepare("INSERT INTO meme_score_results VALUES(?,?,?,?,?,?,?,1)")
      .run(
        id,
        s.fid,
        payload,
        hash(payload),
        Number(s.score.pointUnits),
        s.voted ? s.candidateId : null,
        s.firstValidAt,
      );
  }
  t.raw
    .prepare("UPDATE meme_score_snapshots SET state='ready' WHERE id=?")
    .run(id);
  t.raw
    .prepare(
      "INSERT INTO meme_score_heads VALUES(?,?) ON CONFLICT(round_id) DO UPDATE SET snapshot_id=excluded.snapshot_id",
    )
    .run(rid, id);
}
