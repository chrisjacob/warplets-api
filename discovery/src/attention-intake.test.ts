import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import worker, { type LocalEnv } from "./worker";
import { normalizeAttention } from "./attention-feed-contract";
import { buildAttentionQueue } from "./attention-queue";
import { ATTENTION_HOLDER_COHORT_POLICY, assessAttentionHolderCohort, planAttentionHolderCohort } from "./attention-holder-cohort";
import { submitAttentionIntake } from "../../scripts/discovery-attention-intake";
import { key } from "./wallet-fixtures.test-helper";
const root = realpathSync(fileURLToPath(new URL("../../.tmp", import.meta.url))), dirs: string[] = [], databases: DatabaseSync[] = [];
const at = new Date("2026-10-20T12:00:00.000Z"), token = "a".repeat(64), clock = () => at;
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(db => db.close());
  for (const dir of dirs.splice(0)) { const resolved = realpathSync(dir);
    if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith("attention-intake-test-") || lstatSync(dir).isSymbolicLink()) throw Error("Unsafe test cleanup");
    rmSync(resolved, { recursive: true });
  }
});
async function saved() {
  const dir = mkdtempSync(path.join(root, "attention-intake-test-")); dirs.push(dir);
  const queue = buildAttentionQueue([normalizeAttention({ kind: "gmgn_hot_searches" }, { code: 0, data: [{ chain: "sol", interval: "24h", tokens: Array.from({ length: 13 }, (_, i) => ({ address: key(i + 1) })) }] }, at.toISOString())], at);
  queue.rows[1]!.checks = "adverse";
  const cohort = await planAttentionHolderCohort(queue), rows = cohort.plan.selected_addresses.map(address => ({ address, candidate_bytes: null, payload: null, lead_at: null }));
  const report = await assessAttentionHolderCohort(cohort, rows);
  const put = (name: string, data: unknown) => { const body = JSON.stringify(data) + "\n"; writeFileSync(path.join(dir, name), body, { flag: "wx" }); return createHash("sha256").update(body).digest("hex"); };
  return { dir, plan: put("plan.json", { policy: ATTENTION_HOLDER_COHORT_POLICY, ...cohort }), assessment: put("assessment.json", { plan_hash: cohort.plan.plan_hash, rows, report }), addresses: cohort.plan.selected_addresses };
}
const reply = (address: string, extra = {}) => Response.json({ address, state: "queued", duplicate: false, provider_requests: 0, evidence_gates_changed: false, ...extra });
it("journals the entire original cohort before submission and queues exact identities through existing authenticated intake", async () => {
  const s = await saved(), sqlite = new DatabaseSync(":memory:"); databases.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const env = { TENX_DB: sqliteD1(sqlite), TENX_LOCAL_ONLY: "true", TENX_ADMIN_TOKEN: token } as LocalEnv;
  const outside = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No provider calls"));
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const index = transport.mock.calls.length;
    expect(JSON.parse(readFileSync(path.join(s.dir, "intake-v1/plan.json"), "utf8")).members).toEqual(s.addresses);
    expect(existsSync(path.join(s.dir, `intake-v1/${index}-attempt.json`))).toBe(true);
    expect(String(url)).toBe("http://127.0.0.1:8794/api/10x/admin/mint-reviews"); expect(init?.redirect).toBe("error");
    return worker.fetch(new Request(url, init), env);
  });
  const result = await submitAttentionIntake(s.dir, s.plan, s.assessment, token, transport, clock);
  expect(result).toMatchObject({ selected: 3, acknowledged: 3, qualification_admitted: false, provider_requests: 0 });
  expect(result.members.map(r => r.address)).toEqual(s.addresses); expect(outside).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_mint_reviews").get()!.n).toBe(3);
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_usage").get()!.n).toBe(0);
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_candidates").get()!.n).toBe(0);
  await expect(submitAttentionIntake(s.dir, s.plan, s.assessment, token, transport, clock)).rejects.toThrow(); expect(transport).toHaveBeenCalledTimes(3);
});
it.each(["pin", "stale", "future", "credentials"])("holds invalid %s input before journal or request", async kind => {
  const s = await saved(), transport = vi.fn<typeof fetch>();
  await expect(submitAttentionIntake(s.dir, kind === "pin" ? "0".repeat(64) : s.plan, s.assessment, kind === "credentials" ? "bad" : token, transport,
    () => new Date(at.getTime() + (kind === "stale" ? 7200001 : kind === "future" ? -1 : 0)))).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled(); expect(existsSync(path.join(s.dir, "intake-v1"))).toBe(false);
});
it.each(["lost", "denied", "wrong_mint", "oversized", "extra_fields"])("retains uncertain %s submission and all unattempted members without retry", async kind => {
  const s = await saved(), transport = vi.fn<typeof fetch>(async () => {
    if (kind === "lost") throw Error("private transport message");
    if (kind === "denied") return new Response("private response", { status: 429 });
    if (kind === "oversized") return new Response("x".repeat(4097));
    return reply(kind === "wrong_mint" ? key(99) : s.addresses[0]!, kind === "extra_fields" ? { secret: "private" } : {});
  });
  const report = await submitAttentionIntake(s.dir, s.plan, s.assessment, token, transport, clock);
  expect(report.members.map(r => r.submission)).toEqual(["uncertain_or_rejected", "not_attempted", "not_attempted"]);
  expect(transport).toHaveBeenCalledTimes(1); expect(existsSync(path.join(s.dir, "intake-v1/1-attempt.json"))).toBe(true);
  expect(existsSync(path.join(s.dir, "intake-v1/1-ack.json"))).toBe(false);
  expect(readFileSync(path.join(s.dir, "intake-v1/result.json"), "utf8")).not.toContain("private");
  await expect(submitAttentionIntake(s.dir, s.plan, s.assessment, token, transport, clock)).rejects.toThrow(); expect(transport).toHaveBeenCalledTimes(1);
});
it("does not reopen an acknowledged terminal mint or send remaining members after plan expiry", async () => {
  const s = await saved(); let current = at;
  const transport = vi.fn<typeof fetch>(async (_url, init) => { current = new Date(at.getTime() + 7200001); return reply(JSON.parse(String(init?.body)).address, { state: "expired", duplicate: true }); });
  const result = await submitAttentionIntake(s.dir, s.plan, s.assessment, token, transport, () => current);
  expect(result.members[0]).toMatchObject({ submission: "acknowledged", state: "expired", duplicate: true });
  expect(result.members.slice(1).every(r => r.submission === "not_attempted")).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
});
