import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { evaluateRewards, exampleRewards, REWARD_DAY } from "./reward-math";
import { createRewards, replayRewards, rewardList, rewardRecord } from "./rewards";
import worker, { type LocalEnv } from "./worker";
import { RewardRaw } from "./reward-model";

const now = new Date("2026-10-20T12:00:00.000Z"), instances: DatabaseSync[] = [];
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });
function fixture() {
  const sql = new DatabaseSync(":memory:"); instances.push(sql);
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const db = sqliteD1(sql), batch = db.batch.bind(db); let queue = Promise.resolve<unknown>(null);
  db.batch = ((items: D1PreparedStatement[]) => { const run = queue.then(() => batch(items)); queue = run.catch(() => null); return run; }) as D1Database["batch"];
  return { sql, db };
}
function single() { const s = exampleRewards(now); s.campaigns = s.campaigns.slice(0, 1); s.scores = s.scores.filter(r => r.campaign_id === s.campaigns[0].id); return s; }
const request = () => ({ request_id: crypto.randomUUID(), reason: "Offline accounting test", scenario: single() });
it("keeps ten overlapping editions independent, exactly ten days and ten percent total", () => {
  const input = exampleRewards(now), r = evaluateRewards(input);
  expect(r.max_overlap).toBe(10); expect(r.active_campaigns).toBe(8); expect(r.spotlight_id).toBe(input.campaigns[0].id);
  for (const c of r.campaigns) {
    expect(Date.parse(c.ends_at) - Date.parse(c.starts_at)).toBe(10 * REWARD_DAY);
    expect(BigInt(c.reserve_raw) * 10n).toBe(BigInt(c.supply_raw));
    expect(c.periods.reduce((a, p) => a + BigInt(p.tranche_raw), BigInt(c.schedule_dust_raw))).toBe(BigInt(c.reserve_raw));
    for (const key of ["option_a_raw", "option_b_raw"] as const) expect(BigInt(c[key]) <= BigInt(c.reserve_raw)).toBe(true);
  }
  expect(r).not.toHaveProperty("total_rewards_raw"); expect(r.claims_enabled).toBe(false); expect(r.policy_approved).toBe(false);
});
it("preserves raw ranking and ties independently of boosts and input order", () => {
  const s = single(); s.scores[1].raw_points = "100";
  const before = evaluateRewards(s).campaigns[0].periods[0];
  const reordered = structuredClone(s); reordered.scores.reverse();
  expect(evaluateRewards(reordered)).toEqual(evaluateRewards(s));
  s.scores[0].boost_bps = 50000; s.scores.reverse(); s.campaigns.reverse();
  const after = evaluateRewards(s).campaigns[0].periods[0];
  expect(after.participants.map(p => p.rank)).toEqual([1, 1, 3]);
  expect(after.participants.map(p => p.rank)).toEqual(before.participants.map(p => p.rank));
  expect(after.participants[0].effective_boost_bps).toBe(15000);
});
it("holds whole period on missing raw evidence; missing boosts retain only raw ranks", () => {
  const s = single(); s.scores[0].raw_points = null;
  let p = evaluateRewards(s).campaigns[0].periods[0]; expect(p.status).toBe("raw_evidence_gap"); expect(p.option_a_raw).toBe("0"); expect(p.participants.every(p => p.rank === null)).toBe(true);
  s.scores[0].raw_points = "100"; s.scores[1].boost_bps = null;
  p = evaluateRewards(s).campaigns[0].periods[0]; expect(p.status).toBe("boost_evidence_gap"); expect(p.participants[0].rank).toBe(1); expect(p.option_b_raw).toBe("0");
});
it.each(["raw_observed_at", "boost_observed_at"] as const)("rejects retroactive %s at cutoff and pre-period observations as evidence", key => {
  for (const delta of [-1, REWARD_DAY]) { const s = single(); s.scores[0][key] = new Date(Date.parse(s.campaigns[0].starts_at) + delta).toISOString(); expect(evaluateRewards(s).campaigns[0].periods[0].status).toBe(key === "raw_observed_at" ? "raw_evidence_gap" : "boost_evidence_gap"); }
});
it("excludes quarantined/rejected rows and holds zero or absent scores", () => {
  const s = single(); s.scores[0].disposition = "quarantined"; s.scores[0].raw_points = null; s.scores[1].disposition = "rejected";
  const p = evaluateRewards(s).campaigns[0].periods[0]; expect(p.status).toBe("projected"); expect(p.participants[0].rank).toBeNull(); expect(p.participants[0].option_a_raw).toBe("0"); expect(p.excluded).toBe(2);
  s.scores[2].raw_points = "0"; expect(evaluateRewards(s).campaigns[0].periods[0].status).toBe("no_eligible_points"); s.scores = []; expect(evaluateRewards(s).campaigns[0].periods[0].status).toBe("no_eligible_points");
});
it("enforces exact schedule, unique inputs, end-exclusive spotlight and completed cutoffs", () => {
  for (const raw of ["abc", "-1", "1.2", "01", "18446744073709551616", "9".repeat(100)]) expect(RewardRaw.safeParse(raw).success).toBe(false);
  let s = single(); s.campaigns[0].daily_weights_bps[0]++; expect(() => evaluateRewards(s)).toThrow("weights");
  s = single(); s.campaigns[0].supply_raw = "101"; expect(() => evaluateRewards(s)).toThrow("exact_ten");
  s = single(); s.scores.push(s.scores[0]); expect(() => evaluateRewards(s)).toThrow("duplicate_participant");
  s = single(); s.campaigns.push(s.campaigns[0]); expect(() => evaluateRewards(s)).toThrow("duplicate_campaign");
  s = single(); s.as_of = new Date(Date.parse(s.campaigns[0].starts_at) + 10 * REWARD_DAY).toISOString(); expect(() => evaluateRewards(s)).toThrow("spotlight_not_active"); s.spotlight_id = null; expect(evaluateRewards(s).active_campaigns).toBe(0);
  s = single(); s.scores[0].day = 9; expect(() => evaluateRewards(s)).toThrow("unfinished");
});
it("preserves u64 precision, caps final rewards, leaves dust and protects option B base", () => {
  const s = single(); s.campaigns[0].supply_raw = "18446744073709551610";
  s.scores[0].raw_points = "18446744073709551615"; s.scores[1].raw_points = "18446744073709551615"; s.scores[2].raw_points = "18446744073709551615";
  const p = evaluateRewards(s).campaigns[0].periods[0], tranche = BigInt(p.tranche_raw);
  expect(evaluateRewards(s).campaigns[0].reserve_raw).toBe("1844674407370955161");
  for (const r of p.participants) { expect(BigInt(r.option_a_raw) <= (tranche / 3n) * 15000n / 10000n).toBe(true); expect(BigInt(r.option_b_raw) >= BigInt(r.base_b_raw)).toBe(true); }
  expect(BigInt(p.option_b_raw) + BigInt(p.unallocated_b_raw)).toBe(tranche);
  const bases = p.participants.map(p => p.base_b_raw); s.scores.forEach(s => s.boost_bps = 10000);
  const unboosted = evaluateRewards(s).campaigns[0].periods[0]; expect(unboosted.participants.map(p => p.base_b_raw)).toEqual(bases); expect(BigInt(unboosted.unallocated_b_raw) >= tranche * 2000n / 10000n).toBe(true);
});
it("replays immutable records, redacts participants publicly, retries once and catches tampering with zero fetches", async () => {
  const { db, sql } = fixture(), fetch = vi.fn(() => { throw Error("no provider"); }); vi.stubGlobal("fetch", fetch);
  const input = request(), r = await createRewards(db, input, now);
  expect(await createRewards(db, input, new Date(now.getTime() + REWARD_DAY))).toEqual(r);
  expect(await rewardRecord(db, r.id)).toEqual(r); expect((await rewardList(db)).runs[0].result.campaigns[0].periods[0]).not.toHaveProperty("participants");
  expect(sql.prepare("SELECT count(*) n FROM tenx_audit WHERE action='attention_lab'").get()!.n).toBe(1);
  await expect(createRewards(db, { ...input, reason: "Changed input" }, now)).rejects.toThrow("conflict");
  const bad = structuredClone(r); bad.result.campaigns[0].option_a_raw = "1"; await expect(replayRewards(bad)).rejects.toThrow("mismatch");
  sql.prepare("UPDATE tenx_attention_labs SET created_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z", r.id); await expect(rewardRecord(db, r.id)).rejects.toThrow("mismatch"); expect(fetch).not.toHaveBeenCalled();
});
it("atomically limits concurrent new scenarios to 20 per UTC day and admits retries at the limit", async () => {
  const { db, sql } = fixture(), requests = Array.from({ length: 23 }, request);
  const results = await Promise.allSettled(requests.map(r => createRewards(db, r, now)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(20); expect(results.filter(r => r.status === "rejected")).toHaveLength(3);
  expect(sql.prepare("SELECT count(*) n FROM tenx_audit WHERE action='attention_lab'").get()!.n).toBe(20);
  expect((await createRewards(db, requests[0], now)).id).toBe(requests[0].request_id);
});
it("requires local operator for writes/replay, validates schemas and refuses future as-of", async () => {
  const { db } = fixture(), env = { TENX_DB: db, TENX_ADMIN_TOKEN: "a".repeat(64), TENX_LOCAL_ONLY: "true" } as LocalEnv;
  const input = request();
  const send = (path: string, method = "GET", token = "", body?: unknown) => worker.fetch(new Request(`http://127.0.0.1:8794/api/10x/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  expect((await send("admin/rewards/lab", "POST", "", input)).status).toBe(401);
  expect((await send(`admin/rewards/lab/${input.request_id}`)).status).toBe(401);
  expect((await send("admin/rewards/lab", "POST", env.TENX_ADMIN_TOKEN, { ...input, unexpected: true })).status).toBe(400);
  input.scenario.as_of = "2099-01-01T00:00:00.000Z"; expect((await send("admin/rewards/lab", "POST", env.TENX_ADMIN_TOKEN, input)).status).toBe(400);
  input.scenario.as_of = now.toISOString(); expect((await send("admin/rewards/lab", "POST", env.TENX_ADMIN_TOKEN, input)).status).toBe(200);
  expect((await send("rewards/lab")).status).toBe(200); expect((await send(`admin/rewards/lab/${input.request_id}`, "GET", env.TENX_ADMIN_TOKEN)).status).toBe(200);
});
it("never exceeds daily or campaign budgets across varied schedules and boost assumptions", () => {
  for (let i = 0; i < 40; i++) {
    const s = single(); s.spotlight_id = null; s.as_of = new Date(Date.parse(s.campaigns[0].starts_at) + 10 * REWARD_DAY).toISOString();
    s.campaigns[0].supply_raw = String(BigInt(10 + i) * 7919n * 10n);
    s.campaigns[0].daily_weights_bps = [i * 100, 10000 - i * 100, 0, 0, 0, 0, 0, 0, 0, 0];
    s.combined_cap_bps = 10000 + i * 1000; s.bonus_pool_bps = i * 250;
    const rows = s.scores;
    s.scores = Array.from({ length: 10 }, (_, day) => rows.map((row, j) => ({ ...row, day, raw_points: String((i + j) % 7), boost_bps: 10000 + ((i + j) % 5) * 10000, raw_observed_at: new Date(Date.parse(s.campaigns[0].starts_at) + day * REWARD_DAY + 1000).toISOString(), boost_observed_at: new Date(Date.parse(s.campaigns[0].starts_at) + day * REWARD_DAY + 1000).toISOString() }))).flat();
    const c = evaluateRewards(s).campaigns[0];
    for (const key of ["option_a_raw", "option_b_raw"] as const) {
      expect(BigInt(c[key]) <= BigInt(c.reserve_raw)).toBe(true);
      expect(c.periods.reduce((a, p) => a + BigInt(p[key]), 0n)).toBe(BigInt(c[key]));
      for (const p of c.periods) expect(BigInt(p[key]) <= BigInt(p.tranche_raw)).toBe(true);
    }
  }
});
it("does not count touching campaign windows as an overlap", () => {
  const s = single(); s.scores = []; const first = s.campaigns[0];
  s.campaigns.push({ ...first, id: crypto.randomUUID(), asset: "SIM-NEXT", starts_at: new Date(Date.parse(first.starts_at) + 10 * REWARD_DAY).toISOString() });
  expect(evaluateRewards(s).max_overlap).toBe(1);
});
