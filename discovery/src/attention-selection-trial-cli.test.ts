import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { collectAttention, reviewAttention } from "./attention-queue";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { fixtureCandidates } from "./fixtures";
import { saveCandidate } from "./store";
import { initAttentionTrial, captureAttentionTrial, reviewAttentionTrial, followupAttentionTrial, reportAttentionTrial } from "../../scripts/discovery-attention-trial";
const at = new Date("2026-10-23T10:00:00.000Z"), dbs: DatabaseSync[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); });
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.useRealTimers(); vi.restoreAllMocks(); });
function temporary() { const root = path.resolve("../.tmp", `attention-trial-test-${crypto.randomUUID()}`); mkdirSync(root, { mode: 0o700 }); return root; }
async function setup() {
  const root = temporary(), database = path.join(root, "fixture.sqlite"), sql = new DatabaseSync(database); dbs.push(sql);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = sqliteD1(sql), candidate = (await fixtureCandidates(at))[0]!; candidate.mode = "live"; await saveCandidate(db, candidate);
  const settings = { db, marketDailyLimit: 600, apiKey: "synthetic-only", permissionReference: GMGN_USE_AUTHORITY };
  await collectAttention(settings, { source: "gmgn", reason: "Synthetic trial source" }, async () => Response.json({ code: 0, data: [{ chain: "sol", interval: "24h", tokens: [{ address: candidate.address, liquidity: 40000, buys: 10, sells: 10, is_wash_trading: false, visiting_count: 100 }] }] }), () => new Date(at.getTime() - 60000));
  await reviewAttention(settings, { reason: "Synthetic trial crosscheck" }, async () => Response.json([{ chainId: "solana", baseToken: { address: candidate.address }, liquidity: { usd: 40000 }, txns: { h24: { buys: 10, sells: 10 } } }]), () => new Date(at.getTime() - 30000));
  const study = path.join(root, "study"); await initAttentionTrial(study);
  return { root, study, database, sql };
}
it("runs a cache-only prospective capture, keeps original slots/labels immutable and replays follow-up without rewriting the source", async () => {
  const { root, study, database, sql } = await setup(), before = JSON.stringify(sql.prepare("SELECT * FROM tenx_usage ORDER BY day,provider").all());
  const result = await captureAttentionTrial(study, database); expect(result).toMatchObject({ slot: 0, population: 1, arm_slots: { provider: 1, lightweight: 1, frozen_v4: 1 }, provider_requests: 0, database_writes: 0 });
  await expect(captureAttentionTrial(study, database)).rejects.toThrow();
  const template = path.join(study, "day-0", "baseline-template.json"); await reviewAttentionTrial(study, 0, template);
  await expect(reviewAttentionTrial(study, 0, template)).rejects.toThrow();
  expect((await reportAttentionTrial(study)).days[0]).toMatchObject({ state: "awaiting_followup", results: { frozen_v4: { unknown: 5, retained_worthwhile: 0 } } });
  vi.setSystemTime(new Date(at.getTime() + 86400000));
  expect(await followupAttentionTrial(study, 0, database)).toMatchObject({ provider_requests: 0, database_writes: 0 });
  await reviewAttentionTrial(study, 0, path.join(study, "day-0", "followup-template.json"));
  expect(await reportAttentionTrial(study)).toMatchObject({ automatic_promotion: false, assessment: "descriptive_only_selection_uplift_not_yet_demonstrated" });
  expect(JSON.stringify(sql.prepare("SELECT * FROM tenx_usage ORDER BY day,provider").all())).toBe(before);
  const unrelated = path.join(root, "labels-copy.json"); writeFileSync(unrelated, readFileSync(template));
  const deepPath = path.join(study, "day-0", "deep.json"), deep = JSON.parse(readFileSync(deepPath, "utf8")); deep[0].scorecard.result.value++; writeFileSync(deepPath, JSON.stringify(deep));
  await expect(reportAttentionTrial(study)).rejects.toThrow();
});
it("keeps an incomplete original capture spent and rejects late backfill", async () => {
  const root = temporary(), study = path.join(root, "study"); await initAttentionTrial(study);
  await expect(captureAttentionTrial(study, path.join(root, "missing.sqlite"))).rejects.toThrow();
  const attempt = readFileSync(path.join(study, "day-0", "attempt.json"), "utf8");
  await expect(captureAttentionTrial(study, path.join(root, "missing.sqlite"))).rejects.toThrow();
  expect(readFileSync(path.join(study, "day-0", "attempt.json"), "utf8")).toBe(attempt);
  expect((await reportAttentionTrial(study)).days[0]).toMatchObject({ state: "original_capture_incomplete_spent" });
  vi.setSystemTime(new Date(at.getTime() + 3 * 3600000));
  await expect(captureAttentionTrial(study, path.join(root, "missing.sqlite"))).rejects.toThrow("trial_capture_outside_declared_slot");
});
it("rejects policy editing and output paths outside the private workspace", async () => {
  const root = temporary(), study = path.join(root, "study"); await initAttentionTrial(study);
  const file = path.join(study, "study.json"), saved = JSON.parse(readFileSync(file, "utf8")); saved.study.policy.top_k = 99; writeFileSync(file, JSON.stringify(saved));
  await expect(reportAttentionTrial(study)).rejects.toThrow("trial_study_mismatch");
  await expect(initAttentionTrial(path.resolve("../", `outside-trial-${crypto.randomUUID()}`))).rejects.toThrow("trial_private_directory_required");
});
